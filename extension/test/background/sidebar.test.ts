import { describe, expect, it } from "vitest";
import { toggleSidebarOnClick, type SidebarHost } from "../../src/background/sidebar";

function host(toggle?: () => Promise<void>): { host: SidebarHost; click: () => void; listeners: number } {
  const listeners: Array<() => void> = [];
  const h: SidebarHost = {
    action: {
      onClicked: {
        addListener: (fn) => {
          listeners.push(fn);
        },
      },
    },
    ...(toggle ? { sidebarAction: { toggle } } : {}),
  };
  return {
    host: h,
    click: () => {
      listeners.forEach((fn) => {
        fn();
      });
    },
    get listeners() {
      return listeners.length;
    },
  };
}

describe("toggleSidebarOnClick", () => {
  it("toggles the sidebar synchronously on a toolbar click", () => {
    let toggled = 0;
    const h = host(() => {
      toggled++;
      return Promise.resolve();
    });
    expect(toggleSidebarOnClick(h.host)).toBe(true);
    expect(toggled).toBe(0);
    h.click();
    expect(toggled).toBe(1);
  });

  it("does nothing where there is no sidebar, so Chrome and Safari are untouched", () => {
    const h = host();
    expect(toggleSidebarOnClick(h.host)).toBe(false);
    expect(h.listeners).toBe(0);
  });

  it("ignores a refusal from the browser", async () => {
    const h = host(() => Promise.reject(new Error("may only be called from a user input handler")));
    toggleSidebarOnClick(h.host);
    expect(() => {
      h.click();
    }).not.toThrow();
    await Promise.resolve();
  });
});
