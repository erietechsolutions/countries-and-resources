import { businessById } from "../business/business";
import { canWorkLegally } from "./moving";
import { newDailyFlags } from "../character/character";
import { startOfDay, toDateParts } from "../core/calendar";
import type { GameContext } from "../core/game";
import type { System } from "../core/systems";
import { cityCosts, countryOf } from "../economy/costs";
import { courseById } from "../education/courses";
import { addMedicalDebt, transact } from "../finance/finance";
import { formatMoney } from "../world/format";
import { PHASE_DEMAND } from "../work/companies";
import { leaveJob, recordMissedShift, searchForJobs, shiftStartsNow } from "../work/jobs";
import { occupationById } from "../work/occupations";
import type { SkillId } from "../work/skills";
import { averageRelationship, changeRelationship } from "./family";
import { applyHourlyNeeds, restingPlace, sleepRate, type DecayingNeed } from "./needs";
import { personById, personName } from "../social/people";
import {
  adjustReputation,
  changeAffection,
  isRomantic,
  meetPerson,
  relationshipWith,
} from "../social/social";
import type { Relationship } from "../social/types";
import type { LedgerCategory, Needs } from "./types";

export type ActivityCategory =
  "rest" | "food" | "hygiene" | "home" | "social" | "work" | "money" | "growth";

export const CATEGORY_LABELS: Record<ActivityCategory, string> = {
  rest: "Rest",
  food: "Food",
  hygiene: "Hygiene",
  home: "Home & family",
  social: "Social life",
  work: "Work",
  money: "Make money",
  growth: "Self-improvement",
};

export interface AmountOption {
  label: string;
  min: number;
  max(ctx: GameContext): number;
  default(ctx: GameContext): number;
}

export interface ActivityDef {
  id: string;
  label: string;
  category: ActivityCategory;
  description: string;
  /** Started by the game, not chosen by the player (work shifts, hospital stays...). */
  system?: boolean;
  /** Can be cancelled, or replaced when a work shift starts. */
  interruptible: boolean;
  hours(ctx: GameContext, amount?: number): number;
  amount?: AmountOption;
  /** Cash charged when starting. */
  cost?(ctx: GameContext, amount?: number): number;
  costCategory?: LedgerCategory;
  /** Why the activity can't be started right now, or null. */
  unavailable?(ctx: GameContext): string | null;
  /** Multipliers on normal hourly need decay. */
  decay?: Partial<Record<DecayingNeed, number>>;
  /** Need changes per hour, on top of normal decay. */
  effects?(ctx: GameContext): Partial<Needs>;
  /** Activities done with someone: why this relationship doesn't allow it, or null. */
  target?(ctx: GameContext, relationship: Relationship): string | null;
  /** Activities aimed at one of the player's businesses (the target id is the business id). */
  businessTarget?: boolean;
  onStart?(ctx: GameContext, amount?: number): void;
  onHour?(ctx: GameContext): void;
  onFinish?(ctx: GameContext, amount?: number, targetId?: string): void;
}

const hourNow = (ctx: GameContext) => toDateParts(ctx.state.time).hour;

function fmtHour(h: number): string {
  const hour = h % 24;
  return `${hour % 12 === 0 ? 12 : hour % 12} ${hour < 12 ? "AM" : "PM"}`;
}

function during(from: number, to: number) {
  return (ctx: GameContext): string | null => {
    const h = hourNow(ctx);
    return h >= from && h < to ? null : `Only between ${fmtHour(from)} and ${fmtHour(to)}.`;
  };
}

function all(...checks: ((ctx: GameContext) => string | null)[]) {
  return (ctx: GameContext) => {
    for (const c of checks) {
      const r = c(ctx);
      if (r) return r;
    }
    return null;
  };
}

const atHome = (ctx: GameContext) =>
  ctx.state.player.housing.kind === "homeless" ? "You don't have a home." : null;
const withParents = (ctx: GameContext) =>
  ctx.state.player.housing.kind === "parents" ? null : "Only while living with your parents.";
const hasItem = (item: string, name: string) => (ctx: GameContext) =>
  (ctx.state.player.inventory.items as string[]).includes(item) ? null : `Requires a ${name}.`;

/** How many home-cooked meals the player can store. */
export function mealCapacity(ctx: GameContext): number {
  const p = ctx.state.player;
  if (p.housing.kind !== "homeless") return 21;
  return p.inventory.items.includes("backpack") ? 6 : 2;
}

function addXp(ctx: GameContext, gains: Partial<Record<SkillId, number>>): void {
  const skills = ctx.state.player.skills;
  for (const [k, v] of Object.entries(gains)) skills[k as SkillId] += v ?? 0;
}

function earn(ctx: GameContext, cents: number, category: LedgerCategory, what: string): void {
  if (cents <= 0) return;
  transact(ctx, cents, category, what);
}

