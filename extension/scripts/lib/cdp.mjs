// Minimal Chrome DevTools Protocol helpers for the opt-in live checks. No automation framework is used on
// purpose: Playwright and similar tools force pages to report as visible and focused, which hides the
// hidden-tab behaviour these checks exist to measure.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Launch Chromium with the unpacked extension. By default the profile is a throwaway; pass `profileDir` to reuse
 * one (for example a scratch profile the user signed in to by hand), which is left in place afterwards.
 *
 * `loadVia: "protocol"` (the default) loads the extension over the debugging port: installed, branded Chrome and Edge
 * ignore --load-extension but accept this, and so does a plain Chromium. `findServiceWorker` loads it the first time
 * it is asked for the worker, or call `loadExtension()` yourself; it loads once.
 * `loadVia: "flag"` loads it with --load-extension instead, which only a plain Chromium honours.
 */
export function launchChromium({ chromePath, dist, port, profileDir, loadVia = "protocol" }) {
  const profile = profileDir ?? mkdtempSync(join(tmpdir(), "geniescraper-live-"));
  const viaProtocol = loadVia === "protocol";
  let keepOpen;
  let loading;
  const chrome = spawn(
    chromePath,
    [
      `--remote-debugging-port=${String(port)}`,
      `--user-data-dir=${profile}`,
      ...(viaProtocol
        ? ["--enable-unsafe-extension-debugging"]
        : [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`]),
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  const targets = async () => {
    try {
      return await (await fetch(`http://127.0.0.1:${String(port)}/json`)).json();
    } catch {
      return [];
    }
  };

  return {
    targets,
    /** Open a new tab on `url` (the endpoint needs PUT). */
    async openTab(url) {
      const response = await fetch(`http://127.0.0.1:${String(port)}/json/new?${url}`, { method: "PUT" });
      return response.json();
    },
    /** Load the unpacked extension over the debugging port (for `loadVia: "protocol"`), once; resolves to its id. */
    loadExtension() {
      if (!viaProtocol) return Promise.resolve(undefined);
      loading ??= (async () => {
        let version;
        for (let attempt = 0; attempt < 150 && !version; attempt++) {
          try {
            version = await (await fetch(`http://127.0.0.1:${String(port)}/json/version`)).json();
          } catch {
            await sleep(200);
          }
        }
        if (!version) throw new Error("The browser's debugging port never answered.");
        // The connection stays open for as long as the browser runs: the extension is tied to it.
        keepOpen = await connect(version.webSocketDebuggerUrl);
        const loaded = await keepOpen.send("Extensions.loadUnpacked", { path: dist });
        return loaded.id;
      })();
      return loading;
    },
    async stop() {
      // The browser starts helper processes of its own; on Windows end the whole tree.
      if (process.platform === "win32" && chrome.pid) {
        spawnSync("taskkill", ["/PID", String(chrome.pid), "/T", "/F"], { stdio: "ignore" });
      } else {
        chrome.kill();
      }
      await sleep(500);
      if (!profileDir) rmSync(profile, { recursive: true, force: true });
    },
  };
}

/** The extension's service worker target, once it has started. */
export async function findServiceWorker(browser) {
  await browser.loadExtension?.();
  for (let attempt = 0; attempt < 100; attempt++) {
    const worker = (await browser.targets()).find(
      (t) => t.type === "service_worker" && t.url.endsWith("background/worker.js"),
    );
    if (worker) return worker;
    await sleep(200);
  }
  throw new Error("The extension's service worker did not start. Did you run `npm run build`?");
}

/** A CDP session on one target. */
export async function connect(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));
  let nextId = 1;
  const waiting = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    waiting.get(message.id)?.(message);
  });

  function send(method, params = {}) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      waiting.set(id, (message) => {
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
      });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }

  return {
    send,
    /**
     * Evaluate an expression and return its value, waiting for a returned promise.
     * `userGesture` makes the page treat the call as user-initiated, which some APIs (sidePanel.open) require.
     */
    async evaluate(expression, { userGesture = false } = {}) {
      const { result, exceptionDetails } = await send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
        userGesture,
      });
      if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
      return result.value;
    },
    close: () => socket.close(),
  };
}

/**
 * A worker target can be listed a moment before its JavaScript context exists; wait until `chrome` does.
 * Without this the first evaluate sometimes fails with "chrome is not defined".
 */
export async function waitUntilReady(session, probe = "typeof chrome !== 'undefined' && !!chrome.runtime?.id") {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (await session.evaluate(probe).catch(() => false)) return;
    await sleep(200);
  }
  throw new Error("The extension's service worker never became ready.");
}
