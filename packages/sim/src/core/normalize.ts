import { emptyConflict } from "../conflict/types";
import { emptyLegal } from "../crime/crime";
import { emptyDynasty } from "../life/aging";
import { emptyStory } from "../events/storyEvents";
import { emptyPlayerPolitics, emptyPolitics } from "../politics/types";
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
  s.politics ??= emptyPolitics();
  s.story ??= emptyStory();
  s.rivals ??= [];
  s.conflict ??= emptyConflict();
  s.dynasty ??= emptyDynasty();
  s.succession ??= null;
  s.reign ??= null;
  const p = s.player;
  p.relationships ??= [];
  p.reputation = { ...emptyReputation(), ...(p.reputation ?? {}) };
  p.pregnancy ??= null;
  p.residency ??= {
    countryId: p.citizenship[0]!,
    status: "citizen",
    since: s.time,
    expiresAt: null,
  };
  p.visas ??= [];
  p.visaApplication ??= null;
  p.politics ??= emptyPlayerPolitics();
  p.legal ??= emptyLegal();
}