function demand(ctx: GameContext): number {
  return PHASE_DEMAND[countryOf(ctx, ctx.state.player.cityId).economy.phase];
}

/** Robbery risk when sleeping without a roof; safer in stable places. */
function streetRobbery(ctx: GameContext, hours: number): void {
  const p = ctx.state.player;
  if (restingPlace(ctx) !== "street" || p.cashCents <= 0) return;
  const stability = countryOf(ctx, p.cityId).stability;
  if (!ctx.rng.chance(0.07 * (1 - stability / 140) * (hours / 8))) return;
  const stolen = Math.round(p.cashCents * ctx.rng.float(0.3, 1));
  transact(ctx, -stolen, "theft", "Robbed while sleeping");
  p.needs.happiness = Math.max(0, p.needs.happiness - 15);
  ctx.alert("bad", `You were robbed while you slept. ${formatMoney(stolen)} was taken.`);
}

/** Time spent with someone: more affection the first time each day, and it keeps the friendship alive. */
function socialBoost(
  ctx: GameContext,
  targetId: string | undefined,
  affection: number,
  romance: number,
): void {
  if (!targetId) return;
  const r = relationshipWith(ctx.state.player, targetId);
  if (!r) return;
  const sameDay =
    startOfDay(r.lastContact) === startOfDay(ctx.state.time) && r.lastContact !== r.metAt;
  const scale = sameDay ? 0.3 : 1;
  const person = personById(ctx, targetId);
  const kindBonus = person?.traits.includes("kind") || person?.traits.includes("loyal") ? 1.2 : 1;
  changeAffection(
    ctx,
    r,
    affection * scale * kindBonus,
    isRomantic(r) || r.romance > 20 ? romance * scale : 0,
  );
  r.lastContact = ctx.state.time;
}

/** The shift hours remaining right now, if the player is due at work. */
function shiftHoursLeft(ctx: GameContext): number {
  const job = ctx.state.player.job;
  if (!job) return 0;
  const shift = occupationById(job.occupationId).shift;
  const now = ctx.state.time;
  for (let back = 0; back < 2; back++) {
    if (shiftStartsNow(occupationById(job.occupationId), now - back)) {
      if (ctx.state.player.cooldowns.workedShift === now - back) return 0;
      return shift.hours - back;
    }
  }
  return 0;
}

function currentShiftStart(ctx: GameContext): number | null {
  const job = ctx.state.player.job;
  if (!job) return null;
  for (let back = 0; back < 2; back++) {
    if (shiftStartsNow(occupationById(job.occupationId), ctx.state.time - back))
      return ctx.state.time - back;
  }
  return null;
}

