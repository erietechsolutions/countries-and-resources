import { activeBusinesses, valuation } from "../business/business";
import { addDays, type GameTime } from "../core/calendar";
import type { GameContext } from "../core/game";
import type { System } from "../core/systems";
import { arrest, CRIME_SEVERITY } from "../crime/crime";
import { cityCosts, countryOf } from "../economy/costs";
import { transact } from "../finance/finance";
import { changeRelationship } from "../life/family";
import { playerOffices } from "../politics/government";
import { localPolicy, ruleOfLaw } from "../politics/policies";
import { personById, personName } from "../social/people";
import { adjustReputation, changeAffection, relationshipWith } from "../social/social";
import { formatMoney } from "../world/format";
import { occupationById } from "../work/occupations";
import type { SkillId } from "../work/skills";

const DAY = 24;

export type EventData = Record<string, string | number>;

export interface EventChoice {
  label: string;
  /** Short hint of what this choice involves. */
  detail?(ctx: GameContext, data: EventData): string;
  /** Why this choice can't be taken, or null. */
  blocked?(ctx: GameContext, data: EventData): string | null;
  /** Applies the choice and returns what happened. */
  apply(ctx: GameContext, data: EventData): string;
}

export interface StoryEventDef {
  id: string;
  title: string;
  /** Relative likelihood right now; 0 means the event can't happen. */
  weight(ctx: GameContext): number;
  /** Rolls the details (amounts, people). Returning null skips the event. */
  setup?(ctx: GameContext): EventData | null;
  text(ctx: GameContext, data: EventData): string;
  choices: EventChoice[];
  /** Taken automatically if the player doesn't decide in time. */
  defaultChoice: number;
  /** Days before this event can happen again. */
  cooldownDays?: number;
  /** Only happens as a follow-up to another event. */
  chainOnly?: boolean;
}

export interface PendingStoryEvent {
  id: string;
  data: EventData;
  createdAt: GameTime;
  expiresAt: GameTime;
}

export interface ScheduledEvent {
  id: string;
  at: GameTime;
  data: EventData;
}

export interface StoryState {
  pending: PendingStoryEvent | null;
  scheduled: ScheduledEvent[];
  /** Last time each event happened (for cooldowns). */
  last: Record<string, GameTime>;
  /** Recent outcomes, newest last. */
  history: { id: string; time: GameTime; choice: string; result: string }[];
}

export function emptyStory(): StoryState {
  return { pending: null, scheduled: [], last: {}, history: [] };
}

const wage = (ctx: GameContext) => cityCosts(ctx, ctx.state.player.cityId).medianWageCents;
const money = (n: string | number | undefined) => formatMoney(Number(n ?? 0), true);
const friends = (ctx: GameContext) =>
  ctx.state.player.relationships.filter((r) => r.kind === "friend" || r.kind === "bestFriend");

function cash(ctx: GameContext, cents: number, why: string): void {
  if (cents !== 0) transact(ctx, Math.round(cents), cents > 0 ? "gift" : "other", why);
}

function schedule(ctx: GameContext, id: string, days: number, data: EventData = {}): void {
  ctx.state.story.scheduled.push({ id, at: addDays(ctx.state.time, days), data });
}

