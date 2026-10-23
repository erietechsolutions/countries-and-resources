import { businessById } from "../business/business";
import { commitCrime, CRIME_RISK } from "../crime/crime";
import { localPolicy } from "../politics/policies";
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
import { fatalCollapse } from "./aging";
import { averageRelationship, changeRelationship } from "./family";
import { applyHourlyNeeds, restingPlace } from "./needs";
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

export type ActivityCategory = "rest" | "home" | "social" | "work" | "money" | "growth" | "crime";

export const CATEGORY_LABELS: Record<ActivityCategory, string> = {
  rest: "Rest",
  home: "Home & family",
  social: "Social life",
  work: "Work",
  money: "Make money",
  growth: "Self-improvement",
  crime: "Crime",
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
  const share = p.inventory.items.includes("backpack")
    ? ctx.rng.float(0.1, 0.4)
    : ctx.rng.float(0.3, 1);
  const stolen = Math.round(p.cashCents * share);
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
    id: "night",
    label: "Night",
    category: "rest",
    description: "Off the clock until morning. A night shift or anything you start ends it.",
    system: true,
    interruptible: true,
    hours: (ctx) => (31 - hourNow(ctx)) % 24 || 8,
    onFinish: (ctx) => streetRobbery(ctx, 8),
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
    effects: () => ({ happiness: 3, health: 0.4 }),
  },
  {
    id: "exercise",
    label: "Work out",
    category: "rest",
    description: "Builds health over time. Tiring and sweaty.",
    interruptible: true,
    hours: () => 1,
    effects: () => ({ health: 1.5, happiness: 3 }),
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
      const localFunding = localPolicy(ctx, p.cityId, "shelterFunding") - 0.3;
      if (
        ctx.rng.chance(Math.max(0.05, Math.min(0.97, 0.2 + services * 0.75 + localFunding * 0.4)))
      ) {
        const tomorrow8 = startOfDay(ctx.state.time) + 24 + 8;
        p.shelterBedUntil = tomorrow8;
        p.cooldowns.shelterAddress = ctx.state.time + 14 * 24;
        ctx.alert("good", "You got a bed at the shelter tonight.");
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
    effects: () => ({ happiness: -1 }),
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
    effects: () => ({ happiness: 3 }),
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
    effects: () => ({ happiness: 1.5 }),
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
      if (n.health < 30 || n.hygiene < 25) job.performance -= 0.6;
      else if (n.hygiene > 40 && n.happiness > 30) job.performance += 0.2;
      job.performance = Math.max(0, Math.min(100, job.performance));
    },
  },
  {
    id: "partyWork",
    label: "Volunteer for your party",
    category: "growth",
    description: "Knock on doors, staff events and make calls. Raises your standing in the party.",
    interruptible: true,
    hours: () => 3,
    unavailable: all(during(9, 21), (ctx) =>
      ctx.state.player.politics.partyId ? null : "Join a party first.",
    ),
    effects: () => ({ happiness: 0.5 }),
    onFinish: (ctx) => {
      // Party bosses notice steady commitment, not marathon days: standing counts once a day.
      const p = ctx.state.player;
      const today = startOfDay(ctx.state.time);
      if (p.cooldowns.partyWork !== today) {
        p.cooldowns.partyWork = today;
        p.politics.standing += 3;
      }
      adjustReputation(ctx, "activists", 0.5);
      addXp(ctx, { sales: 0.3, management: 0.2 });
    },
  },
  {
    id: "campaign",
    label: "Campaign",
    category: "growth",
    description: "Rallies, debates and handshakes. Every hour wins you votes.",
    interruptible: true,
    hours: () => 4,
    unavailable: all(during(8, 22), (ctx) =>
      ctx.state.player.politics.candidacy ? null : "You're not running for office.",
    ),
    onHour: (ctx) => {
      const c = ctx.state.player.politics.candidacy;
      if (c) c.effort += 1;
      addXp(ctx, { sales: 0.3, service: 0.2 });
    },
    onFinish: (ctx) => {
      adjustReputation(ctx, "fame", 0.08);
      ctx.state.player.politics.standing += 1;
    },
  },
  {
    id: "fundraise",
    label: "Fundraise",
    category: "growth",
    description: "Ask supporters and donors for campaign money.",
    interruptible: true,
    hours: () => 3,
    unavailable: all(during(9, 21), (ctx) =>
      ctx.state.player.politics.candidacy ? null : "You're not running for office.",
    ),
    onFinish: (ctx) => {
      const p = ctx.state.player;
      const c = p.politics.candidacy;
      if (!c) return;
      const wage = cityCosts(ctx, p.cityId).medianWageCents;
      const pull =
        4 +
        p.reputation.fame / 5 +
        Math.max(0, p.reputation.business) / 8 +
        (p.politics.partyId ? 3 : 0);
      const raised = Math.round(wage * pull * ctx.rng.float(0.5, 1.5));
      c.fundsCents += raised;
      ctx.alert("good", `You raised ${formatMoney(raised, true)} for your campaign.`, "politics");
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
    effects: () => ({ happiness: -0.3 }),
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
    effects: () => ({ happiness: -0.5 }),
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
      const picked = ctx.rng.chance(Math.min(0.8, (0.35 + labor * 0.05) * demand(ctx)));
      if (!picked) {
        p.activity!.endsAt = ctx.state.time + 2;
        p.activity!.amount = 0;
        ctx.alert("bad", "Nobody picked you for work today.", "work");
      } else {
        p.activity!.amount = 1;
      }
    },
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
    onFinish: (ctx) => {
      const c = cityCosts(ctx, ctx.state.player.cityId);
      const pay = Math.round(c.medianWageCents * 3 * ctx.rng.float(0.08, 0.22));
      earn(ctx, pay, "gig", "Recycling");
    },
  },

  // ---- Crime
  {
    id: "shoplift",
    label: "Shoplift",
    category: "crime",
    description: "Pocket something small and resell it. Small reward, small risk.",
    interruptible: true,
    hours: () => 1,
    unavailable: during(8, 22),
    onFinish: (ctx) => {
      if (commitCrime(ctx, "shoplifting", CRIME_RISK.shoplift)) return;
      const cents = Math.round(cityCosts(ctx, ctx.state.player.cityId).medianWageCents * 1.5);
      earn(ctx, cents, "other", "Resold shoplifted goods");
      ctx.log("life", `You got away with it and sold the goods for ${formatMoney(cents)}.`);
    },
  },
  {
    id: "pickpocket",
    label: "Pick pockets",
    category: "crime",
    description: "Lift wallets in crowded places.",
    interruptible: true,
    hours: () => 2,
    unavailable: during(10, 22),
    onFinish: (ctx) => {
      if (commitCrime(ctx, "pickpocketing", CRIME_RISK.pickpocket)) return;
      const pay = Math.round(
        cityCosts(ctx, ctx.state.player.cityId).medianWageCents * ctx.rng.float(1, 6),
      );
      earn(ctx, pay, "other", "Stolen cash");
    },
  },
  {
    id: "burglary",
    label: "Break into a house",
    category: "crime",
    description: "Late at night. Serious money, serious prison time.",
    interruptible: true,
    hours: () => 4,
    unavailable: (ctx) => {
      const h = hourNow(ctx);
      return h >= 22 || h < 3 ? null : "Only late at night (10 PM–3 AM).";
    },
    onFinish: (ctx) => {
      if (commitCrime(ctx, "burglary", CRIME_RISK.burglary)) return;
      const pay = Math.round(
        cityCosts(ctx, ctx.state.player.cityId).medianWageCents * ctx.rng.float(15, 60),
      );
      earn(ctx, pay, "other", "Stolen goods, fenced");
      ctx.alert("info", `The job went smoothly: ${formatMoney(pay, true)}.`);
    },
  },
  {
    id: "dealDrugs",
    label: "Deal drugs",
    category: "crime",
    description: "Needs underworld connections (underworld reputation 10+).",
    interruptible: true,
    hours: () => 4,
    unavailable: all(during(14, 24), (ctx) =>
      ctx.state.player.reputation.underworld >= 10
        ? null
        : "You don't have the connections (underworld 10+).",
    ),
    effects: () => ({ happiness: -1 }),
    onFinish: (ctx) => {
      if (commitCrime(ctx, "drugDealing", CRIME_RISK.dealDrugs)) return;
      const pay = Math.round(
        cityCosts(ctx, ctx.state.player.cityId).medianWageCents * ctx.rng.float(10, 30),
      );
      earn(ctx, pay, "other", "Street sales");
    },
  },
  {
    id: "gangJob",
    label: "Do a job for the gang",
    category: "crime",
    description: "Collections, deliveries, intimidation. Pays more as you rise in the gang.",
    interruptible: true,
    hours: () => 4,
    unavailable: (ctx) => (ctx.state.player.legal.gangRank > 0 ? null : "You're not in a gang."),
    effects: () => ({ happiness: -0.5 }),
    onFinish: (ctx) => {
      const p = ctx.state.player;
      if (commitCrime(ctx, "gangJob", CRIME_RISK.gangJob)) return;
      const pay = Math.round(
        cityCosts(ctx, p.cityId).medianWageCents *
          ctx.rng.float(20, 50) *
          (1 + p.legal.gangRank * 0.5),
      );
      earn(ctx, pay, "other", "Gang earnings");
      adjustReputation(ctx, "underworld", 1.5);
      if (ctx.rng.chance(0.1)) {
        p.needs.health = Math.max(5, p.needs.health - 20);
        ctx.alert("bad", "Things got violent. You were hurt.");
      }
    },
  },

  // ---- Started by the game
  {
    id: "custody",
    label: "In police custody",
    category: "rest",
    description: "Waiting for your hearing.",
    system: true,
    interruptible: false,
    hours: () => 48,
    effects: () => ({ happiness: -1.5 }),
  },
  {
    id: "prison",
    label: "In prison",
    category: "rest",
    description: "Serving your sentence.",
    system: true,
    interruptible: false,
    hours: () => 24,
    effects: () => ({ happiness: -0.4, health: 0.1 }),
    onHour: (ctx) => addXp(ctx, { labor: 0.2 }),
  },
  {
    id: "traveling",
    label: "Traveling",
    category: "rest",
    description: "On the way to your new home.",
    system: true,
    interruptible: false,
    hours: () => 12,
    effects: () => ({ happiness: -0.3 }),
  },
  // ---- Emergencies (started by the game)
  {
    id: "hospital",
    label: "In the hospital",
    category: "rest",
    description: "Recovering from a medical emergency.",
    system: true,
    interruptible: false,
    hours: () => 72,
    effects: () => ({ health: 1.2 }),
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
  health:
    "Your health is failing. Rest, see to your living conditions, or it'll put you in hospital.",
};

/** Warns once when a need first drops below the danger line, so the player can react in time. */
function warnLowNeeds(ctx: GameContext, before: Needs): void {
  const n = ctx.state.player.needs;
  for (const [need, message] of Object.entries(LOW_NEED_WARNINGS) as [keyof Needs, string][]) {
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
    // Nights pass on their own: sleep is no longer something to manage.
    if (!p.activity && hourNow(ctx) === 23) forceActivity(ctx, "night");

    const def = p.activity ? activityById(p.activity.id) : undefined;
    const before = { ...p.needs };
    applyHourlyNeeds(ctx, def?.effects?.(ctx) ?? {});
    warnLowNeeds(ctx, before);
    def?.onHour?.(ctx);

    const current = p.activity?.id;
    // Critical health (an injury, or living conditions that wore the body down) means hospital.
    if (p.needs.health < 5 && current !== "hospital") {
      if (fatalCollapse(ctx)) return;
      ctx.alert("bad", "You collapsed and were rushed to the hospital.");
      if (p.activity?.id === "work" && p.job) p.job.performance -= 5;
      forceActivity(ctx, "hospital");
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