export const ACTIVITIES: ActivityDef[] = [
  // ---- Rest
  {
    id: "sleep",
    label: "Sleep",
    category: "rest",
    description:
      "Sleep restores energy. A bed is better than a shelter cot, and both beat the street.",
    interruptible: true,
    amount: {
      label: "Hours",
      min: 1,
      max: () => 12,
      // Default: sleep until about 7 AM, between 6 and 10 hours.
      default: (ctx) => Math.max(6, Math.min(10, (31 - hourNow(ctx)) % 24 || 8)),
    },
    hours: (_ctx, amount) => amount ?? 8,
    decay: { food: 0.45, energy: 0, hygiene: 0.5 },
    effects: (ctx) => {
      const street = restingPlace(ctx) === "street";
      const bag = ctx.state.player.inventory.items.includes("sleepingBag");
      return street
        ? { energy: sleepRate(ctx), health: bag ? -0.1 : -0.35, happiness: -0.5 }
        : { energy: sleepRate(ctx) };
    },
    onFinish: (ctx, amount) => streetRobbery(ctx, amount ?? 8),
  },
  {
    id: "wait",
    label: "Wait",
    category: "rest",
    description: "Let time pass.",
    interruptible: true,
    amount: { label: "Hours", min: 1, max: () => 12, default: () => 1 },
    hours: (_ctx, amount) => amount ?? 1,
  },
  {
    id: "relax",
    label: "Relax at home",
    category: "rest",
    description: "Watch TV, read, unwind.",
    interruptible: true,
    hours: () => 2,
    unavailable: atHome,
    effects: () => ({ happiness: 5 }),
  },
  {
    id: "walk",
    label: "Go for a walk",
    category: "rest",
    description: "Fresh air clears your head.",
    interruptible: true,
    hours: () => 1,
    effects: () => ({ happiness: 3, health: 0.4, energy: -1 }),
  },
  {
    id: "exercise",
    label: "Work out",
    category: "rest",
    description: "Builds health over time. Tiring and sweaty.",
    interruptible: true,
    hours: () => 1,
    effects: () => ({ health: 1.5, energy: -6, hygiene: -8, happiness: 3 }),
  },

  // ---- Food
  {
    id: "eat",
    label: "Eat a meal",
    category: "food",
    description:
      "Eat a home-cooked meal from your groceries. At your parents' place, family meals are free.",
    interruptible: true,
    hours: () => 1,
    unavailable: (ctx) => {
      const p = ctx.state.player;
      if (p.housing.kind === "parents") return null;
      return p.inventory.meals > 0 ? null : "You have no food. Buy groceries first.";
    },
    effects: () => ({ food: 45, happiness: 2 }),
    onStart: (ctx) => {
      const p = ctx.state.player;
      if (p.housing.kind !== "parents") p.inventory.meals--;
    },
  },
  {
    id: "groceries",
    label: "Buy groceries",
    category: "food",
    description: "The cheapest way to eat. Without a home you can only carry a few meals.",
    interruptible: true,
    amount: {
      label: "Meals",
      min: 1,
      max: (ctx) => Math.max(1, mealCapacity(ctx) - ctx.state.player.inventory.meals),
      default: (ctx) =>
        Math.max(1, Math.min(7, mealCapacity(ctx) - ctx.state.player.inventory.meals)),
    },
    hours: () => 1,
    unavailable: all(during(7, 22), (ctx) =>
      ctx.state.player.inventory.meals >= mealCapacity(ctx)
        ? "You can't carry any more food."
        : null,
    ),
    cost: (ctx, amount) => cityCosts(ctx, ctx.state.player.cityId).mealCents * (amount ?? 1),
    costCategory: "food",
    onFinish: (ctx, amount) => {
      const p = ctx.state.player;
      p.inventory.meals = Math.min(mealCapacity(ctx), p.inventory.meals + (amount ?? 1));
    },
  },
  {
    id: "fastFood",
    label: "Eat fast food",
    category: "food",
    description: "Quick and filling, but pricey and not great for you.",
    interruptible: true,
    hours: () => 1,
    unavailable: during(6, 24),
    cost: (ctx) => cityCosts(ctx, ctx.state.player.cityId).fastFoodCents,
    costCategory: "food",
    effects: () => ({ food: 50, happiness: 3, health: -0.5 }),
  },
  {
    id: "soupKitchen",
    label: "Soup kitchen",
    category: "food",
    description: "A free hot meal. Open for lunch and dinner.",
    interruptible: true,
    hours: () => 2,
    unavailable: (ctx) => {
      const h = hourNow(ctx);
      return (h >= 11 && h < 13) || (h >= 17 && h < 19) ? null : "Open 11 AM–1 PM and 5–7 PM.";
    },
    effects: () => ({ food: 24, happiness: -0.5 }),
  },
  {
    id: "foodBank",
    label: "Visit a food bank",
    category: "food",
    description: "Free groceries, once a day, where social services exist.",
    interruptible: true,
    hours: () => 2,
    unavailable: all(during(9, 16), (ctx) => {
      if (countryOf(ctx, ctx.state.player.cityId).socialServices < 0.3)
        return "There are no food banks here.";
      if (ctx.state.player.daily.foodBank) return "You've already been today.";
      return ctx.state.player.inventory.meals >= mealCapacity(ctx)
        ? "You can't carry any more food."
        : null;
    }),
    onStart: (ctx) => {
      ctx.state.player.daily.foodBank = true;
    },
    onFinish: (ctx) => {
      const p = ctx.state.player;
      p.inventory.meals = Math.min(mealCapacity(ctx), p.inventory.meals + 3);
    },
  },
  {
    id: "dumpster",
    label: "Search dumpsters for food",
    category: "food",
    description: "Free, fast, and risky: you might get food poisoning.",
    interruptible: true,
    hours: () => 1,
    effects: () => ({ food: 20, happiness: -5, hygiene: -6 }),
    onFinish: (ctx) => {
      if (ctx.rng.chance(0.22)) {
        ctx.state.player.needs.health = Math.max(0, ctx.state.player.needs.health - 15);
        ctx.alert("bad", "You got food poisoning from spoiled food.");
      }
    },
  },

  // ---- Hygiene
  {
    id: "shower",
    label: "Shower",
    category: "hygiene",
    description: "At home, or at the shelter if you have a bed there tonight.",
    interruptible: true,
    hours: () => 1,
    unavailable: (ctx) =>
      restingPlace(ctx) === "street"
        ? "You need a home or a shelter bed to shower for free."
        : null,
    effects: () => ({ hygiene: 70, happiness: 2 }),
  },
  {
    id: "gymShower",
    label: "Gym day pass",
    category: "hygiene",
    description: "Pay for a day pass to use the gym showers.",
    interruptible: true,
    hours: () => 1,
    unavailable: during(6, 22),
    cost: (ctx) => cityCosts(ctx, ctx.state.player.cityId).showerCents,
    costCategory: "shopping",
    effects: () => ({ hygiene: 70, happiness: 2 }),
  },
  {
    id: "washUp",
    label: "Wash up in a public restroom",
    category: "hygiene",
    description: "Better than nothing.",
    interruptible: true,
    hours: () => 1,
    effects: () => ({ hygiene: 25 }),
  },

  // ---- Home & family
  {
    id: "shelter",
    label: "Check into a shelter",
    category: "home",
    description:
      "Try to get a bed for the night: dinner, a shower, safer sleep, and an address for job applications. Beds are limited.",
    interruptible: true,
    hours: () => 1,
    unavailable: all(during(17, 23), (ctx) => {
      const p = ctx.state.player;
      if (p.housing.kind !== "homeless") return "Only for people without a home.";
      return restingPlace(ctx) === "shelter" ? "You already have a bed tonight." : null;
    }),
    onFinish: (ctx) => {
      const p = ctx.state.player;
      const services = countryOf(ctx, p.cityId).socialServices;
      if (ctx.rng.chance(0.2 + services * 0.75)) {
        const tomorrow8 = startOfDay(ctx.state.time) + 24 + 8;
        p.shelterBedUntil = tomorrow8;
        p.cooldowns.shelterAddress = ctx.state.time + 14 * 24;
        p.needs.food = Math.min(100, p.needs.food + 30);
        ctx.alert("good", "You got a bed at the shelter tonight, plus a hot dinner.");
      } else {
        ctx.alert("bad", "The shelter is full tonight.");
      }
    },
  },
  {
    id: "chores",
    label: "Help around the house",
    category: "home",
    description: "Your parents notice when you pitch in.",
    interruptible: true,
    hours: () => 2,
    unavailable: withParents,
    effects: () => ({ happiness: -1, hygiene: -2 }),
    onFinish: (ctx) => {
      const d = ctx.state.player.daily;
      if (!d.chores) {
        d.chores = true;
        changeRelationship(ctx, 3);
      }
    },
  },
  {
    id: "familyTime",
    label: "Spend time with family",
    category: "home",
    description: "In person, or by phone if you don't live together.",
    interruptible: true,
    hours: () => 1,
    unavailable: (ctx) => {
      if (ctx.state.family.length === 0) return "You have no family.";
      const p = ctx.state.player;
      return p.housing.kind === "parents" || p.inventory.items.includes("phone")
        ? null
        : "Requires a phone.";
    },
    effects: () => ({ happiness: 4 }),
    onFinish: (ctx) => {
      const d = ctx.state.player.daily;
      if (!d.familyTalk) {
        d.familyTalk = true;
        changeRelationship(ctx, 2);
      }
    },
  },
  {
    id: "askMoney",
    label: "Ask your parents for money",
    category: "home",
    description:
      "They might help, depending on how things are between you and what they can afford.",
    interruptible: true,
    hours: () => 1,
    unavailable: (ctx) => {
      const p = ctx.state.player;
      if (ctx.state.family.length === 0) return "You have no family.";
      if (p.housing.kind !== "parents" && !p.inventory.items.includes("phone"))
        return "Requires a phone.";
      if ((p.cooldowns.askMoney ?? 0) > ctx.state.time)
        return "You asked recently. Give it a couple of weeks.";
      return null;
    },
    onFinish: (ctx) => {
      const p = ctx.state.player;
      p.cooldowns.askMoney = ctx.state.time + 14 * 24;
      const rel = averageRelationship(ctx.state.family);
      changeRelationship(ctx, -6);
      if (!ctx.rng.chance(rel / 110)) {
        ctx.alert("bad", "Your parents said no.");
        return;
      }
      const wealth = ctx.state.family[0]!.wealth;
      const amount = Math.round(
        cityCosts(ctx, p.cityId).medianWageCents * 10 * wealth * ctx.rng.float(0.5, 1.5),
      );
      earn(ctx, amount, "gift", "Money from your parents");
      ctx.alert("good", `Your parents gave you ${formatMoney(amount)}.`);
    },
  },

  // ---- Social life
  {
    id: "goOut",
    label: "Go out (bar, café, club)",
    category: "social",
    description: "Have some fun and maybe meet someone new.",
    interruptible: true,
    hours: () => 3,
    unavailable: during(17, 24),
    cost: (ctx) => cityCosts(ctx, ctx.state.player.cityId).fastFoodCents * 2,
    costCategory: "other",
    effects: () => ({ happiness: 3, energy: -1 }),
    onFinish: (ctx) => {
      if (!ctx.rng.chance(ctx.state.player.needs.hygiene < 30 ? 0.25 : 0.6)) return;
      const person = meetPerson(ctx, "on a night out");
      ctx.alert("info", `You met ${personName(person)}, ${person.occupation.toLowerCase()}.`);
    },
  },
  {
    id: "volunteer",
    label: "Volunteer in your community",
    category: "social",
    description: "Help at a food bank, cleanup or community center. Builds your local reputation.",
    interruptible: true,
    hours: () => 3,
    unavailable: during(9, 18),
    effects: () => ({ happiness: 1.5, energy: -1 }),
    onFinish: (ctx) => {
      adjustReputation(ctx, "community", 2);
      adjustReputation(ctx, "activists", 1);
      if (ctx.rng.chance(0.35)) {
        const person = meetPerson(ctx, "volunteering");
        ctx.alert("info", `You met ${personName(person)} while volunteering.`);
      }
    },
  },
  {
    id: "hangOut",
    label: "Hang out",
    category: "social",
    description: "Spend time together.",
    interruptible: true,
    hours: () => 2,
    unavailable: during(9, 24),
    target: (_ctx, r) =>
      r.kind === "ex" || r.kind === "rival" ? "They don't want to see you." : null,
    cost: (ctx) => Math.round(cityCosts(ctx, ctx.state.player.cityId).fastFoodCents * 0.8),
    costCategory: "other",
    effects: () => ({ happiness: 4 }),
    onFinish: (ctx, _amount, targetId) => socialBoost(ctx, targetId, 7, 1),
  },
  {
    id: "date",
    label: "Go on a date",
    category: "social",
    description: "Dinner, a movie, a walk. Builds romance.",
    interruptible: true,
    hours: () => 3,
    unavailable: during(17, 24),
    target: (_ctx, r) =>
      isRomantic(r) ||
      (r.romance >= 30 && r.affection >= 35 && r.kind !== "ex" && r.kind !== "child")
        ? null
        : "There's no spark yet (romance 30+ and affection 35+).",
    cost: (ctx) => cityCosts(ctx, ctx.state.player.cityId).fastFoodCents * 3,
    costCategory: "other",
    effects: () => ({ happiness: 5 }),
    onFinish: (ctx, _amount, targetId) => socialBoost(ctx, targetId, 5, 7),
  },
  {
    id: "call",
    label: "Call",
    category: "social",
    description: "Catch up by phone.",
    interruptible: true,
    hours: () => 1,
    unavailable: hasItem("phone", "phone"),
    target: (_ctx, r) => (r.kind === "ex" || r.kind === "rival" ? "They won't pick up." : null),
    effects: () => ({ happiness: 2 }),
    onFinish: (ctx, _amount, targetId) => socialBoost(ctx, targetId, 3, 1),
  },

  // ---- Work
  {
    id: "jobSearch",
    label: "Look for work",
    category: "work",
    description:
      "Apply to openings around the city. Cleanliness, a phone and a mailing address all improve your chances.",
    interruptible: true,
    hours: () => 3,
    unavailable: all(
      during(8, 18),
      (ctx) =>
        ctx.state.player.daily.jobSearch
          ? "You've already applied everywhere you could today."
          : null,
      (ctx) =>
        canWorkLegally(ctx)
          ? null
          : "Without the right to work here, only informal work is open to you (day labor, gigs).",
    ),
    effects: () => ({ happiness: -1 }),
    onStart: (ctx) => {
      ctx.state.player.daily.jobSearch = true;
    },
    onFinish: (ctx) => {
      const offers = searchForJobs(ctx);
      if (offers.length === 0)
        ctx.alert("bad", "No job offers this time. Try again tomorrow.", "work");
      else
        ctx.alert(
          "good",
          `You got ${offers.length} job offer${offers.length > 1 ? "s" : ""}! Check the Work tab.`,
          "work",
        );
    },
  },
  {
    id: "work",
    label: "Go to work",
    category: "work",
    description:
      "Work your scheduled shift. You can arrive up to 2 hours late (it hurts your performance).",
    interruptible: true,
    hours: (ctx) => Math.max(1, shiftHoursLeft(ctx)),
    unavailable: (ctx) => {
      if (!ctx.state.player.job) return "You don't have a job.";
      return shiftHoursLeft(ctx) > 0 ? null : "Not during your shift.";
    },
    decay: { energy: 1.35, hygiene: 1.4 },
    onStart: (ctx) => {
      const start = currentShiftStart(ctx);
      if (start !== null) {
        ctx.state.player.cooldowns.workedShift = start;
        if (start !== ctx.state.time && ctx.state.player.job) {
          ctx.state.player.job.performance = Math.max(0, ctx.state.player.job.performance - 5);
        }
      }
    },
    onHour: (ctx) => {
      const p = ctx.state.player;
      const job = p.job;
      if (!job) return;
      job.unpaidHours += 1;
      addXp(ctx, occupationById(job.occupationId).trains);
      const n = p.needs;
      if (n.energy < 20 || n.hygiene < 20 || n.food < 15) job.performance -= 0.6;
      else if (n.energy > 40 && n.hygiene > 40 && n.happiness > 30) job.performance += 0.2;
      job.performance = Math.max(0, Math.min(100, job.performance));
    },
  },
  {
    id: "manageBusiness",
    label: "Work on your business",
    category: "work",
    description:
      "Put in hours yourself: it adds capacity, raises quality and keeps staff motivated.",
    interruptible: true,
    businessTarget: true,
    hours: () => 4,
    unavailable: during(6, 23),
    effects: () => ({ energy: -1.5, happiness: -0.3 }),
    onHour: (ctx) => {
      const id = ctx.state.player.activity?.targetId;
      const b = id ? businessById(ctx, id) : undefined;
      if (b) b.ownerHours += 1;
      addXp(ctx, { management: 0.6, sales: 0.2 });
    },
  },
  {
    id: "study",
    label: "Study / attend classes",
    category: "growth",
    description: "Make progress toward your course.",
    interruptible: true,
    hours: () => 3,
    unavailable: (ctx) => (ctx.state.player.education ? null : "You're not enrolled in a course."),
    effects: () => ({ energy: -1.5, happiness: -0.5 }),
    onHour: (ctx) => {
      const ed = ctx.state.player.education;
      if (ed) ed.progressHours += 1;
    },
    onFinish: (ctx) => {
      const p = ctx.state.player;
      const ed = p.education;
      const course = ed && courseById(ed.courseId);
      if (!ed || !course || ed.progressHours < course.hours) return;
      p.credentials.push(course.id);
      p.education = null;
      ctx.alert("good", `You completed the ${course.title}!`, "work");
    },
  },

  // ---- Making money without a job
  {
    id: "dayLabor",
    label: "Day labor",
    category: "money",
    description:
      "Wait at the pickup spot early in the morning. If a contractor picks you, it's a long, hard day paid in cash.",
    interruptible: true,
    hours: () => 9,
    unavailable: during(5, 8),
    onStart: (ctx) => {
      const p = ctx.state.player;
      const labor = Math.sqrt(p.skills.labor / 25);
      const picked = ctx.rng.chance(
        Math.min(0.8, (0.35 + labor * 0.05) * demand(ctx) + (p.needs.energy > 50 ? 0.1 : 0)),
      );
      if (!picked) {
        p.activity!.endsAt = ctx.state.time + 2;
        p.activity!.amount = 0;
        ctx.alert("bad", "Nobody picked you for work today.", "work");
      } else {
        p.activity!.amount = 1;
      }
    },
    effects: (ctx) => (ctx.state.player.activity?.amount ? { energy: -3, hygiene: -3 } : {}),
    onHour: (ctx) => {
      if (ctx.state.player.activity?.amount) addXp(ctx, { labor: 1.2 });
    },
    onFinish: (ctx, amount) => {
      if (!amount) return;
      const c = cityCosts(ctx, ctx.state.player.cityId);
      const pay = Math.round(Math.max(c.minimumWageCents, c.medianWageCents * 0.55) * 8);
      earn(ctx, pay, "gig", "Day labor (cash)");
      ctx.alert("good", `You earned ${formatMoney(pay)} in cash for a day's labor.`, "money");
    },
  },
  {
    id: "delivery",
    label: "Deliver food (gig app)",
    category: "money",
    description: "Pick your own hours. Pay depends on demand.",
    interruptible: true,
    hours: () => 4,
    unavailable: all(during(10, 22), hasItem("bicycle", "bicycle"), hasItem("phone", "phone")),
    effects: () => ({ energy: -3, hygiene: -2 }),
    onHour: (ctx) => addXp(ctx, { driving: 0.3, service: 0.3 }),
    onFinish: (ctx) => {
      const c = cityCosts(ctx, ctx.state.player.cityId);
      const pay = Math.round(c.medianWageCents * 0.5 * 4 * ctx.rng.float(0.6, 1.4) * demand(ctx));
      earn(ctx, pay, "gig", "Delivery gig");
      ctx.alert("good", `You earned ${formatMoney(pay)} delivering food.`, "money");
    },
  },
  {
    id: "panhandle",
    label: "Panhandle",
    category: "money",
    description: "Ask strangers for spare change. Hard on your dignity.",
    interruptible: true,
    hours: () => 3,
    unavailable: during(8, 21),
    effects: () => ({ happiness: -4 }),
    onFinish: (ctx) => {
      const c = cityCosts(ctx, ctx.state.player.cityId);
      const hygienePenalty = ctx.state.player.needs.hygiene < 20 ? 0.6 : 1;
      const pay = Math.round(c.medianWageCents * 3 * ctx.rng.float(0.05, 0.4) * hygienePenalty);
      earn(ctx, pay, "gig", "Panhandling");
      ctx.alert(pay > 0 ? "info" : "bad", `People gave you ${formatMoney(pay)}.`, "money");
    },
  },
  {
    id: "cans",
    label: "Collect cans & bottles",
    category: "money",
    description: "Recycle for a little cash.",
    interruptible: true,
    hours: () => 3,
    effects: () => ({ hygiene: -3, energy: -1 }),
    onFinish: (ctx) => {
      const c = cityCosts(ctx, ctx.state.player.cityId);
      const pay = Math.round(c.medianWageCents * 3 * ctx.rng.float(0.08, 0.22));
      earn(ctx, pay, "gig", "Recycling");
    },
  },

  // ---- Started by the game
  {
    id: "traveling",
    label: "Traveling",
    category: "rest",
    description: "On the way to your new home.",
    system: true,
    interruptible: false,
    hours: () => 12,
    decay: { food: 0.8, energy: 0.8, hygiene: 1.2 },
    effects: () => ({ happiness: -0.3 }),
  },
  // ---- Emergencies (started by the game)
  {
    id: "collapse",
    label: "Collapsed from exhaustion",
    category: "rest",
    description: "You pushed yourself too hard and passed out.",
    system: true,
    interruptible: false,
    hours: () => 6,
    decay: { food: 0.45, energy: 0, hygiene: 0.5 },
    effects: (ctx) => ({ energy: sleepRate(ctx) * 0.8, happiness: -1 }),
    onFinish: (ctx) => streetRobbery(ctx, 6),
  },
  {
    id: "hospital",
    label: "In the hospital",
    category: "rest",
    description: "Recovering from a medical emergency.",
    system: true,
    interruptible: false,
    hours: () => 72,
    decay: { food: 0, energy: 0, hygiene: 0 },
    effects: () => ({ health: 1.2, food: 1, energy: 2, hygiene: 1 }),
    onFinish: (ctx) => {
      const p = ctx.state.player;
      p.needs.health = Math.max(p.needs.health, 45);
      const country = countryOf(ctx, p.cityId);
      const full = cityCosts(ctx, p.cityId).medianWageCents * 90;
      const bill =
        country.healthcare === "universal"
          ? 0
          : country.healthcare === "insurance" && p.job
            ? Math.round(full * 0.15)
            : full;
      if (bill > 0) {
        addMedicalDebt(ctx, bill, "Hospital bill");
        ctx.alert("bad", `You left the hospital with a ${formatMoney(bill)} bill.`, "money");
      } else {
        ctx.alert("info", "You've recovered. Public healthcare covered your hospital stay.");
      }
    },
  },
];

