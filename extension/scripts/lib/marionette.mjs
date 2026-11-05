// Minimal Firefox driver for the opt-in live checks: starts a headless Firefox with a throwaway profile and talks to
// it over Marionette, Firefox's own remote-control protocol (length-prefixed JSON over a local socket). No automation
// framework and no geckodriver, and nothing touches the desktop's mouse or keyboard: keys are sent through the
// browser's own input pipeline, so a full-screen game on the same machine is left alone.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { connect as tcp } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The fixed internal address of the extension, so a test can open its pages (moz-extension://<uuid>/...). */
export const EXTENSION_UUID = "7d9a4c1e-3b52-4f6a-9c1d-5e8f2a0b6c34";

const PREFS = {
  "browser.shell.checkDefaultBrowser": false,
  "browser.startup.homepage_override.mstone": "ignore",
  "startup.homepage_welcome_url": "",
  "startup.homepage_welcome_url.additional": "",
  "datareporting.policy.dataSubmissionEnabled": false,
  "toolkit.telemetry.reportingpolicy.firstRun": false,
  "app.update.auto": false,
  "app.update.enabled": false,
  "extensions.autoDisableScopes": 0,
  "extensions.webextensions.warnings-as-errors": false,
  "network.captive-portal-service.enabled": false,
  "browser.aboutwelcome.enabled": false,
};

/** Frame a Marionette packet: `<byte length>:<json>`. */
export function frame(message) {
  const body = JSON.stringify(message);
  return `${String(Buffer.byteLength(body))}:${body}`;
}

/** Splits a stream into packets; returns the packets found and the bytes left over. */
export function unframe(buffer) {
  const packets = [];
  let rest = buffer;
  for (;;) {
    const colon = rest.indexOf(0x3a);
    if (colon < 0) break;
    const length = Number(rest.subarray(0, colon).toString("utf-8"));
    if (!Number.isInteger(length) || rest.length < colon + 1 + length) break;
    packets.push(JSON.parse(rest.subarray(colon + 1, colon + 1 + length).toString("utf-8")));
    rest = rest.subarray(colon + 1 + length);
  }
  return { packets, rest };
}

function connectSocket(port, attempts = 60) {
  return new Promise((resolve, reject) => {
    const attempt = (left) => {
      const socket = tcp({ host: "127.0.0.1", port }, () => resolve(socket));
      socket.once("error", () => {
        socket.destroy();
        if (left <= 0) reject(new Error(`Firefox did not open Marionette on port ${String(port)}.`));
        else setTimeout(() => attempt(left - 1), 500);
      });
    };
    attempt(attempts);
  });
}

/**
 * Start Firefox headless with a throwaway profile. Resolves to a session with `command(name, params)` plus helpers.
 * `stop()` ends the browser and removes the profile.
 */
export async function launchFirefox({ firefoxPath, port = 2828, headless = true }) {
  const profile = mkdtempSync(join(tmpdir(), "geniescraper-firefox-"));
  const prefs = {
    ...PREFS,
    "extensions.webextensions.uuids": JSON.stringify({ "geniescraper@imskaff": EXTENSION_UUID }),
    // Marionette listens on the port from the profile's prefs, not from the command line.
    "marionette.port": port,
  };
  writeFileSync(
    join(profile, "user.js"),
    Object.entries(prefs)
      .map(([key, value]) => `user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});`)
      .join("\n"),
  );
  const child = spawn(
    firefoxPath,
    [
      ...(headless ? ["-headless"] : []),
      "-no-remote",
      "-profile",
      profile,
      "-marionette",
      "-remote-allow-system-access",
      "about:blank",
    ],
    // The variable lets the check use Firefox's privileged context, to open the extension's own page in a tab.
    { stdio: "ignore", env: { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: "1" } },
  );
  const socket = await connectSocket(port);
  let pending = Buffer.alloc(0);
  let nextId = 1;
  const waiting = new Map();
  let greeted;
  const hello = new Promise((resolve) => {
    greeted = resolve;
  });
  socket.on("data", (chunk) => {
    const { packets, rest } = unframe(Buffer.concat([pending, chunk]));
    pending = rest;
    for (const packet of packets) {
      if (!Array.isArray(packet)) {
        greeted(packet);
        continue;
      }
      const [, id, error, result] = packet;
      const entry = waiting.get(id);
      if (!entry) continue;
      waiting.delete(id);
      if (error) entry.reject(new Error(`${error.error ?? "error"}: ${error.message ?? ""}`));
      else entry.resolve(result);
    }
  });
  await hello;
  const command = (name, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      waiting.set(id, { resolve, reject });
      socket.write(frame([0, id, name, params]));
    });
  await command("WebDriver:NewSession", { capabilities: {} });

  let stopped = false;
  return {
    command,
    async stop() {
      if (stopped) return;
      stopped = true;
      try {
        await command("Marionette:Quit", { flags: ["eForceQuit"] });
      } catch {
        // The browser closes the socket as it quits.
      }
      socket.destroy();
      child.kill();
      await sleep(500);
      try {
        rmSync(profile, { recursive: true, force: true });
      } catch {
        // A browser still shutting down may hold a file; the folder is a throwaway in the temp directory.
      }
    },
  };
}
