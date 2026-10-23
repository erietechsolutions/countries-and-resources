import type { Gender } from "../character/character";
import { randomName } from "../character/names";
import { addDays, addYears, ageInYears } from "../core/calendar";
import type { GameContext } from "../core/game";
import type { Rng } from "../core/rng";
import { cityCosts } from "../economy/costs";
import type { CityId } from "../world/geography";
import type { Person, Trait } from "./types";

const ALL_TRAITS: Trait[] = [
  "kind",
  "ambitious",
  "funny",
  "loyal",
  "greedy",
  "shy",
  "charming",
  "hotheaded",
  "honest",
  "cunning",
];
const OCCUPATIONS = [
  "Barista",
  "Nurse",
  "Teacher",
  "Mechanic",
  "Accountant",
  "Student",
  "Electrician",
  "Chef",
  "Software developer",
  "Retail worker",
  "Truck driver",
  "Graphic designer",
  "Police officer",
  "Real estate agent",
  "Musician",
  "Warehouse worker",
  "Social worker",
  "Lawyer",
  "Bartender",
  "Construction worker",
  "Unemployed",
];

export interface PersonOptions {
  cityId: CityId;
  minAge?: number;
  maxAge?: number;
  gender?: Gender;
  lastName?: string;
  occupation?: string;
  role?: Person["role"];
}

const axis = (rng: Rng) => Math.max(-1, Math.min(1, rng.normal(0, 0.5)));

/** Creates a new NPC and adds them to the world. */
export function createPerson(ctx: GameContext, opts: PersonOptions): Person {
  const s = ctx.state;
  const rng = ctx.rng;
  const gender = opts.gender ?? rng.pick<Gender>(["male", "female"]);
  const name = randomName(gender, rng);
  const age = rng.int(opts.minAge ?? 18, opts.maxAge ?? 40);
  const birth = addDays(addYears(s.time, -age), -rng.int(0, 364));
  const median = cityCosts(ctx, opts.cityId).medianWageCents * 160;
  const occupation = opts.occupation ?? rng.pick(OCCUPATIONS);
  const traits = rng.shuffle([...ALL_TRAITS]).slice(0, 2);
  const person: Person = {
    id: `n${s.nextPersonId++}`,
    firstName: name.firstName,
    lastName: opts.lastName ?? name.lastName,
    gender,
    birthTime: birth - (birth % 24),
    cityId: opts.cityId,
    occupation,
    incomeCents:
      occupation === "Unemployed" || occupation === "Student"
        ? 0
        : Math.round(median * Math.exp(rng.normal(0, 0.4))),
    traits,
    ideology: {
      economic: axis(rng),
      social: axis(rng),
      authority: axis(rng),
      nationalism: axis(rng),
    },
    alive: true,
    role: opts.role,
  };
  s.people.push(person);
  return person;
}

export function personById(ctx: GameContext, id: string): Person | undefined {
  return ctx.state.people.find((p) => p.id === id);
}

export function personAge(ctx: GameContext, person: Person): number {
  return ageInYears(person.birthTime, ctx.state.time);
}

export function personName(person: { firstName: string; lastName: string }): string {
  return `${person.firstName} ${person.lastName}`;
}