const byId = new Map(ACTIVITIES.map((a) => [a.id, a]));

export function activityById(id: string): ActivityDef | undefined {
  return byId.get(id);
}

/** Why the player can't start this activity right now, or null if they can. */
export function activityBlocker(
  ctx: GameContext,
  def: ActivityDef,
  amount?: number,
  targetId?: string,
): string | null {
  const p = ctx.state.player;
  if (def.system) return "This happens automatically.";
  if (def.businessTarget) {
    const b = targetId ? businessById(ctx, targetId) : undefined;
    if (!b || b.status !== "active") return "Choose one of your businesses.";
  }
  if (def.target) {
    const r = targetId ? relationshipWith(p, targetId) : undefined;
    if (!r) return "Choose someone to do this with.";
    const person = personById(ctx, r.personId);
    if (!person?.alive) return "They're no longer around.";
    const reason = def.target(ctx, r);
    if (reason) return reason;
  }
  const current = p.activity && activityById(p.activity.id);
  if (current && !current.interruptible)
    return `You can't do that while ${current.label.toLowerCase()}.`;
  const blocked = def.unavailable?.(ctx);
  if (blocked) return blocked;
  if (def.amount && amount !== undefined) {
    if (!Number.isInteger(amount) || amount < def.amount.min || amount > def.amount.max(ctx))
      return "Invalid amount.";
  }
  const cost = def.cost?.(ctx, amount ?? def.amount?.default(ctx)) ?? 0;
  if (cost > p.cashCents)
    return `Costs ${formatMoney(cost)}. You have ${formatMoney(p.cashCents)}.`;
  return null;
}

