import type { GameTime } from "../core/calendar";
import type { CityId, WorldGeography } from "../world/geography";

export type GameMode = "normal" | "economic" | "hardEconomic";
export type MapType = "real" | "random";
export type StartingHousing = "parents" | "homeless";

export const STARTING_AGE = 18;

/** One selectable value for a new-game option. */
export interface ChoiceOption<T> {
  value: T;
  label: string;
  description: string;
  /** False = shown but grayed out (e.g. "Coming Soon"). */
  available: boolean;
  unavailableLabel?: string;
}

export interface ModeDefinition {
  id: GameMode;
  name: string;
  tagline: string;
  description: string;
  available: boolean;
  unavailableLabel?: string;
  /** "creationDate" = the real date the save is created; "historical" = a fixed start year. */
  startDate: "creationDate" | "historical";
  historicalStartDates?: { time: GameTime; label: string }[];
  worldData: "procedural" | "historical";
  /** Where the player may start. */
  startRegion: "anywhere" | "unitedStates";
  /** A single option means the choice is locked by the mode. */
  startingCash: ChoiceOption<number>[];
  startingHousing: ChoiceOption<StartingHousing>[];
  mapTypes: ChoiceOption<MapType>[];
}

const CASH_2000: ChoiceOption<number> = {
  value: 200_000,
  label: "$2,000",
  description: "A small cushion of savings to get started.",
  available: true,
};
const CASH_0: ChoiceOption<number> = {
  value: 0,
  label: "$0",
  description: "Nothing in the bank. Every dollar has to be earned.",
  available: true,
};
const HOUSING_PARENTS: ChoiceOption<StartingHousing> = {
  value: "parents",
  label: "Parents' house",
  description: "Living in your parents' basement: a roof, food, and family expectations.",
  available: true,
};
const HOUSING_HOMELESS: ChoiceOption<StartingHousing> = {
  value: "homeless",
  label: "Homeless",
  description: "On the street with no address. Survival comes first.",
  available: true,
};
const MAP_REAL: ChoiceOption<MapType> = {
  value: "real",
  label: "Real World",
  description: "Earth's real countries, borders and cities, with generated economies and politics.",
  available: true,
};
const MAP_RANDOM: ChoiceOption<MapType> = {
  value: "random",
  label: "Random World",
  description: "A newly generated planet with its own continents, nations and names.",
  available: false,
  unavailableLabel: "Coming Soon",
};

export const MODES: Record<GameMode, ModeDefinition> = {
  normal: {
    id: "normal",
    name: "Normal",
    tagline: "Real history, real economy",
    description:
      "Start in January 2022 or January 2024 in any of the 50 US states, with the real economy " +
      "of that year. History diverges from there based on your choices.",
    available: false,
    unavailableLabel: "Coming Soon",
    startDate: "historical",
    historicalStartDates: [
      { time: Date.UTC(2022, 0, 1) / 3_600_000, label: "January 2022" },
      { time: Date.UTC(2024, 0, 1) / 3_600_000, label: "January 2024" },
    ],
    worldData: "historical",
    startRegion: "unitedStates",
    startingCash: [CASH_2000, CASH_0],
    startingHousing: [HOUSING_PARENTS, HOUSING_HOMELESS],
    mapTypes: [MAP_REAL],
  },
  economic: {
    id: "economic",
    name: "Economic",
    tagline: "A generated world, starting today",
    description:
      "Starts on the day you create the save. Economies, governments and parties are generated " +
      "for this world. Start anywhere.",
    available: true,
    startDate: "creationDate",
    worldData: "procedural",
    startRegion: "anywhere",
    startingCash: [CASH_2000, CASH_0],
    startingHousing: [HOUSING_PARENTS, HOUSING_HOMELESS],
    mapTypes: [MAP_REAL, MAP_RANDOM],
  },
  hardEconomic: {
    id: "hardEconomic",
    name: "Hard Economic",
    tagline: "Nothing. Nobody. Nowhere to sleep.",
    description:
      "Economic mode with no safety net: you start at 18 with $0, homeless, on the real-world map.",
    available: true,
    startDate: "creationDate",
    worldData: "procedural",
    startRegion: "anywhere",
    startingCash: [CASH_0],
    startingHousing: [HOUSING_HOMELESS],
    mapTypes: [MAP_REAL],
  },
};

export const MODE_ORDER: GameMode[] = ["normal", "economic", "hardEconomic"];

/** Everything chosen in the new-game wizard that defines a world. Stored in every save. */
export interface GameConfig {
  mode: GameMode;
  mapType: MapType;
  geographyId: string;
  worldSeed: number;
  startTime: GameTime;
  startingCashCents: number;
  startingHousing: StartingHousing;
  startCityId: CityId;
}

export function isLocked<T>(options: ChoiceOption<T>[]): boolean {
  return options.length === 1;
}

/** The first available option, used as the wizard's default. */
export function defaultChoice<T>(options: ChoiceOption<T>[]): T {
  const choice = options.find((o) => o.available) ?? options[0];
  if (!choice) throw new Error("Mode has no options");
  return choice.value;
}

function checkChoice<T>(name: string, options: ChoiceOption<T>[], value: T, errors: string[]) {
  const option = options.find((o) => o.value === value);
  if (!option) errors.push(`${name} "${String(value)}" is not allowed in this mode.`);
  else if (!option.available) errors.push(`${name} "${option.label}" is not available yet.`);
}

/** Returns a list of problems with a config; an empty list means the config is valid. */
export function validateConfig(config: GameConfig, geography?: WorldGeography): string[] {
  const errors: string[] = [];
  const mode = MODES[config.mode];
  if (!mode) return [`Unknown game mode "${config.mode}".`];
  if (!mode.available) errors.push(`${mode.name} mode is not available yet.`);

  checkChoice("Starting cash", mode.startingCash, config.startingCashCents, errors);
  checkChoice("Starting housing", mode.startingHousing, config.startingHousing, errors);
  checkChoice("Map type", mode.mapTypes, config.mapType, errors);

  if (mode.startDate === "historical") {
    const allowed = mode.historicalStartDates?.some((d) => d.time === config.startTime);
    if (!allowed) errors.push("Start date is not one of this mode's historical start dates.");
  }
  if (!Number.isInteger(config.startTime)) errors.push("Start time must be a whole hour.");
  if (!Number.isInteger(config.worldSeed) || config.worldSeed < 0) {
    errors.push("World seed must be a non-negative integer.");
  }

  if (geography) {
    if (geography.id !== config.geographyId) errors.push("Geography does not match the config.");
    const city = geography.cities[config.startCityId];
    if (!city) {
      errors.push("Starting city does not exist.");
    } else {
      const country = geography.countries.find((c) => c.id === city.countryId);
      if (!country?.habitable) errors.push("Cannot start in an uninhabitable territory.");
      if (mode.startRegion === "unitedStates" && city.countryId !== "USA") {
        errors.push("This mode requires starting in one of the 50 US states.");
      }
    }
  }
  return errors;
}
