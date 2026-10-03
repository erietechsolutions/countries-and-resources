import { fullName } from "../character/character";
import type { GameTime } from "../core/calendar";
import type { GameState } from "../core/state";
import type { GameMode } from "../modes/modes";
import type { WorldGeography } from "../world/geography";

export const SAVE_FORMAT = "countries-and-resources-save";
/** Bump when GameState changes shape, and add a migration from the previous version. */
export const SAVE_VERSION = 1;

/** Shown in the load-game list without parsing the whole state. */
export interface SaveSummary {
  characterName: string;
  mode: GameMode;
  gameTime: GameTime;
  location: string;
  cashCents: number;
}

export interface SaveFile {
  format: typeof SAVE_FORMAT;
  version: number;
  /** Real-world ISO timestamp of when the file was written. */
  savedAt: string;
  summary: SaveSummary;
  state: GameState;
}

export class SaveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SaveError";
  }
}

/** Migrations upgrade a save from version N to N+1. */
const MIGRATIONS: Record<number, (state: unknown) => unknown> = {};

export function summarize(state: GameState, geography: WorldGeography): SaveSummary {
  const city = geography.cities[state.player.cityId];
  const country = geography.countries.find((c) => c.id === city?.countryId);
  return {
    characterName: fullName(state.player),
    mode: state.config.mode,
    gameTime: state.time,
    location: city ? `${city.name}, ${country?.name ?? city.countryId}` : "Unknown",
    cashCents: state.player.cashCents,
  };
}

export function createSaveFile(
  state: GameState,
  geography: WorldGeography,
  savedAt: string,
): SaveFile {
  return {
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    savedAt,
    summary: summarize(state, geography),
    // Deep copy so the running game can keep changing after the save is taken.
    state: JSON.parse(JSON.stringify(state)) as GameState,
  };
}

export function serializeSave(save: SaveFile): string {
  return JSON.stringify(save);
}

/** Parses and upgrades a save file. Throws SaveError if the file is not a usable save. */
export function parseSave(text: string): SaveFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new SaveError("This file is not a valid save (could not read it as JSON).");
  }
  if (!data || typeof data !== "object" || (data as SaveFile).format !== SAVE_FORMAT) {
    throw new SaveError("This file is not a Countries & Resources save.");
  }
  const save = data as SaveFile;
  if (typeof save.version !== "number" || save.version < 1) {
    throw new SaveError("This save has an unknown version.");
  }
  if (save.version > SAVE_VERSION) {
    throw new SaveError("This save was made by a newer version of the game.");
  }
  let state: unknown = save.state;
  for (let v = save.version; v < SAVE_VERSION; v++) {
    const migrate = MIGRATIONS[v];
    if (!migrate) throw new SaveError(`Cannot upgrade a version ${v} save.`);
    state = migrate(state);
  }
  const s = state as GameState;
  if (!s?.config || !s.world || !s.player || typeof s.time !== "number") {
    throw new SaveError("This save is incomplete or damaged.");
  }
  return { ...save, version: SAVE_VERSION, state: s };
}