function endActivity(ctx: GameContext, reason: "finished" | "cancelled" | "interrupted"): void {
  const p = ctx.state.player;
  const a = p.activity;
  if (!a) return;
  p.activity = null;
  ctx.events.emit({ type: "activityEnded", activityId: a.id, reason });
}

function begin(ctx: GameContext, def: ActivityDef, amount?: number, targetId?: string): void {
  const p = ctx.state.player;
  if (p.activity) endActivity(ctx, "interrupted");
  const cost = def.cost?.(ctx, amount) ?? 0;
  if (cost > 0) transact(ctx, -cost, def.costCategory ?? "other", def.label);
  const now = ctx.state.time;
  p.activity = {
    id: def.id,
    startedAt: now,
    endsAt: now + Math.max(1, def.hours(ctx, amount)),
    amount,
    ...(targetId ? { targetId } : {}),
  };
  def.onStart?.(ctx, amount);
}

export function startActivity(
  ctx: GameContext,
  id: string,
  amount?: number,
  targetId?: string,
): string | null {
  const def = activityById(id);
  if (!def) return `Unknown activity "${id}".`;
  const chosen = def.amount ? (amount ?? def.amount.default(ctx)) : undefined;
  const blocked = activityBlocker(ctx, def, chosen, targetId);
  if (blocked) return blocked;
  begin(ctx, def, chosen, def.target || def.businessTarget ? targetId : undefined);
  return null;
}