export const STORY_EVENTS: StoryEventDef[] = [
  {
    id: "foundWallet",
    title: "A lost wallet",
    weight: () => 1,
    setup: (ctx) => ({ amount: Math.round(wage(ctx) * ctx.rng.float(5, 30)) }),
    text: (_ctx, d) =>
      `You find a wallet on the sidewalk with ${money(d.amount)} in cash and an ID card inside.`,
    choices: [
      {
        label: "Return it to its owner",
        apply: (ctx) => {
          adjustReputation(ctx, "community", 3);
          ctx.state.player.needs.happiness = Math.min(100, ctx.state.player.needs.happiness + 5);
          return "The owner was so grateful they told everyone on the block about you.";
        },
      },
      {
        label: "Keep the cash",
        detail: (_ctx, d) => `+${money(d.amount)}`,
        apply: (ctx, d) => {
          cash(ctx, Number(d.amount), "Found cash");
          adjustReputation(ctx, "underworld", 1);
          return "Finders keepers.";
        },
      },
    ],
    defaultChoice: 0,
  },
  {
    id: "sickness",
    title: "You're coming down with something",
    weight: (ctx) =>
      ctx.state.player.needs.hygiene < 30 || ctx.state.player.housing.kind === "homeless"
        ? 1.5
        : 0.5,
    cooldownDays: 45,
    setup: (ctx) => ({
      cost: countryOf(ctx, ctx.state.player.cityId).healthcare === "universal" ? 0 : wage(ctx) * 12,
    }),
    text: () => "A fever and a nasty cough. It might pass on its own... or it might get worse.",
    choices: [
      {
        label: "See a doctor",
        detail: (_ctx, d) => (Number(d.cost) > 0 ? money(d.cost) : "Free under public healthcare"),
        blocked: (ctx, d) =>
          ctx.state.player.cashCents < Number(d.cost) ? "You can't afford it." : null,
        apply: (ctx, d) => {
          cash(ctx, -Number(d.cost), "Doctor's visit");
          return "Some rest and medicine, and you feel better in a few days.";
        },
      },
      {
        label: "Tough it out",
        apply: (ctx) => {
          ctx.state.player.needs.health = Math.max(5, ctx.state.player.needs.health - 22);
          return "It got worse before it got better. Your health took a hit.";
        },
      },
    ],
    defaultChoice: 1,
  },
  {
    id: "friendLoan",
    title: "A friend in need",
    weight: (ctx) => (friends(ctx).length > 0 ? 0.8 : 0),
    cooldownDays: 60,
    setup: (ctx) => {
      const r = ctx.rng.pick(friends(ctx));
      return { personId: r.personId, amount: Math.round(wage(ctx) * ctx.rng.float(20, 70)) };
    },
    text: (ctx, d) => {
      const p = personById(ctx, String(d.personId));
      return `${p ? personName(p) : "A friend"} is behind on rent and asks to borrow ${money(d.amount)}. They promise to pay you back.`;
    },
    choices: [
      {
        label: "Lend the money",
        blocked: (ctx, d) =>
          ctx.state.player.cashCents < Number(d.amount) ? "You don't have it." : null,
        apply: (ctx, d) => {
          cash(ctx, -Number(d.amount), "Loan to a friend");
          const r = relationshipWith(ctx.state.player, String(d.personId));
          if (r) changeAffection(ctx, r, 12);
          if (ctx.rng.chance(0.7)) schedule(ctx, "friendRepays", ctx.rng.int(25, 70), d);
          return "They hugged you and swore they'd pay it back.";
        },
      },
      {
        label: "Say no",
        apply: (ctx, d) => {
          const r = relationshipWith(ctx.state.player, String(d.personId));
          if (r) changeAffection(ctx, r, -10);
          return "They said they understood. They didn't sound like it.";
        },
      },
    ],
    defaultChoice: 1,
  },
  {
    id: "friendRepays",
    title: "Paid back",
    chainOnly: true,
    weight: () => 0,
    text: (ctx, d) => {
      const p = personById(ctx, String(d.personId));
      return `${p ? personName(p) : "Your friend"} shows up with the ${money(d.amount)} they owed you, plus a bottle of something nice.`;
    },
    choices: [
      {
        label: "Thank them",
        apply: (ctx, d) => {
          cash(ctx, Number(d.amount), "Loan repaid");
          const r = relationshipWith(ctx.state.player, String(d.personId));
          if (r) changeAffection(ctx, r, 8);
          return "Good friends are rare.";
        },
      },
    ],
    defaultChoice: 0,
  },
  {
    id: "workBonus",
    title: "A bonus",
    weight: (ctx) => ((ctx.state.player.job?.performance ?? 0) > 72 ? 0.6 : 0),
    cooldownDays: 120,
    setup: (ctx) => ({ amount: Math.round(wage(ctx) * ctx.rng.float(20, 60)) }),
    text: (_ctx, d) =>
      `Your boss calls you in: great work lately. Here's a ${money(d.amount)} bonus.`,
    choices: [
      {
        label: "Thank you!",
        apply: (ctx, d) => (
          cash(ctx, Number(d.amount), "Work bonus"),
          "The extra money is welcome."
        ),
      },
    ],
    defaultChoice: 0,
  },
  {
    id: "workInjury",
    title: "Injured on the job",
    weight: (ctx) => {
      const job = ctx.state.player.job;
      return job && (occupationById(job.occupationId).trains.labor ?? 0) > 0 ? 0.4 : 0;
    },
    cooldownDays: 90,
    setup: (ctx) => ({ claim: wage(ctx) * 80 }),
    text: () => "Something heavy slips and catches your arm. It's not broken, but it hurts badly.",
    choices: [
      {
        label: "File for compensation",
        apply: (ctx, d) => {
          ctx.state.player.needs.health = Math.max(5, ctx.state.player.needs.health - 20);
          if (ctx.state.player.job) ctx.state.player.job.performance -= 5;
          if (ctx.rng.chance(0.6)) {
            cash(ctx, Number(d.claim), "Injury compensation");
            return `Your claim was approved: ${money(d.claim)}. Your boss wasn't thrilled.`;
          }
          return "Your claim was denied. Your boss wasn't thrilled you tried.";
        },
      },
      {
        label: "Keep working through it",
        apply: (ctx) => {
          ctx.state.player.needs.health = Math.max(5, ctx.state.player.needs.health - 28);
          if (ctx.state.player.job) ctx.state.player.job.performance += 4;
          return "Your boss noticed your dedication. Your arm noticed too.";
        },
      },
    ],
    defaultChoice: 1,
  },
  {
    id: "rentHike",
    title: "Rent increase",
    weight: (ctx) => (ctx.state.player.housing.kind === "renting" ? 0.5 : 0),
    cooldownDays: 180,
    text: () => "A letter from your landlord: your rent is going up 10% next month.",
    choices: [
      {
        label: "Accept it",
        apply: (ctx) => {
          const h = ctx.state.player.housing;
          if (h.kind === "renting") h.rentCents = Math.round(h.rentCents * 1.1);
          return "Your rent went up.";
        },
      },
      {
        label: "Negotiate",
        apply: (ctx) => {
          const h = ctx.state.player.housing;
          if (h.kind !== "renting") return "";
          if (ctx.rng.chance(0.5)) {
            h.rentCents = Math.round(h.rentCents * 1.03);
            return "You talked them down to a 3% increase.";
          }
          h.rentCents = Math.round(h.rentCents * 1.1);
          return "They wouldn't budge.";
        },
      },
      {
        label: "Cite the rent control law",
        blocked: (ctx) =>
          localPolicy(ctx, ctx.state.player.cityId, "rentControl") > 0
            ? null
            : "There's no rent control here.",
        apply: () => "The landlord backed down. The law is on your side.",
      },
    ],
    defaultChoice: 0,
  },
  {
    id: "scamCall",
    title: 'A call from "your bank"',
    weight: (ctx) =>
      ctx.state.player.inventory.items.includes("phone") && ctx.state.player.cashCents > 0
        ? 0.5
        : 0,
    cooldownDays: 120,
    text: () =>
      'Someone claiming to be from your bank says your account was hacked. They need your details to "secure" it.',
    choices: [
      {
        label: "Give them your details",
        apply: (ctx) => {
          const lost = Math.round(Math.max(0, ctx.state.player.cashCents) * 0.3);
          cash(ctx, -lost, "Scammed");
          return `It was a scam. ${money(lost)} vanished from your account.`;
        },
      },
      { label: "Hang up", apply: () => "Nice try." },
    ],
    defaultChoice: 1,
  },
  {
    id: "lottery",
    title: "Feeling lucky?",
    weight: () => 0.3,
    cooldownDays: 60,
    setup: (ctx) => ({ ticket: wage(ctx), prize: wage(ctx) * 5000 }),
    text: (_ctx, d) => `The corner store is selling tickets for a ${money(d.prize)} jackpot.`,
    choices: [
      {
        label: "Buy a ticket",
        detail: (_ctx, d) => money(d.ticket),
        blocked: (ctx, d) =>
          ctx.state.player.cashCents < Number(d.ticket) ? "You can't afford it." : null,
        apply: (ctx, d) => {
          cash(ctx, -Number(d.ticket), "Lottery ticket");
          if (ctx.rng.chance(1 / 400)) {
            cash(ctx, Number(d.prize), "LOTTERY WIN");
            adjustReputation(ctx, "fame", 10);
            return `YOU WON! ${money(d.prize)}!`;
          }
          return "Not this time.";
        },
      },
      { label: "Save your money", apply: () => "Probably wise." },
    ],
    defaultChoice: 1,
  },
  {
    id: "mentor",
    title: "A mentor",
    weight: (ctx) => {
      const job = ctx.state.player.job;
      return job && occupationById(job.occupationId).tier === 0 && !ctx.state.story.last.mentor
        ? 0.5
        : 0;
    },
    cooldownDays: 3650,
    text: () =>
      "A seasoned coworker has noticed you. They offer to show you the ropes after hours.",
    choices: [
      {
        label: "Accept",
        apply: (ctx) => {
          const job = ctx.state.player.job;
          if (job) {
            for (const skill of Object.keys(occupationById(job.occupationId).trains) as SkillId[])
              ctx.state.player.skills[skill] += 40;
          }
          schedule(ctx, "mentorVouches", 45);
          return "Weeks of evening lessons. You're learning fast.";
        },
      },
      { label: "Decline", apply: () => "Maybe another time." },
    ],
    defaultChoice: 1,
  },
  {
    id: "mentorVouches",
    title: "Your mentor vouches for you",
    chainOnly: true,
    weight: () => 0,
    text: () => "Your mentor put in a good word with management.",
    choices: [
      {
        label: "Thank them",
        apply: (ctx) => {
          if (ctx.state.player.job)
            ctx.state.player.job.performance = Math.min(100, ctx.state.player.job.performance + 25);
          adjustReputation(ctx, "business", 3);
          return "Management has their eye on you now. A promotion might not be far off.";
        },
      },
    ],
    defaultChoice: 0,
  },
  {
    id: "familyEmergency",
    title: "Family emergency",
    weight: (ctx) => (ctx.state.family.length > 0 ? 0.35 : 0),
    cooldownDays: 180,
    setup: (ctx) => ({ amount: Math.round(wage(ctx) * ctx.rng.float(30, 100)) }),
    text: (_ctx, d) =>
      `Your parents call: the car broke down and they're short ${money(d.amount)} for the repair.`,
    choices: [
      {
        label: "Send the money",
        blocked: (ctx, d) =>
          ctx.state.player.cashCents < Number(d.amount) ? "You don't have it." : null,
        apply: (ctx, d) => {
          cash(ctx, -Number(d.amount), "Helped your parents");
          changeRelationship(ctx, 15);
          return "They were touched.";
        },
      },
      {
        label: "You can't help right now",
        apply: (ctx) => {
          changeRelationship(ctx, -6);
          return "They said they'd figure it out.";
        },
      },
    ],
    defaultChoice: 1,
  },
  {
    id: "inheritance",
    title: "An inheritance",
    weight: () => 0.05,
    cooldownDays: 3650,
    setup: (ctx) => ({ amount: Math.round(wage(ctx) * ctx.rng.float(200, 800)) }),
    text: (_ctx, d) =>
      `A great-aunt you barely knew has passed away and left you ${money(d.amount)}.`,
    choices: [
      {
        label: "Accept it",
        apply: (ctx, d) => (
          cash(ctx, Number(d.amount), "Inheritance"),
          "A lot of money, from someone you barely knew."
        ),
      },
    ],
    defaultChoice: 0,
  },
  {
    id: "stockTip",
    title: "A hot stock tip",
    weight: (ctx) => (ctx.state.player.cashCents > wage(ctx) * 120 ? 0.4 : 0),
    cooldownDays: 90,
    setup: (ctx) => ({ stake: wage(ctx) * 50 }),
    text: (_ctx, d) =>
      `An acquaintance swears a small company is about to take off. Put in ${money(d.stake)}?`,
    choices: [
      {
        label: "Invest",
        detail: (_ctx, d) => money(d.stake),
        blocked: (ctx, d) =>
          ctx.state.player.cashCents < Number(d.stake) ? "You can't afford it." : null,
        apply: (ctx, d) => {
          const stake = Number(d.stake);
          cash(ctx, -stake, "Stock purchase");
          if (ctx.rng.chance(0.45)) {
            cash(ctx, stake * 2.2, "Stock sale");
            return `It took off! You sold for ${money(stake * 2.2)}.`;
          }
          cash(ctx, stake * 0.3, "Stock sale");
          return `It crashed. You got ${money(stake * 0.3)} back.`;
        },
      },
      { label: "Pass", apply: () => "You'll never know." },
    ],
    defaultChoice: 1,
  },
  {
    id: "buyoutOffer",
    title: "A buyout offer",
    weight: (ctx) =>
      activeBusinesses(ctx).some((b) => valuation(b) > 0 && b.history.length >= 6) ? 0.3 : 0,
    cooldownDays: 180,
    setup: (ctx) => {
      const b = activeBusinesses(ctx).filter((x) => valuation(x) > 0)[0];
      return b
        ? {
            businessId: b.id,
            price: Math.round(valuation(b) * b.playerShare * ctx.rng.float(1.3, 1.8)),
          }
        : null;
    },
    text: (ctx, d) => {
      const b = ctx.state.businesses.find((x) => x.id === d.businessId);
      return `A larger company wants to buy ${b?.name ?? "your business"} for ${money(d.price)}.`;
    },
    choices: [
      {
        label: "Sell",
        apply: (ctx, d) => {
          const b = ctx.state.businesses.find((x) => x.id === d.businessId);
          if (!b || b.status !== "active") return "The deal fell through.";
          b.status = "closed";
          cash(ctx, Number(d.price), `Sold ${b.name}`);
          adjustReputation(ctx, "business", 5);
          adjustReputation(ctx, "fame", 3);
          return `You sold ${b.name} for ${money(d.price)}.`;
        },
      },
      { label: "Not for sale", apply: () => "You're building something." },
    ],
    defaultChoice: 1,
  },
  {
    id: "viralReview",
    title: "Gone viral",
    weight: (ctx) => (activeBusinesses(ctx).length > 0 ? 0.3 : 0),
    cooldownDays: 120,
    setup: (ctx) => ({
      businessId: activeBusinesses(ctx)[0]!.id,
      good: ctx.rng.chance(0.6) ? 1 : 0,
    }),
    text: (ctx, d) => {
      const b = ctx.state.businesses.find((x) => x.id === d.businessId);
      return d.good
        ? `A glowing review of ${b?.name} is all over social media.`
        : `A furious review of ${b?.name} is spreading online.`;
    },
    choices: [
      {
        label: "OK",
        apply: (ctx, d) => {
          const b = ctx.state.businesses.find((x) => x.id === d.businessId);
          if (b) b.brand = Math.max(0, Math.min(100, b.brand + (d.good ? 15 : -15)));
          return d.good ? "Customers are lining up." : "Customers are staying away for now.";
        },
      },
    ],
    defaultChoice: 0,
  },
  {
    id: "protectionRacket",
    title: 'A visit from the neighborhood "protectors"',
    weight: (ctx) => {
      const b = activeBusinesses(ctx)[0];
      return b ? 0.3 * (1.2 - ruleOfLaw(countryOf(ctx, b.locations[0]!.cityId))) : 0;
    },
    cooldownDays: 120,
    setup: (ctx) => ({ businessId: activeBusinesses(ctx)[0]!.id, fee: wage(ctx) * 40 }),
    text: (_ctx, d) =>
      `Two men suggest your business would be safer if you paid ${money(d.fee)} for "protection".`,
    choices: [
      {
        label: "Pay",
        apply: (ctx, d) => {
          const b = ctx.state.businesses.find((x) => x.id === d.businessId);
          if (b) b.cashCents -= Number(d.fee);
          adjustReputation(ctx, "underworld", 2);
          return "They left. For now.";
        },
      },
      {
        label: "Refuse",
        apply: (ctx, d) => {
          const b = ctx.state.businesses.find((x) => x.id === d.businessId);
          if (b && ctx.rng.chance(0.5)) {
            b.quality = Math.max(5, b.quality - 20);
            b.morale = Math.max(0, b.morale - 15);
            return "A week later your windows were smashed. Staff are rattled.";
          }
          return "They never came back.";
        },
      },
      {
        label: "Go to the police",
        apply: (ctx) => {
          const rol = ruleOfLaw(countryOf(ctx, ctx.state.player.cityId));
          adjustReputation(ctx, "community", 2);
          return ctx.rng.chance(rol)
            ? "The police made arrests. The neighborhood thanks you."
            : "The police shrugged. The men heard you talked.";
        },
      },
    ],
    defaultChoice: 1,
  },
  {
    id: "bribeOffer",
    title: "An envelope",
    weight: (ctx) => (playerOffices(ctx).length > 0 ? 0.6 : 0),
    cooldownDays: 60,
    setup: (ctx) => ({
      amount: Math.round(
        (playerOffices(ctx)[0]?.salaryCents ?? wage(ctx) * 100) * ctx.rng.float(2, 6),
      ),
    }),
    text: (_ctx, d) =>
      `A developer slides an envelope across the table: ${money(d.amount)}, for your support on their project.`,
    choices: [
      {
        label: "Take it",
        apply: (ctx, d) => {
          cash(ctx, Number(d.amount), "Envelope");
          ctx.state.player.legal.secrets.push({
            crime: "bribery",
            time: ctx.state.time,
            severity: CRIME_SEVERITY.bribery,
          });
          adjustReputation(ctx, "business", 2);
          return "Nobody saw. Probably.";
        },
      },
      {
        label: "Refuse",
        apply: (ctx) => {
          adjustReputation(ctx, "community", 2);
          return "You pushed it back across the table.";
        },
      },
      {
        label: "Report it publicly",
        apply: (ctx) => {
          adjustReputation(ctx, "activists", 4);
          adjustReputation(ctx, "establishment", -4);
          adjustReputation(ctx, "fame", 2);
          ctx.state.player.politics.approval = Math.min(
            100,
            ctx.state.player.politics.approval + 5,
          );
          return "The press loved it. Some colleagues didn't.";
        },
      },
    ],
    defaultChoice: 1,
  },
  {
    id: "endorsement",
    title: "Endorsement offers",
    weight: (ctx) => (ctx.state.player.politics.candidacy ? 0.8 : 0),
    cooldownDays: 60,
    text: () =>
      "Both the local union and a business association offer to endorse your campaign, if you back their priorities.",
    choices: [
      {
        label: "Take the union's endorsement",
        apply: (ctx) => {
          adjustReputation(ctx, "workers", 6);
          adjustReputation(ctx, "business", -3);
          const c = ctx.state.player.politics.candidacy;
          if (c) c.effort += 20;
          return "Union volunteers are knocking on doors for you.";
        },
      },
      {
        label: "Take the business endorsement",
        apply: (ctx) => {
          adjustReputation(ctx, "business", 6);
          adjustReputation(ctx, "workers", -3);
          const c = ctx.state.player.politics.candidacy;
          if (c) c.fundsCents += wage(ctx) * 100;
          return "Donations are pouring in.";
        },
      },
      {
        label: "Stay independent",
        apply: (ctx) => (
          adjustReputation(ctx, "community", 2),
          "You're nobody's candidate but your own."
        ),
      },
    ],
    defaultChoice: 2,
  },
  {
    id: "debate",
    title: "The debate",
    weight: (ctx) => {
      const c = ctx.state.player.politics.candidacy;
      const e = c && ctx.state.politics.elections.find((x) => x.id === c.electionId);
      return e && e.date - ctx.state.time < 40 * DAY ? 1.5 : 0;
    },
    cooldownDays: 30,
    text: () => "The candidates' debate is tonight.",
    choices: [
      {
        label: "Prepare all day",
        apply: (ctx) => {
          ctx.state.player.needs.energy = Math.max(5, ctx.state.player.needs.energy - 30);
          const c = ctx.state.player.politics.candidacy;
          if (c) c.effort += 25;
          return "You were sharp and ready. It showed.";
        },
      },
      {
        label: "Wing it",
        apply: (ctx) => {
          const c = ctx.state.player.politics.candidacy;
          if (ctx.rng.chance(0.5)) {
            if (c) c.effort += 15;
            return "You were a natural.";
          }
          if (c) c.effort = Math.max(0, c.effort - 15);
          return "You fumbled a simple question. It's all over the news.";
        },
      },
    ],
    defaultChoice: 1,
  },
  {
    id: "partyRecruiter",
    title: "A party wants you",
    weight: (ctx) => {
      const p = ctx.state.player;
      return !p.politics.partyId &&
        p.reputation.community + p.reputation.activists > 15 &&
        p.citizenship.includes(ctx.geography.cities[p.cityId]!.countryId)
        ? 0.5
        : 0;
    },
    cooldownDays: 180,
    setup: (ctx) => {
      const country = countryOf(ctx, ctx.state.player.cityId);
      const legal = country.parties.filter((x) => x.legal);
      const options = legal.length ? legal : country.parties;
      // Some autocracies have no parties at all.
      if (options.length === 0) return null;
      const party = ctx.rng.pick(options);
      return { partyId: party.id, name: party.name };
    },
    text: (_ctx, d) =>
      `Organizers from the ${d.name} have heard about your community work. They'd like you to join, and they'll waive the fee.`,
    choices: [
      {
        label: "Join them",
        apply: (ctx, d) => {
          const p = ctx.state.player;
          p.politics = {
            ...p.politics,
            partyId: String(d.partyId),
            rank: 1,
            standing: 25,
            joinedAt: ctx.state.time,
          };
          return `Welcome to the ${d.name}. You start as an activist.`;
        },
      },
      { label: "Not interested", apply: () => "Politics isn't for everyone." },
    ],
    defaultChoice: 1,
  },
  {
    id: "protest",
    title: "Protest in the streets",
    weight: (ctx) => (countryOf(ctx, ctx.state.player.cityId).stability < 55 ? 0.5 : 0.1),
    cooldownDays: 60,
    text: () => "Thousands are marching against the government today.",
    choices: [
      {
        label: "Join the march",
        apply: (ctx) => {
          adjustReputation(ctx, "activists", 4);
          adjustReputation(ctx, "establishment", -2);
          adjustReputation(ctx, "fame", 1);
          if (
            ctx.rng.chance(
              0.08 + (1 - countryOf(ctx, ctx.state.player.cityId).stability / 100) * 0.1,
            )
          ) {
            arrest(ctx, "publicDisorder");
            return "The police kettled the crowd. You were arrested for public disorder.";
          }
          return "You marched, chanted and were seen.";
        },
      },
      { label: "Stay home", apply: () => "You watched it on the news." },
    ],
    defaultChoice: 1,
  },
  {
    id: "storm",
    title: "A severe storm",
    weight: () => 0.12,
    cooldownDays: 200,
    text: () =>
      "A violent storm tears through the city. Power lines are down and streets are flooded.",
    choices: [
      {
        label: "Help your neighbors",
        apply: (ctx) => {
          ctx.state.player.needs.energy = Math.max(5, ctx.state.player.needs.energy - 25);
          adjustReputation(ctx, "community", 4);
          return "You spent the night hauling sandbags. People remember that.";
        },
      },
      {
        label: "Stay safe",
        apply: (ctx) => {
          if (ctx.state.player.housing.kind === "homeless") {
            ctx.state.player.needs.health = Math.max(5, ctx.state.player.needs.health - 15);
            return "With nowhere to shelter, you were soaked and freezing all night.";
          }
          return "You rode it out at home.";
        },
      },
    ],
    defaultChoice: 1,
  },
];

