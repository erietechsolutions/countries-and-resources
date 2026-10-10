import { activeBusinesses } from "../business/business";
import { addDays, type GameTime } from "../core/calendar";
import type { GameContext } from "../core/game";
import type { System } from "../core/systems";
import { exposeScandal } from "../crime/crime";
import { cityCosts } from "../economy/costs";
import { transact } from "../finance/finance";
import { enactPolicy, playerOffices } from "../politics/government";
import { alignment, policiesForLevel } from "../politics/policies";
import { createPerson, personById, personName } from "../social/people";
import { adjustReputation } from "../social/social";
import type { Person } from "../social/types";
import { formatMoney } from "../world/format";
import { SECTOR_LABELS } from "../work/occupations";

export type RivalKind = "political" | "business" | "criminal";

export const RIVAL_LABELS: Record<RivalKind, string> = {
  political: "Political rival",
  business: "Business rival",
  criminal: "Crime boss",
};

export interface Rival {
  personId: string;
  kind: RivalKind;
  /** 0–100: how determined they are to bring you down. */
  hostility: number;
  since: GameTime;
  /** The player's business this rival competes with (business rivals). */
  businessId?: string;
  lastAction: string;
  nextActionAt: GameTime;
}

export function rivalOfKind(ctx: GameContext, kind: RivalKind): Rival | undefined {
  return ctx.state.rivals.find((r) => r.kind === kind);
}

function addRival(
  ctx: GameContext,
  person: Person,
  kind: RivalKind,
  extra: Partial<Rival> = {},
): Rival {
  const rival: Rival = {
    personId: person.id,
    kind,
    hostility: 40,
    since: ctx.state.time,
    lastAction: "",
    nextActionAt: addDays(ctx.state.time, ctx.rng.int(20, 40)),
    ...extra,
  };
  ctx.state.rivals.push(rival);
  const p = ctx.state.player;
  if (!p.relationships.some((r) => r.personId === person.id)) {
    p.relationships.push({
      personId: person.id,
      kind: "rival",
      affection: 5,
      romance: 0,
      metAt: ctx.state.time,
      lastContact: ctx.state.time,
      context: RIVAL_LABELS[kind].toLowerCase(),
    });
  } else {
    const r = p.relationships.find((x) => x.personId === person.id)!;
    r.kind = "rival";
  }
  return rival;
}

/** New rivals appear as the player becomes a threat to someone. */
function spawnRivals(ctx: GameContext): void {
  const p = ctx.state.player;
  // Politics: the strongest opponent in the player's race.
  const c = p.politics.candidacy;
  const election = c && ctx.state.politics.elections.find((e) => e.id === c.electionId);
  if (election && election.candidates.length > 1 && !rivalOfKind(ctx, "political")) {
    const opponent = election.candidates.find((x) => x.id !== "player" && personById(ctx, x.id));
    const person = opponent && personById(ctx, opponent.id);
    if (person) {
      person.role = "rival";
      addRival(ctx, person, "political");
      ctx.alert(
        "info",
        `${personName(person)} has made you a target. Expect a dirty campaign.`,
        "politics",
      );
    }
  }
  // Business: a competitor's CEO takes notice once your brand grows.
  const b = activeBusinesses(ctx).find((x) => x.brand >= 25);
  if (b && !rivalOfKind(ctx, "business")) {
    const person = createPerson(ctx, {
      cityId: b.locations[0]!.cityId,
      minAge: 35,
      maxAge: 60,
      occupation: `CEO, ${SECTOR_LABELS[b.sector].toLowerCase()}`,
      role: "rival",
    });
    person.incomeCents *= 6;
    addRival(ctx, person, "business", { businessId: b.id });
    ctx.alert(
      "info",
      `${personName(person)}, who runs a competing business, has noticed ${b.name}.`,
      "work",
    );
  }
  // Crime: deep in the underworld, someone powerful sees you as competition.
  if ((p.legal.gangRank >= 2 || p.reputation.underworld >= 35) && !rivalOfKind(ctx, "criminal")) {
    const person = createPerson(ctx, {
      cityId: p.cityId,
      minAge: 30,
      maxAge: 55,
      occupation: "Crime boss",
      role: "crimeBoss",
    });
    addRival(ctx, person, "criminal");
    ctx.alert("bad", `${personName(person)}, a local crime boss, sees you as a threat.`, "life");
  }
}

interface RivalMove {
  id: string;
  /** How much the rival wants to do this right now. */
  utility: number;
  run(): string;
}