export function cancelActivity(ctx: GameContext): string | null {
  const p = ctx.state.player;
  if (!p.activity) return "You're not doing anything.";
  const def = activityById(p.activity.id);
  if (def && !def.interruptible) return "You can't stop this.";
  if (p.activity.id === "work" && p.job) {
    p.job.performance = Math.max(0, p.job.performance - 8);
    ctx.alert("bad", "You left work early. Your boss noticed.", "work");
  }
  endActivity(ctx, "cancelled");
  return null;
}

function forceActivity(ctx: GameContext, id: string): void {
  const def = activityById(id)!;
  begin(ctx, def);
}

const LOW_NEED_WARNINGS: Partial<Record<keyof Needs, string>> = {
  food: "You're starving. Eat something soon or your health will suffer.",
  energy: "You're exhausted. Sleep soon or you'll collapse.",
  hygiene: "You badly need a wash. Employers and landlords will notice.",
  health: "Your health is failing. Rest, eat and keep clean.",
};

/** Warns once when a need first drops below the danger line, so the player can react in time. */
function warnLowNeeds(ctx: GameContext, before: Needs): void {
  const n = ctx.state.player.needs;
  const busySleeping =
    ctx.state.player.activity?.id === "sleep" || ctx.state.player.activity?.id === "hospital";
  for (const [need, message] of Object.entries(LOW_NEED_WARNINGS) as [keyof Needs, string][]) {
    if (need === "energy" && busySleeping) continue;
    if (before[need] >= 20 && n[need] < 20) ctx.alert("bad", message);
  }
}