const byId = new Map(STORY_EVENTS.map((e) => [e.id, e]));

export function storyEventById(id: string): StoryEventDef | undefined {
  return byId.get(id);
}

export function pendingEvent(
  ctx: GameContext,
): { def: StoryEventDef; event: PendingStoryEvent } | null {
  const e = ctx.state.story.pending;
  const def = e && byId.get(e.id);
  return e && def ? { def, event: e } : null;
}

function raise(ctx: GameContext, def: StoryEventDef, data: EventData): void {
  ctx.state.story.pending = {
    id: def.id,
    data,
    createdAt: ctx.state.time,
    expiresAt: addDays(ctx.state.time, 3),
  };
  ctx.state.story.last[def.id] = ctx.state.time;
  ctx.events.emit({ type: "storyEvent", eventId: def.id });
}

export function chooseEventOption(ctx: GameContext, index: number): string | null {
  const pending = pendingEvent(ctx);
  if (!pending) return "There's no event to respond to.";
  const choice = pending.def.choices[index];
  if (!choice) return "Invalid choice.";
  const blocked = choice.blocked?.(ctx, pending.event.data);
  if (blocked) return blocked;
  ctx.state.story.pending = null;
  const result = choice.apply(ctx, pending.event.data);
  const history = ctx.state.story.history;
  history.push({ id: pending.def.id, time: ctx.state.time, choice: choice.label, result });
  if (history.length > 40) history.shift();
  if (result) ctx.log("life", `${pending.def.title}: ${result}`);
  return null;
}

