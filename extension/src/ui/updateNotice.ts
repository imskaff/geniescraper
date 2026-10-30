// The update notice's behaviour in the panel: asking the worker whether a newer extension exists, and turning the
// check on and off. Turning it on is the user's consent: Chrome's prompt for api.github.com comes first, and nothing is
// requested before it is granted.
import { type PanelHost } from "./panelHost";
import { type PanelState } from "./panelState";
import { type OptionalHost } from "../lookups/http";

export class UpdateNotice {
  constructor(
    private readonly host: PanelHost,
    private readonly setHost: (host: OptionalHost, on: boolean) => Promise<void>,
    private readonly setSetting: (on: boolean) => Promise<void>,
  ) {}

  private set(patch: Partial<PanelState["update"]>): void {
    this.host.update({ update: { ...this.host.state.update, ...patch } });
  }

  /** Whether the check is on and allowed: the setting and Chrome's permission, both. */
  private active(): boolean {
    const { update, settings, hosts } = this.host.state;
    return update.eligible && settings.checkUpdates && hosts.github;
  }

  /** Ask the worker for the notice to show. It looks at GitHub itself only when a look is due, or when `force`. */
  async refresh(force = false): Promise<void> {
    if (!this.active()) {
      if (this.host.state.update.offer) this.set({ offer: null });
      return;
    }
    const offer = await this.host.env.api.checkForUpdate(force);
    // The user may have switched it off while GitHub was being asked.
    if (this.active()) this.set({ offer });
  }

  /**
   * Switch the check on or off. Turning it on asks Chrome first, straight from the click; a refusal leaves it off.
   * Turning it off also takes the permission back.
   */
  async setEnabled(on: boolean): Promise<void> {
    if (!this.host.state.update.eligible) return;
    await this.setHost("github", on);
    const granted = this.host.state.hosts.github;
    await this.setSetting(on && granted);
    if (on && granted) await this.refresh(true);
    else this.set({ offer: null });
  }

  /** "Later": hide the notice for a few days. */
  async later(): Promise<void> {
    const offer = this.host.state.update.offer;
    if (!offer) return;
    this.set({ offer: null });
    this.set({ offer: await this.host.env.api.snoozeUpdate(offer.version) });
  }

  /** "Skip this version": never offer it, or an older one, again. */
  async skip(): Promise<void> {
    const offer = this.host.state.update.offer;
    if (!offer) return;
    this.set({ offer: null });
    this.set({ offer: await this.host.env.api.skipUpdate(offer.version) });
  }
}
