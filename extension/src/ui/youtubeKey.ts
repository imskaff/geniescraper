// The user's own YouTube key: checking it, keeping it, and what the key box says about it.
import { cleanKey, looksLikeApiKey, saveYoutubeKey } from "../shared/secrets";
import { type KeyCheck } from "../shared/messages";
import { KEY_CHECK_MESSAGES, type PanelState } from "./panelState";
import { type PanelHost } from "./panelHost";

export class YoutubeKey {
  constructor(
    private readonly host: PanelHost,
    private readonly refreshHosts: () => Promise<void>,
  ) {}

  /** The key that last checked out as saved and working. Kept here, never in the state the view renders from. */
  private workingKey = "";

  /** True when this text is the key already saved and working, so pressing Save again would change nothing. */
  keyIsCurrent(raw: string): boolean {
    return this.workingKey !== "" && cleanKey(raw) === this.workingKey;
  }

  private setState(patch: Partial<PanelState["youtubeKey"]>): void {
    this.host.update({ youtubeKey: { ...this.host.state.youtubeKey, ...patch } });
  }

  /**
   * Check and keep a YouTube key. Chrome's permission prompt for Google's service needs the user's click, so it is asked
   * for first, before any wait (once the key has the right shape, which costs no request).
   */
  async save(raw: string): Promise<void> {
    const key = cleanKey(raw);
    if (this.host.state.youtubeKey.busy) return;
    if (!looksLikeApiKey(key)) {
      this.setState({
        message: key
          ? "That does not look like a YouTube key. A key starts with AIza and is 39 letters, digits, dashes and underscores long. Copy it again from Google's page, using its copy button."
          : "Paste your key into the box first.",
        tone: "error",
      });
      return;
    }
    const asked = this.host.env.hosts.request("youtubeApi");
    this.setState({ busy: true, message: "Checking your key with Google…", tone: "" });
    const granted = await asked.catch(() => false);
    await this.refreshHosts();
    if (!granted) {
      this.setState({
        busy: false,
        tone: "error",
        message:
          "Chrome needs your OK before the extension can talk to Google's YouTube service. Press Save again and choose Allow.",
      });
      return;
    }
    const answer = await this.host.env.api.checkYoutubeKey(key);
    const outcome: KeyCheck = answer.ok ? answer.data : "failed";
    if (outcome === "ok" || outcome === "quota" || outcome === "not-enabled") {
      // A key that is right but not usable yet (service not switched on, allowance used up today) is still kept:
      // the user has done their part, and it starts working by itself.
      await saveYoutubeKey(this.host.env.secrets, key).catch(() => undefined);
    }
    const kept = outcome === "ok" || outcome === "quota" || outcome === "not-enabled";
    this.workingKey = outcome === "ok" ? key : "";
    this.setState({
      saved: kept ? true : this.host.state.youtubeKey.saved,
      busy: false,
      message: KEY_CHECK_MESSAGES[outcome],
      // Only a key that is saved and working is a success; one kept for later (quota, service off) still needs action.
      tone: outcome === "ok" ? "ok" : "error",
    });
  }

  /** Show a message under the key box (the view uses it for things only it can know, such as a refused clipboard). */
  noteMessage(message: string): void {
    this.setState({ message, tone: "error" });
  }

  /** Forget the key and take back the permission for Google's service. */
  async remove(): Promise<void> {
    await saveYoutubeKey(this.host.env.secrets, "").catch(() => undefined);
    this.workingKey = "";
    this.setState({ saved: false, message: "Your key was removed from this browser.", tone: "" });
    await this.host.env.hosts.remove("youtubeApi").catch(() => false);
    await this.refreshHosts();
  }
}