/** Each rival weighs its options and does whatever hurts the player most right now. */
function rivalMoves(ctx: GameContext, rival: Rival, person: Person): RivalMove[] {
  const p = ctx.state.player;
  const h = rival.hostility / 100;
  const wage = cityCosts(ctx, p.cityId).medianWageCents;
  const name = personName(person);
  const moves: RivalMove[] = [];
  if (rival.kind === "political") {
    const c = p.politics.candidacy;
    if (c) {
      moves.push({
        id: "attackAds",
        utility: 0.6 + h,
        run: () => {
          c.effort = Math.max(0, c.effort - 20);
          adjustReputation(ctx, "community", -2);
          return `${name} is running attack ads against you.`;
        },
      });
    }
    if (p.legal.secrets.length > 0) {
      moves.push({
        id: "digDirt",
        utility: 0.4 + h * 1.2 + p.legal.secrets.length * 0.1,
        run: () => {
          const secret = p.legal.secrets.shift()!;
          exposeScandal(ctx, secret);
          return `${name} dug into your past and leaked it to the press.`;
        },
      });
    }
    if (playerOffices(ctx).length > 0) {
      moves.push({
        id: "smear",
        utility: 0.3 + h * 0.6,
        run: () => {
          p.politics.approval = Math.max(0, p.politics.approval - 6);
          adjustReputation(ctx, "establishment", -2);
          return `${name} is attacking your record in the media.`;
        },
      });
    }
  }
  if (rival.kind === "business") {
    const b =
      activeBusinesses(ctx).find((x) => x.id === rival.businessId) ?? activeBusinesses(ctx)[0];
    if (b) {
      moves.push({
        id: "priceWar",
        utility: 0.5 + h * 0.8 + b.brand / 100,
        run: () => {
          b.brand = Math.max(0, b.brand - 10);
          return `${name} slashed prices to steal ${b.name}'s customers.`;
        },
      });
      if (b.employees >= 3) {
        moves.push({
          id: "poach",
          utility: 0.35 + h * 0.6,
          run: () => {
            const lost = Math.min(b.employees - 1, ctx.rng.int(1, 3));
            b.employees -= lost;
            b.morale = Math.max(0, b.morale - 10);
            return `${name} poached ${lost} of ${b.name}'s staff.`;
          },
        });
      }
    }
  }
  if (rival.kind === "criminal") {
    moves.push({
      id: "shakedown",
      utility: 0.5 + h,
      run: () => {
        const take = Math.min(Math.max(0, p.cashCents), wage * 30);
        if (take > 0) transact(ctx, -take, "theft", `Paid off ${name}'s people`);
        return `${name}'s people made it clear you owe them. You paid ${formatMoney(take, true)}.`;
      },
    });
    moves.push({
      id: "violence",
      utility: 0.2 + h * 0.9,
      run: () => {
        p.needs.health = Math.max(5, p.needs.health - 25);
        return `${name}'s people jumped you in an alley.`;
      },
    });
    moves.push({
      id: "tipPolice",
      utility: 0.25 + h * 0.5,
      run: () => {
        p.legal.heat = Math.min(100, p.legal.heat + 30);
        return `Someone tipped off the police about you. Probably ${name}.`;
      },
    });
  }
  return moves;
}

function actRivals(ctx: GameContext): void {
  for (const rival of [...ctx.state.rivals]) {
    const person = personById(ctx, rival.personId);
    if (!person?.alive) {
      ctx.state.rivals = ctx.state.rivals.filter((r) => r !== rival);
      continue;
    }
    if (ctx.state.time < rival.nextActionAt) continue;
    rival.nextActionAt = addDays(
      ctx.state.time,
      Math.round(30 - rival.hostility / 6 + ctx.rng.int(-5, 5)),
    );
    const moves = rivalMoves(ctx, rival, person).map((m) => ({
      m,
      u: m.utility + ctx.rng.normal(0, 0.15),
    }));
    const best = moves.sort((a, b) => b.u - a.u)[0];
    if (!best || best.u < 0.45) continue;
    const message = best.m.run();
    rival.lastAction = message;
    ctx.alert(
      "bad",
      message,
      rival.kind === "business" ? "work" : rival.kind === "political" ? "politics" : "life",
    );
  }
}

// ---------------------------------------------------------------------------------------------
// Player responses

export function reconcileCost(ctx: GameContext): number {
  return cityCosts(ctx, ctx.state.player.cityId).medianWageCents * 40;
}

