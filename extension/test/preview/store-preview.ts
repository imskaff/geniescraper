// Renders the real side panel with the tests' sample data (Demo Artist, Demo Album), for the store screenshots.
// Bundled and opened in a browser by scripts/store-assets.mjs; it is not part of the extension or of the test run.
import { PanelController } from "../../src/ui/controller";
import { PanelView } from "../../src/ui/view";
import { ALBUM, fakeEnv } from "../ui/fakes";

type Screen = "tracks" | "credits" | "track" | "paste" | "settings";

async function main(): Promise<void> {
  const screen = (new URLSearchParams(location.search).get("screen") ?? "credits") as Screen;
  const root = document.getElementById("app") as HTMLElement;
  // Every track finds its video, so the screenshots show a finished read rather than a lookup that came back empty.
  const found = {
    ok: true as const,
    data: {
      url: "https://www.youtube.com/watch?v=abcDEF_-123",
      isMusicVideo: true,
      throttled: false,
      keyProblem: "" as const,
    },
  };
  const panel = await PanelController.create(
    fakeEnv({
      hosts: { youtube: true },
      settings: { onboarded: true },
      api: { lookupYoutube: () => Promise.resolve(found) },
    }),
  );
  new PanelView(root, panel);
  if (screen === "settings") {
    panel.openSettings();
    return;
  }
  await panel.detect(ALBUM.url);
  if (screen === "tracks") return;
  await panel.setAllSelected(true);
  await panel.getCredits();
  await new Promise((resolve) => setTimeout(resolve, 80));
  if (screen === "track") await panel.showTrack(0);
  if (screen === "paste") await panel.startPaste(0);
}

void main();