/** Starts shifts automatically, and flags shifts the player didn't show up for. */
function handleShifts(ctx: GameContext): void {
  const p = ctx.state.player;
  if (!p.job) return;
  const occ = occupationById(p.job.occupationId);
  const now = ctx.state.time;
  if (shiftStartsNow(occ, now)) {
    const current = p.activity && activityById(p.activity.id);
    const free = !current || (current.interruptible && current.id !== "work");
    if (p.prefs.autoWork && free) {
      if (current) ctx.log("work", `You stopped to go to work.`);
      begin(ctx, activityById("work")!);
    } else if (p.activity?.id !== "work") {
      ctx.alert(
        "info",
        `Your shift as ${occ.title} has started. Go to work within 2 hours.`,
        "work",
      );
    }
  }
  // Two hours into a shift with no show: it counts as missed (hospital stays are excused).
  if (
    shiftStartsNow(occ, now - 2) &&
    p.cooldowns.workedShift !== now - 2 &&
    p.activity?.id !== "hospital"
  ) {
    recordMissedShift(ctx);
  }
}

export const activitySystem: System = {
  id: "activities",
  onHour(ctx) {
    const p = ctx.state.player;
    if (!p.alive) return;
    if (p.daily.day !== startOfDay(ctx.state.time)) p.daily = newDailyFlags(ctx.state.time);
    if ((p.shelterBedUntil ?? 0) <= ctx.state.time) p.shelterBedUntil = null;

    handleShifts(ctx);

    const def = p.activity ? activityById(p.activity.id) : undefined;
    const before = { ...p.needs };
    applyHourlyNeeds(ctx, def?.decay ?? {}, def?.effects?.(ctx) ?? {});
    warnLowNeeds(ctx, before);
    def?.onHour?.(ctx);

    const current = p.activity?.id;
    if (p.needs.health <= 0 && current !== "hospital") {
      ctx.alert("bad", "You collapsed and were rushed to the hospital.");
      if (p.activity?.id === "work" && p.job) p.job.performance -= 5;
      forceActivity(ctx, "hospital");
      return;
    }
    if (
      p.needs.energy <= 0 &&
      current !== "sleep" &&
      current !== "collapse" &&
      current !== "hospital"
    ) {
      ctx.alert("bad", "You collapsed from exhaustion.");
      forceActivity(ctx, "collapse");
      return;
    }

    if (p.activity && ctx.state.time >= p.activity.endsAt) {
      const finished = p.activity;
      const finishedDef = activityById(finished.id);
      p.activity = null;
      finishedDef?.onFinish?.(ctx, finished.amount, finished.targetId);
      ctx.events.emit({ type: "activityEnded", activityId: finished.id, reason: "finished" });
    }
  },
};

/** Ends the job if needed when the player can no longer work (used by the economy for layoffs). */
export function layOff(ctx: GameContext, companyName: string): void {
  leaveJob(ctx, `You were laid off from ${companyName}.`, "bad");
}
