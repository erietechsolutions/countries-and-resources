import { addDays, addYears, startOfDay, type GameTime } from "../core/calendar";
import type { Rng } from "../core/rng";
import type { CredentialId } from "../education/courses";
import type { ItemId } from "../life/items";
import type {
  ActivityState,
  DailyFlags,
  Employment,
  Enrollment,
  Finance,
  Housing,
  JobOffer,
  Needs,
} from "../life/types";
import { STARTING_AGE, type StartingHousing } from "../modes/modes";
import type { CityId, CountryId } from "../world/geography";
import {
  emptyReputation,
  type Pregnancy,
  type Relationship,
  type Reputation,
} from "../social/types";
import { emptySkills, type SkillXp } from "../work/skills";

export type Gender = "male" | "female" | "nonbinary";

export const APPEARANCE_OPTIONS = {
  skinTone: ["Very light", "Light", "Medium", "Olive", "Brown", "Dark"],
  hairColor: ["Black", "Dark brown", "Brown", "Auburn", "Red", "Blonde", "Gray"],
  hairStyle: ["Short", "Buzzed", "Medium", "Long", "Curly", "Braided", "Bald"],
  eyeColor: ["Brown", "Hazel", "Green", "Blue", "Gray"],
  build: ["Slim", "Average", "Athletic", "Heavy"],
} as const;

export type AppearanceKey = keyof typeof APPEARANCE_OPTIONS;
export type Appearance = { [K in AppearanceKey]: (typeof APPEARANCE_OPTIONS)[K][number] };

/** What the player picks in character creation. */
export interface CharacterInput {
  firstName: string;
  lastName: string;
  gender: Gender;
  appearance: Appearance;
}

export interface Character {
  id: string;
  firstName: string;
  lastName: string;
  gender: Gender;
  appearance: Appearance;
  birthTime: GameTime;
  cashCents: number;
  cityId: CityId;
  citizenship: CountryId[];
  needs: Needs;
  housing: Housing;
  skills: SkillXp;
  credentials: CredentialId[];
  education: Enrollment | null;
  job: Employment | null;
  jobOffers: JobOffer[];
  inventory: { meals: number; items: ItemId[] };
  activity: ActivityState | null;
  finance: Finance;
  prefs: { autoWork: boolean };
  daily: DailyFlags;
  /** Earliest time certain actions can be repeated, keyed by action id. */
  cooldowns: Record<string, GameTime>;
  /** A reserved shelter bed is valid until this time. */
  shelterBedUntil: GameTime | null;
  /** Whether the player is currently alive; death ends the game. */
  alive: boolean;
  relationships: Relationship[];
  reputation: Reputation;
  pregnancy: Pregnancy | null;
}

export const NAME_LIMIT = 30;

export function validateCharacterInput(input: CharacterInput): string[] {
  const errors: string[] = [];
  const first = input.firstName.trim();
  const last = input.lastName.trim();
  if (!first) errors.push("First name is required.");
  if (!last) errors.push("Last name is required.");
  if (first.length > NAME_LIMIT || last.length > NAME_LIMIT) {
    errors.push(`Names must be ${NAME_LIMIT} characters or fewer.`);
  }
  for (const key of Object.keys(APPEARANCE_OPTIONS) as AppearanceKey[]) {
    if (!(APPEARANCE_OPTIONS[key] as readonly string[]).includes(input.appearance[key])) {
      errors.push(`Invalid ${key}.`);
    }
  }
  return errors;
}

export function createPlayerCharacter(
  input: CharacterInput,
  options: {
    startTime: GameTime;
    cashCents: number;
    housing: StartingHousing;
    cityId: CityId;
    countryId: CountryId;
  },
  rng: Rng,
): Character {
  // Exactly STARTING_AGE years old on the start date, with a birthday somewhere in the past year.
  const latestBirth = addYears(options.startTime, -STARTING_AGE);
  const birthTime = addDays(latestBirth, -rng.int(0, 364));
  const homeless = options.housing === "homeless";
  return {
    id: "player",
    firstName: input.firstName.trim(),
    lastName: input.lastName.trim(),
    gender: input.gender,
    appearance: { ...input.appearance },
    birthTime: birthTime - (birthTime % 24),
    cashCents: options.cashCents,
    cityId: options.cityId,
    citizenship: [options.countryId],
    needs: homeless
      ? { food: 55, energy: 60, hygiene: 35, health: 85, happiness: 35 }
      : { food: 80, energy: 85, hygiene: 80, health: 100, happiness: 65 },
    housing: { kind: options.housing },
    skills: emptySkills(),
    credentials: ["highSchool"],
    education: null,
    job: null,
    jobOffers: [],
    inventory: { meals: homeless ? 0 : 2, items: [] },
    activity: null,
    finance: { ledger: [], debts: [], creditScore: null, nextDebtId: 1 },
    prefs: { autoWork: true },
    daily: newDailyFlags(options.startTime),
    cooldowns: {},
    shelterBedUntil: null,
    alive: true,
    relationships: [],
    reputation: emptyReputation(),
    pregnancy: null,
  };
}

export function newDailyFlags(time: GameTime): DailyFlags {
  return {
    day: startOfDay(time),
    chores: false,
    familyTalk: false,
    foodBank: false,
    jobSearch: false,
  };
}

export function fullName(c: { firstName: string; lastName: string }): string {
  return `${c.firstName} ${c.lastName}`;
}