export function reconcile(ctx: GameContext, personId: string): string | null {
  const rival = ctx.state.rivals.find((r) => r.personId === personId);
  if (!rival) return "They're not your rival.";
  const cost = reconcileCost(ctx);
  if (cost > ctx.state.player.cashCents)
    return `A peace offering costs ${formatMoney(cost, true)}.`;
  transact(ctx, -cost, "other", "Peace offering");
  const person = personById(ctx, personId)!;
  if (ctx.rng.chance(0.75 - rival.hostility / 200)) {
    ctx.state.rivals = ctx.state.rivals.filter((r) => r !== rival);
    const rel = ctx.state.player.relationships.find((r) => r.personId === personId);
    if (rel) rel.kind = "acquaintance";
    ctx.alert("good", `You and ${personName(person)} agreed to bury the hatchet.`);
  } else {
    rival.hostility = Math.min(100, rival.hostility + 5);
    ctx.alert("bad", `${personName(person)} laughed off your offer.`);
  }
  return null;
}

export function investigateCost(ctx: GameContext): number {
  return cityCosts(ctx, ctx.state.player.cityId).medianWageCents * 25;
}

/** Hire someone to find dirt on a rival. If it works, the rival is weakened or brought down. */
export function investigate(ctx: GameContext, personId: string): string | null {
  const rival = ctx.state.rivals.find((r) => r.personId === personId);
  if (!rival) return "They're not your rival.";
  const p = ctx.state.player;
  if ((p.cooldowns[`investigate:${personId}`] ?? 0) > ctx.state.time)
    return "Your investigator is still digging.";
  const cost = investigateCost(ctx);
  if (cost > p.cashCents) return `An investigator costs ${formatMoney(cost, true)}.`;
  transact(ctx, -cost, "other", "Private investigator");
  p.cooldowns[`investigate:${personId}`] = addDays(ctx.state.time, 30);
  const person = personById(ctx, personId)!;
  if (!ctx.rng.chance(0.45)) {
    rival.hostility = Math.min(100, rival.hostility + 8);
    ctx.alert(
      "bad",
      `Your investigator found nothing on ${personName(person)}, and they found out you were looking.`,
    );
    return null;
  }
  adjustReputation(ctx, "fame", 2);
  // A rival who loses their standing stops being a threat.
  for (const office of ctx.state.politics.offices) {
    const i = office.holders.indexOf(personId);
    if (i >= 0) {
      office.holders.splice(
        i,
        1,
        createPerson(ctx, {
          cityId: person.cityId,
          minAge: 35,
          maxAge: 65,
          occupation: "Politician",
          role: "politician",
        }).id,
      );
    }
  }
  ctx.state.rivals = ctx.state.rivals.filter((r) => r !== rival);
  person.role = undefined;
  person.occupation = "Disgraced";
  ctx.alert(
    "good",
    `Your investigator found real dirt. ${personName(person)}'s reputation is ruined; they're no longer a threat.`,
  );
  return null;
}

/** Political rivals challenge the player at the next election with extra appeal. */
export function rivalCandidateAppeal(ctx: GameContext, personId: string): number {
  const rival = ctx.state.rivals.find((r) => r.personId === personId && r.kind === "political");
  return rival ? 0.15 + rival.hostility / 300 : 0;
}

// ---------------------------------------------------------------------------------------------
// AI governments: ruling parties nudge policy toward their ideology each year.

function aiGovernments(ctx: GameContext): void {
  const playerCountry = ctx.geography.cities[ctx.state.player.cityId]!.countryId;
  for (const country of Object.values(ctx.state.world.countries)) {
    // The player's own country is handled by real bills in its legislature.
    if (country.id === playerCountry || country.population === 0 || !country.rulingPartyId)
      continue;
    const party = country.parties.find((p) => p.id === country.rulingPartyId);
    if (!party || !ctx.rng.chance(0.6)) continue;
    const scope = `national:${country.id}`;
    const options = policiesForLevel("national")
      .flatMap((policy) =>
        ([1, -1] as const).map((dir) => ({
          policy,
          dir,
          score: alignment(party.ideology, policy, dir) + ctx.rng.normal(0, 0.2),
        })),
      )
      .filter(({ policy, dir }) => {
        const v = policy.get(ctx, scope);
        return dir > 0 ? v < policy.max : v > policy.min;
      })
      .sort((a, b) => b.score - a.score);
    const pick = options[0];
    if (pick && pick.score > 0.2) enactPolicy(ctx, scope, pick.policy, pick.dir, "ai");
  }
}

export const rivalsSystem: System = {
  id: "rivals",
  onDay(ctx) {
    actRivals(ctx);
  },
  onMonth(ctx) {
    spawnRivals(ctx);
    for (const r of ctx.state.rivals) r.hostility = Math.max(10, r.hostility - 3);
    // Losing to the player makes rivals angrier.
    const r = rivalOfKind(ctx, "political");
    if (r && playerOffices(ctx).length > 0) r.hostility = Math.min(100, r.hostility + 4);
  },
  onYear(ctx) {
    aiGovernments(ctx);
  },
};
