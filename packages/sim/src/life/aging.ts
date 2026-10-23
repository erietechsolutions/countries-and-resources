import {
  APPEARANCE_OPTIONS,
  fullName,
  newDailyFlags,
  type Character,
  type Gender,
} from "../character/character";
import { randomName } from "../character/names";
import { addDays, addYears, ageInYears, type GameTime } from "../core/calendar";
import type { GameContext } from "../core/game";
import { hashString } from "../core/rng";
import type { System } from "../core/systems";
import { emptyLegal } from "../crime/crime";
import { cityCosts, countryOf } from "../economy/costs";
import { totalDebtCents, transact } from "../finance/finance";
import { isDemocratic, newPolitician } from "../politics/government";
import { emptyPlayerPolitics, RANK_TITLES } from "../politics/types";
import { personAge, personById, personName } from "../social/people";
import type { Healthcare } from "../world/types";
import type { FamilyMember } from "./types";
import { emptySkills } from "../work/skills";
import { formatMoney } from "../world/format";

export interface Ancestor {
  name: string;
  born: GameTime;
  died: GameTime;
  cause: string;
  generation: number;
}

/** The family line the player has played through. */
export interface DynastyState {
  generation: number;
  ancestors: Ancestor[];
}

export function emptyDynasty(): DynastyState {
  return { generation: 1, ancestors: [] };
}

/** Set when the player's character dies, until an heir is chosen. */
export interface PendingSuccession {
  time: GameTime;
  name: string;
  age: number;
  cause: string;
  /** Person ids of eligible heirs; "relative" is always available. */
  heirs: string[];
  /** Cash left after debts are settled (before inheritance tax). */
  estateCents: number;
}

export const DISTANT_RELATIVE = "relative";

// ---------------------------------------------------------------------------------------------
// Health over a lifetime

/** The best health a body can have at this age. */
export function healthCap(age: number): number {
  return age < 45 ? 100 : Math.max(20, Math.round(100 - (age - 45) * 1.6));
}

/** Chance of dying within a year: tiny when young, rising steeply with age. */
export function annualMortality(age: number, health: number, healthcare: Healthcare): number {
  const base = 0.0004 * Math.exp(0.09 * (age - 30));
  const sick = health < 30 ? 3 : health < 60 ? 1.5 : 1;
  const care = healthcare === "universal" ? 0.85 : healthcare === "none" ? 1.3 : 1;
  return Math.min(0.9, base * sick * care);
}

export function playerAge(ctx: GameContext): number {
  return ageInYears(ctx.state.player.birthTime, ctx.state.time);
}

/** Hurts the player (fights, attacks, battles). At zero health they collapse into hospital. */
export function injurePlayer(ctx: GameContext, amount: number, message: string): void {
  const n = ctx.state.player.needs;
  n.health = Math.max(0, n.health - amount);
  ctx.alert("bad", message);
}

/**
 * When health gives out, older bodies may not recover. Younger players always make it to the
 * hospital. Returns true if the player died.
 */
export function fatalCollapse(ctx: GameContext): boolean {
  const age = playerAge(ctx);
  if (age < 50 || !ctx.rng.chance(Math.min(0.6, (age - 50) / 60))) return false;
  killPlayer(ctx, "died after their health gave out");
  return true;
}

// ---------------------------------------------------------------------------------------------
// Death

/** Adult children (oldest first), then a spouse. A distant relative is always the last resort. */
export function eligibleHeirs(ctx: GameContext): string[] {
  const p = ctx.state.player;
  const alive = (kind: string) =>
    p.relationships
      .filter((r) => r.kind === kind)
      .map((r) => personById(ctx, r.personId))
      .filter((x) => x?.alive && personAge(ctx, x) >= 18)
      .sort((a, b) => a!.birthTime - b!.birthTime)
      .map((x) => x!.id);
  return [...alive("child"), ...alive("spouse"), DISTANT_RELATIVE];
}

export function killPlayer(ctx: GameContext, cause: string): void {
  const p = ctx.state.player;
  if (!p.alive) return;
  const age = playerAge(ctx);
  p.alive = false;
  p.activity = null;
  ctx.state.succession = {
    time: ctx.state.time,
    name: fullName(p),
    age,
    cause,
    heirs: eligibleHeirs(ctx),
    estateCents: Math.max(0, p.cashCents - totalDebtCents(p)),
  };
  ctx.state.dynasty.ancestors.push({
    name: fullName(p),
    born: p.birthTime,
    died: ctx.state.time,
    cause,
    generation: ctx.state.dynasty.generation,
  });
  ctx.alert("bad", `${fullName(p)} ${cause}, aged ${age}.`);
  ctx.events.emit({ type: "playerDied" });
}

export function inheritanceTaxRate(ctx: GameContext, heir: string): number {
  const p = ctx.state.player;
  const rate = Math.max(0, Math.min(0.4, countryOf(ctx, p.cityId).taxes.income * 0.6));
  const spouse = p.relationships.some((r) => r.personId === heir && r.kind === "spouse");
  if (spouse) return 0;
  return heir === DISTANT_RELATIVE ? Math.min(0.6, rate * 2 + 0.1) : rate;
}

