import type { Character } from "../character/character";
import type { FamilyMember } from "../life/types";
import type { Business } from "../business/business";
import type { Rival } from "../ai/rivals";
import type { ConflictState } from "../conflict/types";
import type { StoryState } from "../events/storyEvents";
import type { DynastyState, PendingSuccession } from "../life/aging";
import type { Reign } from "../leader/leader";
import type { MarketsState, WealthState } from "../wealth/types";
import type { PoliticsState } from "../politics/types";
import type { Person } from "../social/types";
import type { GameConfig } from "../modes/modes";
import type { WorldState } from "../world/types";
import type { GameTime } from "./calendar";
import type { LogEntry } from "./events";

/** The complete, serializable state of one game. Everything in here goes into a save file. */
export interface GameState {
  config: GameConfig;
  time: GameTime;
  rngState: number;
  world: WorldState;
  player: Character;
  family: FamilyMember[];
  /** Notable NPCs: friends, partners, coworkers, politicians, rivals. */
  people: Person[];
  nextPersonId: number;
  /** Businesses founded by the player (including closed ones, for history). */
  businesses: Business[];
  politics: PoliticsState;
  story: StoryState;
  rivals: Rival[];
  /** Militias, uprisings, wars and diplomacy. */
  conflict: ConflictState;
  /** The family line, across characters. */
  dynasty: DynastyState;
  /** Set while the player's character is dead and an heir hasn't been chosen. */
  succession: PendingSuccession | null;
  /** Leader mode: the player's time in power. */
  reign: Reign | null;
  /** The player's savings, investments, property and media. */
  wealth: WealthState;
  /** Stock indexes, commodity prices and the rich list. */
  markets: MarketsState;
  nextBusinessId: number;
  /** Most recent messages, newest last. */
  log: LogEntry[];
}

export const MAX_LOG_ENTRIES = 200;