/** Roughly one story event every week or two, plus any follow-ups that are due. */
export const storySystem: System = {
  id: "story",
  onDay(ctx) {
    const story = ctx.state.story;
    const now = ctx.state.time;
    if (story.pending && now >= story.pending.expiresAt) {
      const def = byId.get(story.pending.id);
      chooseEventOption(ctx, def?.defaultChoice ?? 0);
    }
    if (story.pending || !ctx.state.player.alive) return;
    if (["prison", "custody", "hospital"].includes(ctx.state.player.activity?.id ?? "")) return;
    const due = story.scheduled.find((s) => s.at <= now);
    if (due) {
      story.scheduled = story.scheduled.filter((s) => s !== due);
      const def = byId.get(due.id);
      if (def) raise(ctx, def, due.data);
      return;
    }
    if (!ctx.rng.chance(0.09)) return;
    const eligible = STORY_EVENTS.filter((def) => {
      if (def.chainOnly) return false;
      const last = story.last[def.id];
      return last === undefined || now - last >= (def.cooldownDays ?? 30) * DAY;
    })
      .map((def) => [def, def.weight(ctx)] as const)
      .filter(([, w]) => w > 0);
    if (eligible.length === 0) return;
    const def = ctx.rng.weighted(eligible);
    const data = def.setup ? def.setup(ctx) : {};
    if (data) raise(ctx, def, data);
  },
};