interface HeirIdentity {
  firstName: string;
  lastName: string;
  gender: Gender;
  birthTime: GameTime;
}

function relativeIdentity(ctx: GameContext): HeirIdentity {
  const gender = ctx.rng.pick<Gender>(["male", "female"]);
  const age = ctx.rng.int(20, 35);
  const birth = addDays(addYears(ctx.state.time, -age), -ctx.rng.int(0, 364));
  return {
    firstName: randomName(gender, ctx.rng).firstName,
    lastName: ctx.state.player.lastName,
    gender,
    birthTime: birth - (birth % 24),
  };
}

/** Builds the next character from the heir: they inherit the estate, the businesses and the name. */
function heirCharacter(ctx: GameContext, heirId: string, cashCents: number): Character {
  const old = ctx.state.player;
  const person = heirId === DISTANT_RELATIVE ? undefined : personById(ctx, heirId);
  const id: HeirIdentity = person ?? relativeIdentity(ctx);
  const isSpouse = old.relationships.some((r) => r.personId === heirId && r.kind === "spouse");

  // Family ties carry over, seen from the heir's side.
  const relationships = old.relationships
    .filter((r) => r.personId !== heirId && personById(ctx, r.personId)?.alive)
    .flatMap((r) => {
      if (r.kind === "child") {
        return isSpouse
          ? [{ ...r }]
          : [{ ...r, kind: "friend" as const, affection: 70, context: "your sibling" }];
      }
      if (r.kind === "spouse" && !isSpouse) {
        return [
          { ...r, kind: "friend" as const, affection: 80, romance: 0, context: "your parent" },
        ];
      }
      return [];
    });

  const appearance = { ...old.appearance };
  appearance.hairStyle = ctx.rng.pick(APPEARANCE_OPTIONS.hairStyle);
  appearance.build = ctx.rng.pick(APPEARANCE_OPTIONS.build);
  const age = ageInYears(id.birthTime, ctx.state.time);
  const health = Math.min(healthCap(age), 90);

  return {
    ...old,
    firstName: id.firstName,
    lastName: id.lastName,
    gender: id.gender,
    appearance,
    birthTime: id.birthTime,
    cashCents,
    needs: { food: 75, energy: 80, hygiene: 75, health, happiness: 45 },
    skills: emptySkills(),
    credentials: ["highSchool"],
    education: null,
    job: null,
    jobOffers: [],
    activity: null,
    finance: { ledger: [], debts: [], creditScore: null, nextDebtId: 1 },
    daily: newDailyFlags(ctx.state.time),
    cooldowns: {},
    shelterBedUntil: null,
    alive: true,
    relationships,
    reputation: {
      community: old.reputation.community * 0.25,
      workers: old.reputation.workers * 0.25,
      business: old.reputation.business * 0.25,
      establishment: old.reputation.establishment * 0.25,
      activists: old.reputation.activists * 0.25,
      underworld: old.reputation.underworld * 0.25,
      fame: old.reputation.fame * 0.5,
    },
    pregnancy: null,
    visas: [],
    visaApplication: null,
    politics: emptyPlayerPolitics(),
    legal: emptyLegal(),
  };
}

/** Continues the game as the chosen heir. */
export function chooseHeir(ctx: GameContext, heirId: string): string | null {
  const s = ctx.state;
  const pending = s.succession;
  if (!pending) return "There is no succession to settle.";
  if (!pending.heirs.includes(heirId)) return "They can't inherit.";
  const old = s.player;
  const tax = Math.round(pending.estateCents * inheritanceTaxRate(ctx, heirId));
  const cash = pending.estateCents - tax;
  const oldName = fullName(old);

  // Power: dynasties keep it in non-democracies; elsewhere the office passes to someone else.
  const offices = s.politics.offices.filter((o) => o.holders.includes("player"));
  const party = old.politics;
  let hereditary: string | null = null;
  for (const office of offices) {
    const country = s.world.countries[office.countryId];
    const inherits =
      office.kind === "headOfGovernment" && country && !isDemocratic(country.government);
    if (inherits) {
      hereditary = office.title;
      continue;
    }
    const i = office.holders.indexOf("player");
    const p = country?.parties.find((x) => x.id === office.holderParties[i]) ?? null;
    office.holders[i] = newPolitician(ctx, old.cityId, p);
  }

  const heir = heirCharacter(ctx, heirId, cash);
  s.player = heir;
  s.family = [];
  s.people = s.people.filter((x) => x.id !== heirId);
  if (party.partyId) {
    heir.politics = {
      ...heir.politics,
      partyId: party.partyId,
      rank: hereditary ? 5 : Math.min(party.rank, 2),
      standing: hereditary ? 200 : 50,
      joinedAt: s.time,
      approval: hereditary ? 50 : heir.politics.approval,
    };
  }
  s.rivals = s.rivals.filter((r) => r.kind !== "political");
  for (const r of s.rivals) r.hostility = Math.max(10, r.hostility - 20);
  s.succession = null;
  s.dynasty.generation++;

  const m = s.conflict.militia;
  if (m) m.morale = Math.max(0, m.morale - 15);

  const relation =
    heirId === DISTANT_RELATIVE
      ? "a distant relative"
      : old.relationships.some((r) => r.personId === heirId && r.kind === "spouse")
        ? "their spouse"
        : "their child";
  ctx.log(
    "life",
    `You carry on as ${fullName(heir)}, ${relation} of ${oldName}. You inherit ${formatMoney(cash, true)}${tax > 0 ? ` after ${formatMoney(tax, true)} in inheritance tax` : ""}.`,
  );
  if (hereditary)
    ctx.alert("good", `The throne passes to you: you are now ${hereditary}.`, "politics");
  else if (party.partyId && party.rank > 0)
    ctx.log(
      "politics",
      `You take up the family's place in the party as ${RANK_TITLES[heir.politics.rank]}.`,
    );
  if (m) ctx.alert("info", `${m.name} now answers to you. Morale has taken a blow.`, "politics");
  return null;
}

