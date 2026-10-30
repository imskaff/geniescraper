import { describe, expect, it } from "vitest";
import { releaseUrl } from "../../src/core/updates";
import { PanelController } from "../../src/ui/controller";
import { PanelView } from "../../src/ui/view";
import { fakeEnv, offer } from "./fakes";

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

const ON = { onboarded: true, checkUpdates: true };

async function mount(options: Parameters<typeof fakeEnv>[0] = {}, available: string | null = null) {
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const env = fakeEnv(options);
  if (available) env.api.update = offer(available);
  const panel = await PanelController.create(env);
  const view = new PanelView(root, panel);
  await flush();
  return { root, env, panel, view };
}

const $ = (root: ParentNode, selector: string): HTMLElement => {
  const node = root.querySelector<HTMLElement>(selector);
  if (!node) throw new Error(`missing ${selector}`);
  return node;
};
const notice = (root: ParentNode): HTMLElement | null => root.querySelector<HTMLElement>(".update-notice");

describe("the update notice", () => {
  it("asks nothing and shows nothing while the check is off, the default", async () => {
    const { env, root } = await mount({}, "0.7.0");
    expect(env.api.calls.filter((c) => c.startsWith("update"))).toEqual([]);
    expect(env.hosts.log).toEqual([]);
    expect(notice(root)).toBeNull();
  });

  it("asks nothing when the setting is on but Chrome has not granted the host", async () => {
    const { env, root } = await mount({ settings: ON }, "0.7.0");
    expect(env.api.calls.filter((c) => c.startsWith("update"))).toEqual([]);
    expect(notice(root)).toBeNull();
  });

  it("asks nothing for an install the store updates", async () => {
    const { env, root } = await mount({ settings: ON, hosts: { github: true }, updatesEligible: false }, "0.7.0");
    expect(env.api.calls.filter((c) => c.startsWith("update"))).toEqual([]);
    expect(notice(root)).toBeNull();
  });

  it("shows the newer version with a safe link to its release page", async () => {
    const { env, root } = await mount({ settings: ON, hosts: { github: true } }, "0.7.0");
    expect(env.api.calls).toContain("update-check");
    const banner = $(root, ".update-notice");
    expect(banner.getAttribute("aria-label")).toBe("Update available");
    expect(banner.textContent).toContain("Version 0.7.0");
    const link = $(banner, '[data-key="update-open"]') as HTMLAnchorElement;
    expect(link.href).toBe(releaseUrl("0.7.0"));
    expect(link.target).toBe("_blank");
    expect(link.rel).toContain("noopener");
    for (const control of banner.querySelectorAll("button, a")) expect(control.textContent.trim()).not.toBe("");
  });

  it("shows nothing when the worker has no newer version", async () => {
    const { root } = await mount({ settings: ON, hosts: { github: true } }, null);
    expect(notice(root)).toBeNull();
  });

  it("Later hides it and tells the worker, and moves focus to the screen heading", async () => {
    const { env, root } = await mount({ settings: ON, hosts: { github: true } }, "0.7.0");
    ($(root, '[data-key="update-later"]') as HTMLButtonElement).focus();
    $(root, '[data-key="update-later"]').click();
    await flush();
    expect(env.api.calls).toContain("update-later:0.7.0");
    expect(notice(root)).toBeNull();
    expect(document.activeElement).toBe($(root, "#screen h2"));
  });

  it("Skip this version hides it and tells the worker", async () => {
    const { env, root } = await mount({ settings: ON, hosts: { github: true } }, "0.7.0");
    $(root, '[data-key="update-skip"]').click();
    await flush();
    expect(env.api.calls).toContain("update-skip:0.7.0");
    expect(notice(root)).toBeNull();
  });

  it("is hidden during the first-time set-up", async () => {
    const { root } = await mount({ firstRun: true, hosts: { github: true } }, "0.7.0");
    expect(notice(root)).toBeNull();
  });

  it("is hidden while pasting", async () => {
    const { root, panel, env } = await mount({ settings: ON, hosts: { github: true } }, "0.7.0");
    expect(notice(root)).not.toBeNull();
    await env.api.paste({ type: "paste-start", title: "One", queue: [["written_by", "A"]] });
    panel.setPaste(env.api.pasteState);
    await flush();
    expect(notice(root)).toBeNull();
  });

  it("goes away at once when the permission is taken back in chrome://extensions", async () => {
    const { root, env } = await mount({ settings: ON, hosts: { github: true } }, "0.7.0");
    expect(notice(root)).not.toBeNull();
    env.hosts.changeElsewhere("github", false);
    await flush();
    expect(notice(root)).toBeNull();
  });
});

describe("the Check for updates setting", () => {
  const settingsScreen = async (options: Parameters<typeof fakeEnv>[0] = {}, available: string | null = null) => {
    const ui = await mount(options, available);
    ui.panel.openSettings();
    await flush();
    return ui;
  };
  const box = (root: ParentNode): HTMLInputElement => $(root, '[data-key="setting-checkUpdates"]') as HTMLInputElement;

  it("is off by default and says what it contacts and what it never does", async () => {
    const { root } = await settingsScreen();
    expect(box(root).checked).toBe(false);
    const help = $(root, "#setting-checkUpdates-help").textContent;
    expect(help).toContain("api.github.com");
    expect(help).toContain("nothing about you or your songs is sent");
    expect(help).toContain("never downloads or installs");
    expect(box(root).getAttribute("aria-describedby")).toBe("setting-checkUpdates-help");
  });

  it("is not offered to a store install", async () => {
    const { root } = await settingsScreen({ updatesEligible: false });
    expect(root.querySelector('[data-key="setting-checkUpdates"]')).toBeNull();
  });

  it("asks Chrome first, then saves the choice and looks at once", async () => {
    const { root, env } = await settingsScreen();
    box(root).click();
    await flush();
    expect(env.hosts.log).toEqual(["request:github"]);
    expect(env.settingsStore.data.get("settings")).toMatchObject({ checkUpdates: true });
    expect(env.api.calls).toContain("update-check:force");
    expect(box(root).checked).toBe(true);
  });

  it("stays off, with a message, when Chrome refuses", async () => {
    const { root, env } = await settingsScreen();
    env.hosts.allow = false;
    box(root).click();
    await flush();
    expect(env.hosts.log).toEqual(["request:github"]);
    expect(env.settingsStore.data.get("settings")).toMatchObject({ checkUpdates: false });
    expect(env.api.calls.filter((c) => c.startsWith("update"))).toEqual([]);
    expect(box(root).checked).toBe(false);
    expect($(root, "#alert").textContent).toContain("Chrome did not grant access");
  });

  it("turning it off takes the permission back and hides the notice", async () => {
    const { root, env, panel } = await settingsScreen({ settings: ON, hosts: { github: true } }, "0.7.0");
    expect(box(root).checked).toBe(true);
    await panel.setCheckUpdates(false);
    await flush();
    expect(env.hosts.log).toEqual(["remove:github"]);
    expect(env.settingsStore.data.get("settings")).toMatchObject({ checkUpdates: false });
    expect(panel.state.update.offer).toBeNull();
    expect(box(root).checked).toBe(false);
  });

  it("shows unticked when the permission was taken back elsewhere, although the choice was saved", async () => {
    const { root } = await settingsScreen({ settings: ON, hosts: { github: false } });
    expect(box(root).checked).toBe(false);
  });
});
