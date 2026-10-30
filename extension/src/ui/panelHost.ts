// What the controller's parts (the key box, the desktop link, the YouTube look-ups, the countdown) may use of it:
// the environment, the current state and the one way to change it.
import type { Env, PanelState } from "./panelState";

export interface PanelHost {
  readonly env: Env;
  readonly state: PanelState;
  update(patch: Partial<PanelState>): void;
}