// ---------------------------------------------------------------------------------------------
// Other people grow old too

/** Parents have no birth date stored; their age follows the player's at a fixed gap. */
export function parentAge(ctx: GameContext, m: FamilyMember): number {
  return playerAge(ctx) + 20 + (hashString(`${m.id}:${m.firstName}`) % 16);
}

function parentDeaths(ctx: GameContext): void {
  const healthcare = countryOf(ctx, ctx.state.player.cityId).healthcare;
  for (const m of [...ctx.state.family]) {
    if (!ctx.rng.chance(annualMortality(parentAge(ctx, m), 80, healthcare) / 12)) continue;
    ctx.state.family = ctx.state.family.filter((x) => x !== m);
    const word = m.relation === "mother" ? "mother" : "father";
    ctx.alert("bad", `Your ${word}, ${m.firstName}, has died.`);
    ctx.state.player.needs.happiness = Math.max(0, ctx.state.player.needs.happiness - 25);
    if (m.wealth >= 0.5) {
      const wage = cityCosts(ctx, ctx.state.player.cityId).medianWageCents;
      const amount = Math.round(
        (m.wealth * wage * 160 * 12 * ctx.rng.float(0.3, 1.2)) /
          Math.max(1, ctx.state.family.length + 1),
      );
      transact(ctx, amount, "gift", `Inheritance from your ${word}`);
    }
  }
}

/** People the player knows, office holders and rivals can die of old age. */
function npcDeaths(ctx: GameContext): void {
  const s = ctx.state;
  const p = s.player;
  const ids = new Set<string>(p.relationships.map((r) => r.personId));
  for (const o of s.politics.offices) for (const h of o.holders) if (h !== "player") ids.add(h);
  for (const r of s.rivals) ids.add(r.personId);
  const healthcare = countryOf(ctx, p.cityId).healthcare;
  for (const id of ids) {
    const person = personById(ctx, id);
    if (!person?.alive) continue;
    const age = personAge(ctx, person);
    if (age < 40 || !ctx.rng.chance(annualMortality(age, 80, healthcare) / 12)) continue;
    person.alive = false;
    const rel = p.relationships.find((r) => r.personId === id);
    if (rel) {
      p.relationships = p.relationships.filter((r) => r !== rel);
      const close = ["spouse", "child", "bestFriend", "engaged", "dating"].includes(rel.kind);
      if (close) {
        p.needs.happiness = Math.max(0, p.needs.happiness - (rel.kind === "spouse" ? 35 : 20));
        ctx.alert("bad", `${personName(person)} has died at ${age}.`);
      } else {
        ctx.log("life", `${personName(person)} has died at ${age}.`);
      }
    }
    for (const office of s.politics.offices) {
      const i = office.holders.indexOf(id);
      if (i < 0) continue;
      const country = s.world.countries[office.countryId];
      const party = country?.parties.find((x) => x.id === office.holderParties[i]) ?? null;
      office.holders[i] = newPolitician(ctx, office.cityId ?? person.cityId, party);
      if (office.holders.includes("player") || office.seats === 1)
        ctx.log("politics", `${personName(person)} (${office.title}) has died in office.`);
    }
  }
}

export const agingSystem: System = {
  id: "aging",
  onDay(ctx) {
    const p = ctx.state.player;
    if (!p.alive) return;
    const age = playerAge(ctx);
    p.needs.health = Math.min(p.needs.health, healthCap(age));
    const healthcare = countryOf(ctx, p.cityId).healthcare;
    if (ctx.rng.chance(annualMortality(age, p.needs.health, healthcare) / 365)) {
      killPlayer(
        ctx,
        age >= 70
          ? "died peacefully in their sleep"
          : p.needs.health < 40
            ? "died after a long illness"
            : "died suddenly of a heart attack",
      );
    }
  },
  onMonth(ctx) {
    if (!ctx.state.player.alive) return;
    parentDeaths(ctx);
    npcDeaths(ctx);
  },
};
