import {
  createPlayerCharacter,
  validateCharacterInput,
  type CharacterInput,
} from "./character/character";
import { Game } from "./core/game";
import { Rng } from "./core/rng";
import type { GameState } from "./core/state";
import { LEADER_STARTING_AGE, MODES, validateConfig, type GameConfig } from "./modes/modes";
import type { WorldGeography } from "./world/geography";
import { emptyConflict } from "./conflict/types";
import { emptyStory } from "./events/storyEvents";
import { emptyDynasty } from "./life/aging";
import { startReign } from "./leader/leader";
import { emptyMarkets } from "./wealth/markets";
import { emptyWealth } from "./wealth/types";
import { generateFamily } from "./life/family";
import { emptyPolitics } from "./politics/types";
import { formatMoney } from "./world/format";
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
  const problems = [
    ...validateConfig(config, geography),
    ...validateCharacterInput(setup.character),
  ];
  if (problems.length > 0) throw new NewGameError(problems);

  const rng = Rng.fromKey(config.worldSeed, "player");
  const leader = !MODES[config.mode].life;
  const worldState = world ?? buildWorld(config, geography);
  let city = geography.cities[config.startCityId]!;
  if (leader) {
    // Leaders govern from the capital of the country they picked.
    const geoCountry = geography.countries.find((c) => c.id === city.countryId)!;
    if (geoCountry.capitalCityId === null || !worldState.countries[geoCountry.id]?.population)
      throw new NewGameError(["Choose an inhabited country with a capital to lead."]);
    city = geography.cities[geoCountry.capitalCityId]!;
  }
  const player = createPlayerCharacter(
    setup.character,
    {
      startTime: config.startTime,
      cashCents: config.startingCashCents,
      housing: config.startingHousing,
      cityId: city.id,
      countryId: city.countryId,
      age: leader ? LEADER_STARTING_AGE : undefined,
    },
    rng,
  );

  const state: GameState = {
    config: { ...config, startCityId: city.id },
    // Days begin at 8 AM for the player; the calendar date is the configured start date.
    time: config.startTime + 8,
    rngState: Rng.fromKey(config.worldSeed, "simulation").state,
    world: worldState,
    player,
    family: generateFamily(
      player.lastName,
      city.id,
      player.housing.kind === "homeless",
      Rng.fromKey(config.worldSeed, "family"),
    ),
    people: [],
    nextPersonId: 1,
    businesses: [],
    politics: emptyPolitics(),
    story: emptyStory(),
    rivals: [],
    conflict: emptyConflict(),
    dynasty: emptyDynasty(),
    succession: null,
    reign: null,
    wealth: emptyWealth(),
    markets: emptyMarkets(),
    nextBusinessId: 1,
    log: [],
  };

  const game = new Game(state, geography);
  const country = geography.countries.find((c) => c.id === city.countryId)!;
  const where = `${city.name}, ${country.name}`;
  const cash = formatMoney(player.cashCents, true);
  if (leader) {
    startReign(game);
    return game;
  }
  game.log(
    "life",
    player.housing.kind === "homeless"
      ? `You wake up on the streets of ${where}. You are 18, with ${cash} to your name.`
      : `You wake up in your parents' basement in ${where}. You are 18, with ${cash} to your name.`,
  );
  return game;
}
