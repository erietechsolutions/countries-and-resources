import type { Gender } from "../character/character";
import { randomName } from "../character/names";
import { addDays, ageInYears, startOfDay, type GameTime } from "../core/calendar";
import type { GameContext } from "../core/game";
import type { System } from "../core/systems";
import { cityCosts } from "../economy/costs";
import { transact } from "../finance/finance";
import { formatMoney } from "../world/format";
import { createPerson, personName } from "./people";
import type { Trait } from "./types";

/** The in-game dating app. */
export const DATING_APP = "Spark";

export type Seeking = "men" | "women" | "everyone";

export const SEEKING_LABELS: Record<Seeking, string> = {
  men: "Men",
  women: "Women",
  everyone: "Everyone",
};

export interface DatingProfile {
  id: string;
  firstName: string;
  lastName: string;
  gender: Gender;
  age: number;
  occupation: string;
  traits: Trait[];
  bio: string;
}

export interface DatingState {
  active: boolean;
  seeking: Seeking;
  /** Today's profiles, waiting for a like or a pass. */
  profiles: DatingProfile[];
  refreshedDay: GameTime;
  premiumUntil: GameTime | null;
  /** Lifetime matches, for the app's stats. */
  matches: number;
  nextId: number;
}

export function emptyDating(): DatingState {
  return {
    active: false,
    seeking: "everyone",
    profiles: [],
    refreshedDay: 0,
    premiumUntil: null,
    matches: 0,
    nextId: 1,
  };
}

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

const TRAIT_BIOS: Record<Trait, string> = {
  kind: "Volunteer on weekends, soft spot for stray dogs.",
  ambitious: "Building something big. Looking for someone who gets it.",
  funny: "Will make you laugh at least once. Probably at me.",
  loyal: "Ride or die. Still friends with my kindergarten crew.",
  greedy: "Expensive taste. Prove you can keep up.",
  shy: "Better in person than in chat, promise.",
  charming: "Ask me about the time I talked my way backstage.",
  hotheaded: "Passionate about everything. Yes, everything.",
  honest: "No games. Say what you mean.",
  cunning: "I always win at board games. Fair warning.",
};

const OCCUPATIONS = [
  "Nurse",
  "Teacher",
  "Software developer",
  "Chef",
  "Accountant",
  "Graphic designer",
  "Student",
  "Mechanic",
  "Lawyer",
  "Bartender",
  "Real estate agent",
  "Musician",
  "Personal trainer",
  "Pharmacist",
  "Architect",
];

export function premiumCost(ctx: GameContext): number {
  return cityCosts(ctx, ctx.state.player.cityId).medianWageCents * 15;
}

function premium(ctx: GameContext): boolean {
  return (ctx.state.dating.premiumUntil ?? 0) > ctx.state.time;
}

function genderFor(ctx: GameContext, seeking: Seeking): Gender {
  if (seeking === "men") return "male";
  if (seeking === "women") return "female";
  return ctx.rng.pick<Gender>(["male", "female"]);
}

/** Today's batch of people near the player, close to their age. */
function refreshProfiles(ctx: GameContext): void {
  const d = ctx.state.dating;
  const age = ageInYears(ctx.state.player.birthTime, ctx.state.time);
  const count = premium(ctx) ? 12 : 5;
  d.profiles = Array.from({ length: count }, () => {
    const gender = genderFor(ctx, d.seeking);
    const name = randomName(gender, ctx.rng);
    const traits = ctx.rng.shuffle([...ALL_TRAITS]).slice(0, 2);
    return {
      id: `dp${d.nextId++}`,
      firstName: name.firstName,
      lastName: name.lastName,
      gender,
      age: Math.max(18, age + ctx.rng.int(-6, 6)),
      occupation: ctx.rng.pick(OCCUPATIONS),
      traits,
      bio: TRAIT_BIOS[traits[0]!],
    };
  });
  d.refreshedDay = startOfDay(ctx.state.time);
}

