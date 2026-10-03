import { emptyReputation } from "../social/types";
import type { GameState } from "./state";

/**
 * Fills in fields added after a save was made with neutral defaults, so saves from earlier
 * versions keep loading. Safe to run on any state: existing values are left alone.
 */
export function normalizeState(state: GameState): void {
  const s = state as Partial<GameState> & GameState;
  s.people ??= [];
  s.nextPersonId ??= 1;
  s.businesses ??= [];
  s.nextBusinessId ??= 1;
  const p = s.player;
  p.relationships ??= [];
  p.reputation = { ...emptyReputation(), ...(p.reputation ?? {}) };
  p.pregnancy ??= null;
}
