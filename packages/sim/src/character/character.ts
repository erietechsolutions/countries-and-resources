import { addDays, addYears, type GameTime } from "../core/calendar";
import type { Rng } from "../core/rng";
import { STARTING_AGE, type StartingHousing } from "../modes/modes";
import type { CityId, CountryId } from "../world/geography";

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

export type Housing = StartingHousing;

export interface Character {
  id: string;
  firstName: string;
  lastName: string;
  gender: Gender;
  appearance: Appearance;
  birthTime: GameTime;
  cashCents: number;
  housing: Housing;
  cityId: CityId;
  citizenship: CountryId[];
  /** 0–100. Needs, skills and the rest of the life simulation arrive in M4/M5. */
  health: number;
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
    housing: Housing;
    cityId: CityId;
    countryId: CountryId;
  },
  rng: Rng,
): Character {
  // Exactly STARTING_AGE years old on the start date, with a birthday somewhere in the past year.
  const latestBirth = addYears(options.startTime, -STARTING_AGE);
  const birthTime = addDays(latestBirth, -rng.int(0, 364));
  return {
    id: "player",
    firstName: input.firstName.trim(),
    lastName: input.lastName.trim(),
    gender: input.gender,
    appearance: { ...input.appearance },
    birthTime: birthTime - (birthTime % 24),
    cashCents: options.cashCents,
    housing: options.housing,
    cityId: options.cityId,
    citizenship: [options.countryId],
    health: options.housing === "homeless" ? 85 : 100,
  };
}

export function fullName(c: { firstName: string; lastName: string }): string {
  return `${c.firstName} ${c.lastName}`;
}
