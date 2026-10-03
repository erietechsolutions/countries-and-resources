import {
  createPlayerCharacter,
  fullName,
  validateCharacterInput,
  type CharacterInput,
} from "./character/character";
import { formatDate } from "./core/calendar";
import { Game } from "./core/game";
import { Rng } from "./core/rng";
import type { GameState } from "./core/state";
import { MODES, validateConfig, type GameConfig } from "./modes/modes";
import type { WorldGeography } from "./world/geography";
import type { WorldState } from "./world/types";
import { generateWorld } from "./worldgen/proceduralWorld";

export interface NewGameSetup {
  config: GameConfig;
  character: CharacterInput;
}

export class NewGameError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join(" "));
    this.name = "NewGameError";
  }
}

/** Builds the world for a config. Deterministic: the same config always yields the same world. */
export function buildWorld(config: GameConfig, geography: WorldGeography): WorldState {
  const mode = MODES[config.mode];
  if (mode.worldData === "historical") {
    throw new NewGameError(["Historical world data is not available yet (Normal mode)."]);
  }
  return generateWorld(geography, config.worldSeed);
}

/**
 * Creates a new game from the wizard's choices.
 * Pass `world` if it was already generated (e.g. for the location picker) to skip regenerating it.
 */
export function createNewGame(
  setup: NewGameSetup,
  geography: WorldGeography,
  world?: WorldState,
): Game {
  const { config } = setup;
  const problems = [...validateConfig(config, geography), ...validateCharacterInput(setup.character)];
  if (problems.length > 0) throw new NewGameError(problems);

  const rng = Rng.fromKey(config.worldSeed, "player");
  const city = geography.cities[config.startCityId]!;
  const player = createPlayerCharacter(
    setup.character,
    {
      startTime: config.startTime,
      cashCents: config.startingCashCents,
      housing: config.startingHousing,
      cityId: city.id,
      countryId: city.countryId,
    },
    rng,
  );

  const state: GameState = {
    config: { ...config },
    // Days begin at 8 AM for the player; the calendar date is the configured start date.
    time: config.startTime + 8,
    rngState: Rng.fromKey(config.worldSeed, "simulation").state,
    world: world ?? buildWorld(config, geography),
    player,
    log: [],
  };

  const game = new Game(state, geography);
  const country = geography.countries.find((c) => c.id === city.countryId)!;
  const where = `${city.name}, ${country.name}`;
  game.log(
    "life",
    player.housing === "homeless"
      ? `${fullName(player)} wakes up on the streets of ${where} on ${formatDate(state.time)}.`
      : `${fullName(player)} wakes up in their parents' basement in ${where} on ${formatDate(state.time)}.`,
  );
  return game;
}