/** How likely a like turns into a match. */
export function matchChance(ctx: GameContext, profile: DatingProfile): number {
  const p = ctx.state.player;
  const n = p.needs;
  let chance =
    0.15 + n.hygiene / 400 + n.happiness / 500 + p.reputation.fame / 400 + (p.job ? 0.05 : 0);
  if (p.lifestyle === "comfortable") chance += 0.04;
  if (p.lifestyle === "luxury") chance += 0.08;
  if (p.housing.kind === "homeless") chance -= 0.1;
  if (premium(ctx)) chance += 0.1;
  if (profile.traits.includes("shy")) chance -= 0.05;
  if (profile.traits.includes("greedy")) chance += p.lifestyle === "luxury" ? 0.1 : -0.05;
  return Math.max(0.03, Math.min(0.8, chance));
}

export function joinDating(ctx: GameContext, seeking: Seeking): string | null {
  const p = ctx.state.player;
  if (!p.inventory.items.includes("phone")) return `You need a phone to use ${DATING_APP}.`;
  if (!SEEKING_LABELS[seeking]) return "Choose who you're looking for.";
  const d = ctx.state.dating;
  d.active = true;
  d.seeking = seeking;
  refreshProfiles(ctx);
  ctx.log("life", `You made a profile on ${DATING_APP}.`);
  return null;
}

export function leaveDating(ctx: GameContext): string | null {
  const d = ctx.state.dating;
  if (!d.active) return `You're not on ${DATING_APP}.`;
  d.active = false;
  d.profiles = [];
  ctx.log("life", `You deleted your ${DATING_APP} profile.`);
  return null;
}

export function buyPremium(ctx: GameContext): string | null {
  const d = ctx.state.dating;
  if (!d.active) return `Make a ${DATING_APP} profile first.`;
  const cost = premiumCost(ctx);
  if (cost > ctx.state.player.cashCents)
    return `${DATING_APP} Premium costs ${formatMoney(cost, true)}.`;
  transact(ctx, -cost, "shopping", `${DATING_APP} Premium (30 days)`);
  d.premiumUntil = addDays(Math.max(ctx.state.time, d.premiumUntil ?? 0), 30);
  ctx.log("life", `${DATING_APP} Premium: more profiles and a better shot at matching.`);
  return null;
}

/** Like or pass on a profile. A match becomes someone you know, ready for a first date. */
export function swipe(ctx: GameContext, profileId: string, like: boolean): string | null {
  const d = ctx.state.dating;
  const profile = d.profiles.find((x) => x.id === profileId);
  if (!profile) return "That profile is gone.";
  d.profiles = d.profiles.filter((x) => x !== profile);
  if (!like) return null;
  if (!ctx.rng.chance(matchChance(ctx, profile))) {
    ctx.log("life", `No match with ${profile.firstName} this time.`);
    return null;
  }
  const p = ctx.state.player;
  const person = createPerson(ctx, {
    cityId: p.cityId,
    minAge: profile.age,
    maxAge: profile.age,
    gender: profile.gender,
    lastName: profile.lastName,
    occupation: profile.occupation,
  });
  person.firstName = profile.firstName;
  person.traits = [...profile.traits];
  p.relationships.push({
    personId: person.id,
    kind: "acquaintance",
    affection: ctx.rng.int(20, 35),
    romance: ctx.rng.int(35, 55),
    metAt: ctx.state.time,
    lastContact: ctx.state.time,
    context: `matched on ${DATING_APP}`,
  });
  d.matches++;
  ctx.alert(
    "good",
    `It's a match! ${personName(person)} likes you too. Ask them out from the People tab.`,
  );
  return null;
}

/** New profiles every morning while the player has the app. */
export const datingSystem: System = {
  id: "dating",
  onDay(ctx) {
    const d = ctx.state.dating;
    if (d.active && ctx.state.player.alive) refreshProfiles(ctx);
  },
};
