import { randomName } from "../character/names";
import { addDays } from "../core/calendar";
import type { GameContext } from "../core/game";
import { Rng } from "../core/rng";
import type { System } from "../core/systems";
import {
  adjustRelation,
  armyPower,
  hasPact,
  hasTradeDeal,
  militaryOf,
  playerRuledCountry,
  relation,
  sanctions,
  warBetween,
} from "../conflict/military";
import { pairKey } from "../conflict/types";
import { removeFromOffice } from "../crime/crime";
import { isDemocratic } from "../politics/government";
import { ruleOfLaw } from "../politics/policies";
import { formatMoney } from "../world/format";
import type { CountryId, ProvinceId } from "../world/geography";
import { countryName, geoCountry } from "../world/territory";
import type { BudgetArea, CountryState, General, ProjectKind, Statecraft } from "../world/types";

const MONTH = 30 * 24;

export function monthlyGdpOf(c: CountryState): number {
  return (c.gdpPerCapita * 100 * c.population) / 12;
}

function defaultStatecraft(c: CountryState): Statecraft {
  return {
    budget: {
      defense: c.military?.spending ?? 0.5,
      healthcare: 0.5,
      education: 0.5,
      infrastructure: 0.5,
      police: 0.5,
      welfare: 0.5,
    },
    stateOwnership: c.government === "oneParty" ? 0.75 : 0.25,
    tariff: 0.1,
    growthBonus: 0,
    projects: [],
    forts: [],
  };
}

/** A country's policy settings, created (at normal levels) when a leader first changes them. */
export function statecraftOf(c: CountryState): Statecraft {
  c.statecraft ??= defaultStatecraft(c);
  return c.statecraft;
}

/** Read-only view for the UI: never creates state, so looking can't change the simulation. */
export function readStatecraft(c: CountryState): Statecraft {
  return c.statecraft ?? defaultStatecraft(c);
}

// ---------------------------------------------------------------------------------------------
// The budget

export const BUDGET_AREAS: {
  id: BudgetArea;
  label: string;
  description: string;
  /** Share of GDP each step above normal costs (per 0.5). */
  weight: number;
}[] = [
  { id: "defense", label: "Defense", description: "A bigger, better army.", weight: 0.04 },
  {
    id: "healthcare",
    label: "Healthcare",
    description: "Happier, healthier people; over time, a better health system.",
    weight: 0.03,
  },
  {
    id: "education",
    label: "Education",
    description: "Slowly raises development, and with it wages and growth.",
    weight: 0.02,
  },
  {
    id: "infrastructure",
    label: "Infrastructure",
    description: "Roads, power and water: faster growth.",
    weight: 0.02,
  },
  {
    id: "police",
    label: "Police and courts",
    description: "Rule of law and order; harder times for rebels and criminals.",
    weight: 0.01,
  },
  {
    id: "welfare",
    label: "Welfare",
    description: "Support for the poor: the lower class is happier and calmer.",
    weight: 0.03,
  },
];

export const BUDGET_LEVELS = [0, 0.25, 0.5, 0.75, 1];

/** Monthly unit upkeep for heavy forces, as multiples of GDP per person (in cents). */
const UNIT_COST = { armor: 100, air: 1000, navy: 5000 } as const;
export type Branch = keyof typeof UNIT_COST;

export function unitCost(c: CountryState, branch: Branch): number {
  return Math.round(c.gdpPerCapita * 100 * UNIT_COST[branch]);
}

/** Spending beyond the baseline budget: priorities, projects, research and heavy forces. */
export function extraSpending(c: CountryState): number {
  const gdp = monthlyGdpOf(c);
  const s = c.statecraft;
  const m = c.military;
  let extra = 0;
  if (s) {
    for (const area of BUDGET_AREAS) {
      if (area.id === "defense") continue; // counted through military spending
      extra += (s.budget[area.id] - 0.5) * 2 * area.weight * gdp;
    }
    for (const p of s.projects) {
      const months = Math.max(1, (p.doneAt - p.startedAt) / MONTH);
      extra += p.costCents / months;
    }
  }
  if (m) {
    extra += (m.research ?? 0) * 0.01 * gdp;
    // Heavy forces cost about 1% of their price to keep up each month.
    extra +=
      ((m.armor ?? 0) * unitCost(c, "armor") +
        (m.air ?? 0) * unitCost(c, "air") +
        (m.navy ?? 0) * unitCost(c, "navy")) *
      0.002;
  }
  return Math.round(extra);
}

/** Revenue from state companies and tariffs. */
export function extraRevenue(c: CountryState): number {
  const s = c.statecraft;
  if (!s) return 0;
  const gdp = monthlyGdpOf(c);
  return Math.round(gdp * (s.stateOwnership * 0.015 + s.tariff * 0.02));
}

export const CREDIT_RATINGS = ["D", "CCC", "B", "BB", "BBB", "A", "AA", "AAA"];

function creditScore(c: CountryState): number {
  const gdp = monthlyGdpOf(c) * 12;
  const ratio = gdp > 0 && c.budget ? c.budget.debtCents / gdp : 0;
  const recentDefault = (c.statecraft?.defaultRecovery ?? 0) > 0;
  return (
    100 -
    ratio * 40 -
    Math.max(0, 60 - c.stability) / 2 -
    (recentDefault ? 45 : 0) +
    c.development * 10
  );
}

export function creditRating(c: CountryState): string {
  const score = creditScore(c);
  const thresholds = [20, 35, 45, 55, 65, 75, 85];
  let i = 0;
  while (i < thresholds.length && score >= thresholds[i]!) i++;
  return CREDIT_RATINGS[i]!;
}

/** Yearly interest the government pays on its debt. */
export function interestRate(c: CountryState): number {
  const score = Math.max(0, Math.min(100, creditScore(c)));
  const rate = 0.015 + Math.min(0.1, Math.max(0, c.inflation) * 0.5) + ((100 - score) / 100) * 0.08;
  return Math.round(Math.min(0.25, rate) * 10000) / 10000;
}

function setBudget(
  ctx: GameContext,
  self: CountryId,
  area: BudgetArea,
  level: number,
): string | null {
  if (!BUDGET_LEVELS.includes(level)) return "Choose a spending level.";
  if (!BUDGET_AREAS.some((a) => a.id === area)) return "Unknown budget area.";
  const c = ctx.state.world.countries[self]!;
  statecraftOf(c).budget[area] = level;
  if (area === "defense") militaryOf(c).spending = level;
  ctx.log(
    "politics",
    `${BUDGET_AREAS.find((a) => a.id === area)!.label} spending set to ${Math.round(level * 200)}% of normal.`,
  );
  return null;
}

// ---------------------------------------------------------------------------------------------
// Projects

export const PROJECTS: Record<
  ProjectKind,
  { label: string; description: string; months: number; costGdpShare: number; coastal?: boolean }
> = {
  railway: {
    label: "High-speed railway",
    description: "+0.4% growth a year.",
    months: 36,
    costGdpShare: 0.012,
  },
  port: {
    label: "Deep-water port",
    description: "+0.3% growth a year; needs a coast.",
    months: 24,
    costGdpShare: 0.006,
    coastal: true,
  },
  powerPlant: {
    label: "Power plant",
    description: "+0.2% growth a year and steadier prices.",
    months: 24,
    costGdpShare: 0.006,
  },
  university: {
    label: "National university",
    description: "Raises development.",
    months: 48,
    costGdpShare: 0.004,
  },
  hospitals: {
    label: "Hospital network",
    description: "Happier people; upgrades the health system.",
    months: 30,
    costGdpShare: 0.008,
  },
  fortress: {
    label: "Border fortress",
    description: "Makes the region much harder to capture.",
    months: 12,
    costGdpShare: 0.002,
  },
};

export function projectCost(c: CountryState, kind: ProjectKind): number {
  return Math.round(monthlyGdpOf(c) * 12 * PROJECTS[kind].costGdpShare);
}

function startProject(
  ctx: GameContext,
  self: CountryId,
  kind: ProjectKind,
  provinceId: ProvinceId,
): string | null {
  const def = PROJECTS[kind];
  if (!def) return "Unknown project.";
  const province = ctx.geography.provinces[provinceId];
  if (province?.countryId !== self) return "Choose one of your own regions.";
  if (def.coastal && !province.coastal) return "A port needs a coastal region.";
  const c = ctx.state.world.countries[self]!;
  const s = statecraftOf(c);
  if (s.projects.length >= 4) return "Your ministries can only run 4 big projects at once.";
  if (kind === "fortress" && s.forts.includes(provinceId))
    return "That region is already fortified.";
  s.projects.push({
    id: `p${ctx.state.conflict.nextId++}`,
    kind,
    provinceId,
    startedAt: ctx.state.time,
    doneAt: ctx.state.time + def.months * MONTH,
    costCents: projectCost(c, kind),
  });
  ctx.log(
    "politics",
    `Work has begun: ${def.label} in ${province.name} (${formatMoney(projectCost(c, kind), true)}).`,
  );
  return null;
}

function finishProject(
  ctx: GameContext,
  c: CountryState,
  kind: ProjectKind,
  provinceId: ProvinceId,
): void {
  const s = statecraftOf(c);
  switch (kind) {
    case "railway":
      s.growthBonus += 0.004;
      break;
    case "port":
      s.growthBonus += 0.003;
      break;
    case "powerPlant":
      s.growthBonus += 0.002;
      c.inflation = Math.max(0, c.inflation - 0.005);
      break;
    case "university":
      c.development = Math.min(1, Math.round((c.development + 0.02) * 1000) / 1000);
      break;
    case "hospitals":
      for (const pop of c.pops) pop.satisfaction = Math.min(100, pop.satisfaction + 5);
      c.healthcare = c.healthcare === "none" ? "insurance" : "universal";
      break;
    case "fortress":
      s.forts.push(provinceId);
      break;
  }
  const where = ctx.geography.provinces[provinceId]?.name ?? "";
  if (c.id === playerRuledCountry(ctx))
    ctx.alert("good", `Completed: ${PROJECTS[kind].label} in ${where}.`, "politics");
}

// ---------------------------------------------------------------------------------------------
// Economic policy

function setOwnership(ctx: GameContext, self: CountryId, direction: 1 | -1): string | null {
  const c = ctx.state.world.countries[self]!;
  const s = statecraftOf(c);
  const next = Math.round((s.stateOwnership + direction * 0.25) * 100) / 100;
  if (next < 0 || next > 1)
    return direction > 0 ? "Everything is already state-owned." : "Nothing is left to privatize.";
  s.stateOwnership = next;
  if (direction > 0) {
    s.growthBonus -= 0.002;
    for (const pop of c.pops)
      if (pop.class === "upper") pop.satisfaction = Math.max(0, pop.satisfaction - 8);
    ctx.alert(
      "info",
      "You nationalized major industries. Revenue rises; investors are unhappy.",
      "politics",
    );
  } else {
    s.growthBonus += 0.002;
    // A one-off sale pays down debt.
    const sale = Math.round(monthlyGdpOf(c) * 12 * 0.02);
    if (c.budget) c.budget.debtCents = Math.max(0, c.budget.debtCents - sale);
    for (const pop of c.pops)
      if (pop.class === "lower") pop.satisfaction = Math.max(0, pop.satisfaction - 5);
    ctx.alert("info", `You privatized state companies for ${formatMoney(sale, true)}.`, "politics");
  }
  return null;
}

function setTariff(ctx: GameContext, self: CountryId, level: number): string | null {
  if (![0, 0.1, 0.2, 0.3, 0.4].includes(level)) return "Choose a tariff level.";
  statecraftOf(ctx.state.world.countries[self]!).tariff = level;
  ctx.log("politics", `Tariffs set to ${Math.round(level * 100)}%.`);
  return null;
}

// ---------------------------------------------------------------------------------------------
// Generals and coups

export function ensureGenerals(ctx: GameContext, c: CountryState): General[] {
  const m = militaryOf(c);
  if (m.generals?.length) return m.generals;
  const rng = Rng.fromKey(ctx.state.config.worldSeed, `generals:${c.id}`);
  m.generals = Array.from({ length: 3 }, () => {
    const n = randomName(rng.pick(["male", "female"] as const), rng);
    return {
      name: `${n.firstName} ${n.lastName}`,
      skill: Math.round(rng.float(0.25, 0.8) * 100) / 100,
      loyalty: rng.int(55, 80),
    };
  });
  return m.generals;
}

function manageGeneral(
  ctx: GameContext,
  self: CountryId,
  index: number,
  action: "reward" | "dismiss",
): string | null {
  const c = ctx.state.world.countries[self]!;
  const generals = ensureGenerals(ctx, c);
  const g = generals[index];
  if (!g) return "No such general.";
  if (action === "reward") {
    const cost = Math.round(monthlyGdpOf(c) * 0.0005);
    if (c.budget) c.budget.debtCents += cost;
    g.loyalty = Math.min(100, g.loyalty + 20);
    ctx.log("politics", `General ${g.name} received honors and a generous pension plan.`);
    return null;
  }
  // Dismissing a general unsettles the others, but removes a threat.
  const rng = Rng.fromKey(ctx.state.config.worldSeed, `general:${self}:${ctx.state.time}`);
  const n = randomName(rng.pick(["male", "female"] as const), rng);
  generals[index] = {
    name: `${n.firstName} ${n.lastName}`,
    skill: Math.round(rng.float(0.2, 0.7) * 100) / 100,
    loyalty: rng.int(60, 85),
  };
  for (const other of generals)
    if (other !== generals[index]) other.loyalty = Math.max(0, other.loyalty - 8);
  ctx.log("politics", `You dismissed General ${g.name}. ${generals[index]!.name} takes over.`);
  return null;
}

/** The chance this month that disloyal officers seize power. */
export function coupRisk(ctx: GameContext, c: CountryState): number {
  const generals = militaryOf(c).generals ?? [];
  const disloyal = generals.reduce((s, g) => s + Math.max(0, 35 - g.loyalty) / 35, 0);
  const democracy = isDemocratic(c.government) ? 0.3 : 1;
  return Math.min(0.5, disloyal * (1 - c.stability / 100) * 0.08 * democracy);
}

function generalsMonth(ctx: GameContext, c: CountryState): void {
  const generals = ensureGenerals(ctx, c);
  const spending = militaryOf(c).spending;
  for (const g of generals) {
    g.loyalty += (spending - 0.5) * 6 - (c.stability < 30 ? 2 : 0) + ctx.rng.normal(0, 2);
    g.loyalty = Math.round(Math.max(0, Math.min(100, g.loyalty)) * 10) / 10;
  }
  if (!ctx.rng.chance(coupRisk(ctx, c))) return;
  const leader = generals.reduce((a, b) => (a.loyalty < b.loyalty ? a : b));
  seizePower(ctx, c, `General ${leader.name}`);
}

/** A coup: the army takes over and the government falls. */
export function seizePower(ctx: GameContext, c: CountryState, by: string): void {
  const head = ctx.state.politics.offices.find(
    (o) => o.kind === "headOfGovernment" && o.countryId === c.id,
  );
  const playerFalls = head?.holders.includes("player");
  c.government = "militaryJunta";
  c.headOfStateTitle = "General";
  c.rulingPartyId = null;
  c.stability = Math.max(0, c.stability - 10);
  for (const g of militaryOf(c).generals ?? []) g.loyalty = 70;
  if (head && playerFalls) removeFromOffice(ctx, head.id);
  const text = `Coup in ${countryName(ctx, c.id)}! ${by} has seized power.`;
  if (playerFalls || c.id === ctx.geography.cities[ctx.state.player.cityId]!.countryId)
    ctx.alert("bad", text, "politics");
  else ctx.log("politics", text);
}

// ---------------------------------------------------------------------------------------------
// Diplomacy beyond alliances

function toggleKey(list: string[], key: string, on: boolean): string[] {
  const without = list.filter((k) => k !== key);
  return on ? [...without, key] : without;
}

function proposeDeal(
  ctx: GameContext,
  self: CountryId,
  target: CountryId,
  kind: "pact" | "trade",
): string | null {
  const conflict = ctx.state.conflict;
  const key = pairKey(self, target);
  const list = kind === "pact" ? (conflict.pacts ??= []) : (conflict.tradeDeals ??= []);
  if (list.includes(key)) {
    if (kind === "pact") conflict.pacts = toggleKey(list, key, false);
    else conflict.tradeDeals = toggleKey(list, key, false);
    adjustRelation(ctx, self, target, -15);
    ctx.alert(
      "info",
      `You ended the ${kind === "pact" ? "non-aggression pact" : "trade agreement"} with ${countryName(ctx, target)}.`,
      "politics",
    );
    return null;
  }
  if (warBetween(ctx, self, target)) return "You're at war with them.";
  const rel = relation(ctx, self, target);
  const needed = kind === "pact" ? 20 : 30;
  if (rel < needed) return `Relations must be at least ${needed}.`;
  const p = ctx.state.player;
  const cooldown = `${kind}:${target}`;
  if ((p.cooldowns[cooldown] ?? 0) > ctx.state.time) return "They turned you down recently.";
  if (!ctx.rng.chance(Math.min(0.9, (rel - needed + 20) / 60))) {
    p.cooldowns[cooldown] = addDays(ctx.state.time, 90);
    ctx.alert("bad", `${countryName(ctx, target)} declined.`, "politics");
    return null;
  }
  list.push(key);
  adjustRelation(ctx, self, target, 5);
  ctx.alert(
    "good",
    `${countryName(ctx, target)} signed a ${kind === "pact" ? "non-aggression pact" : "trade agreement"} with you.`,
    "politics",
  );
  return null;
}

function setSanctions(
  ctx: GameContext,
  self: CountryId,
  target: CountryId,
  on: boolean,
): string | null {
  const conflict = ctx.state.conflict;
  const key = `${self}>${target}`;
  const list = (conflict.sanctions ??= []);
  if (on === list.includes(key))
    return on ? "You already sanction them." : "You don't sanction them.";
  conflict.sanctions = toggleKey(list, key, on);
  if (on) {
    adjustRelation(ctx, self, target, -25);
    if (hasTradeDeal(ctx, self, target))
      conflict.tradeDeals = (conflict.tradeDeals ?? []).filter((k) => k !== pairKey(self, target));
  }
  ctx.log("politics", `${on ? "Imposed" : "Lifted"} sanctions on ${countryName(ctx, target)}.`);
  return null;
}

function sendAid(
  ctx: GameContext,
  self: CountryId,
  target: CountryId,
  amountCents: number,
): string | null {
  const c = ctx.state.world.countries[self]!;
  const t = ctx.state.world.countries[target]!;
  if (!Number.isInteger(amountCents) || amountCents <= 0) return "Enter an amount.";
  if (amountCents > monthlyGdpOf(c) * 0.05) return "That's more than your treasury can spare.";
  if (c.budget) c.budget.debtCents += amountCents;
  const scale = amountCents / Math.max(1, monthlyGdpOf(t));
  t.stability = Math.min(100, t.stability + Math.min(5, scale * 500));
  adjustRelation(ctx, self, target, Math.min(20, Math.round(scale * 2000) + 2));
  ctx.log(
    "politics",
    `Sent ${formatMoney(amountCents, true)} in aid to ${countryName(ctx, target)}.`,
  );
  return null;
}

// ---------------------------------------------------------------------------------------------
// Intelligence

export type SpyOp = "stealTech" | "sabotage" | "backRebels" | "coup";

export const SPY_OPS: Record<SpyOp, { label: string; description: string }> = {
  stealTech: {
    label: "Steal technology",
    description: "Close the gap if their military tech is better.",
  },
  sabotage: { label: "Sabotage", description: "Damage their army and economy." },
  backRebels: {
    label: "Back rebels",
    description: "Arm an uprising in an unstable region (stability under 60).",
  },
  coup: {
    label: "Support a coup",
    description: "Help their generals overthrow the government. Works best in unstable states.",
  },
};

export function spyOpCost(c: CountryState): number {
  return Math.round(monthlyGdpOf(c) * 0.0005);
}

export function spyOdds(ctx: GameContext, self: CountryId, target: CountryId, op: SpyOp): number {
  const s = ctx.state.world.countries[self]!;
  const t = ctx.state.world.countries[target]!;
  let odds = 0.35 + (s.development - ruleOfLaw(t)) * 0.4;
  if (op === "coup") odds *= t.stability < 40 ? 0.9 : 0.35;
  return Math.max(0.05, Math.min(0.8, odds));
}

function spyOp(ctx: GameContext, self: CountryId, target: CountryId, op: SpyOp): string | null {
  if (!SPY_OPS[op]) return "Unknown operation.";
  const s = ctx.state.world.countries[self]!;
  const t = ctx.state.world.countries[target]!;
  const p = ctx.state.player;
  const key = `spy:${target}`;
  if ((p.cooldowns[key] ?? 0) > ctx.state.time)
    return "Your agents there need to lie low for a while.";
  if (op === "stealTech" && militaryOf(t).tech! <= militaryOf(s).tech!)
    return "Their technology is no better than yours.";
  if (op === "backRebels" && t.stability >= 60)
    return "Their country is too stable for an uprising.";
  p.cooldowns[key] = addDays(ctx.state.time, 60);
  if (s.budget) s.budget.debtCents += spyOpCost(s);
  const name = countryName(ctx, target);
  if (!ctx.rng.chance(spyOdds(ctx, self, target, op))) {
    if (ctx.rng.chance(0.6)) {
      adjustRelation(ctx, self, target, -35);
      p.politics.approval = Math.max(0, p.politics.approval - 5);
      ctx.alert(
        "bad",
        `Your agents in ${name} were caught. It's a diplomatic scandal.`,
        "politics",
      );
    } else {
      ctx.alert(
        "bad",
        `The operation in ${name} failed, but nobody traced it back to you.`,
        "politics",
      );
    }
    return null;
  }
  switch (op) {
    case "stealTech": {
      const ms = militaryOf(s);
      ms.tech = Math.round((ms.tech! + (militaryOf(t).tech! - ms.tech!) * 0.4) * 100) / 100;
      ctx.alert("good", `Your agents stole military blueprints from ${name}.`, "politics");
      break;
    }
    case "sabotage": {
      const mt = militaryOf(t);
      mt.quality = Math.max(0.05, Math.round((mt.quality - 0.05) * 100) / 100);
      t.gdpPerCapita = Math.round(t.gdpPerCapita * 0.995);
      t.stability = Math.max(0, t.stability - 3);
      ctx.alert("good", `Sabotage in ${name}: depots burned and a refinery is down.`, "politics");
      break;
    }
    case "backRebels": {
      const ids = geoCountry(ctx.geography, target)?.provinceIds ?? [];
      const home = ids
        .map((id) => ctx.state.world.provinces[id]!)
        .filter((pr) => pr.population > 0)
        .sort((a, b) => a.stability - b.stability)[0];
      if (!home || ids.length < 2) return null;
      const region = ctx.geography.provinces[home.id]!.name;
      ctx.state.conflict.insurgencies.push({
        id: `i${ctx.state.conflict.nextId++}`,
        name: `${region} Liberation Front`,
        countryId: target,
        fighters: Math.round(150 + home.population / 15000),
        quality: 0.6,
        held: [home.id],
        since: ctx.state.time,
      });
      ctx.alert("good", `With your weapons, rebels have seized ${region} in ${name}.`, "politics");
      break;
    }
    case "coup":
      seizePower(ctx, t, "A military council friendly to you");
      adjustRelation(ctx, self, target, 50);
      break;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Commands for the player's country

type GovCommand =
  | { kind: "budget"; area: BudgetArea; level: number }
  | { kind: "project"; project: ProjectKind; provinceId: ProvinceId }
  | { kind: "ownership"; direction: 1 | -1 }
  | { kind: "tariff"; level: number }
  | { kind: "procure"; branch: Branch; count: number }
  | { kind: "conscription"; on: boolean }
  | { kind: "research"; level: number }
  | { kind: "general"; index: number; action: "reward" | "dismiss" }
  | { kind: "pact"; countryId: CountryId }
  | { kind: "trade"; countryId: CountryId }
  | { kind: "sanction"; countryId: CountryId; on: boolean }
  | { kind: "aid"; countryId: CountryId; amountCents: number }
  | { kind: "spy"; countryId: CountryId; op: SpyOp };

export type GovernmentAction = GovCommand;

/** Everything a head of government can order, in one place. */
export function governmentAction(ctx: GameContext, action: GovCommand): string | null {
  const self = playerRuledCountry(ctx);
  if (!self) return "Only a head of government can do that.";
  const c = ctx.state.world.countries[self]!;
  if ("countryId" in action) {
    const t = ctx.state.world.countries[action.countryId];
    if (action.countryId === self) return "That's your own country.";
    if (!t || t.population === 0) return "That country doesn't exist.";
  }
  switch (action.kind) {
    case "budget":
      return setBudget(ctx, self, action.area, action.level);
    case "project":
      return startProject(ctx, self, action.project, action.provinceId);
    case "ownership":
      return setOwnership(ctx, self, action.direction);
    case "tariff":
      return setTariff(ctx, self, action.level);
    case "procure": {
      if (!(action.branch in UNIT_COST)) return "Unknown branch.";
      if (!Number.isInteger(action.count) || action.count === 0) return "Choose how many.";
      const m = militaryOf(c);
      if (action.count < 0 && (m[action.branch] ?? 0) < -action.count)
        return "You don't have that many.";
      const cost = unitCost(c, action.branch) * Math.max(0, action.count);
      if (cost > monthlyGdpOf(c) * 0.5)
        return "That order is beyond what the treasury can borrow at once.";
      if (c.budget) c.budget.debtCents += cost;
      m[action.branch] = (m[action.branch] ?? 0) + action.count;
      ctx.log(
        "politics",
        `${action.count > 0 ? "Ordered" : "Retired"} ${Math.abs(action.count)} ${action.branch === "armor" ? "armored vehicles" : action.branch === "air" ? "aircraft" : "warships"}${cost > 0 ? ` for ${formatMoney(cost, true)}` : ""}.`,
      );
      return null;
    }
    case "conscription": {
      const m = militaryOf(c);
      if (m.conscription === action.on)
        return action.on ? "Conscription is already in force." : "There is no draft.";
      m.conscription = action.on;
      if (action.on) {
        c.stability = Math.max(0, c.stability - 5);
        if (isDemocratic(c.government))
          ctx.state.player.politics.approval = Math.max(0, ctx.state.player.politics.approval - 8);
      }
      ctx.log("politics", action.on ? "Conscription is now in force." : "You ended conscription.");
      return null;
    }
    case "research":
      if (![0, 0.25, 0.5, 0.75, 1].includes(action.level)) return "Choose a research level.";
      militaryOf(c).research = action.level;
      return null;
    case "general":
      return manageGeneral(ctx, self, action.index, action.action);
    case "pact":
      return proposeDeal(ctx, self, action.countryId, "pact");
    case "trade":
      return proposeDeal(ctx, self, action.countryId, "trade");
    case "sanction":
      return setSanctions(ctx, self, action.countryId, action.on);
    case "aid":
      return sendAid(ctx, self, action.countryId, action.amountCents);
    case "spy":
      return spyOp(ctx, self, action.countryId, action.op);
  }
}

// ---------------------------------------------------------------------------------------------
// Monthly upkeep

function applyPolicies(ctx: GameContext, c: CountryState): void {
  const s = c.statecraft;
  if (!s) return;
  const b = s.budget;
  const shift = (level: number) => level - 0.5;
  for (const pop of c.pops) {
    let delta = shift(b.healthcare) * 2;
    if (pop.class === "lower") delta += shift(b.welfare) * 4;
    if (pop.class === "upper") delta -= shift(b.welfare) * 1 + s.tariff * 2;
    pop.satisfaction = Math.max(0, Math.min(100, pop.satisfaction + delta));
  }
  c.development = Math.max(0, Math.min(1, c.development + shift(b.education) * 0.003));
  c.ruleOfLaw = Math.max(
    0,
    Math.min(
      1,
      Math.round(
        ((c.ruleOfLaw ?? 0.5) + (0.3 + b.police * 0.6 - (c.ruleOfLaw ?? 0.5)) * 0.03) * 1000,
      ) / 1000,
    ),
  );
  c.socialServices = Math.max(
    0,
    Math.min(1, c.socialServices + (b.welfare - c.socialServices) * 0.03),
  );
  c.stability = Math.max(0, Math.min(100, c.stability + shift(b.police) * 0.6));
  c.inflation = Math.min(3, c.inflation + s.tariff * 0.001);
  const growth = s.growthBonus + shift(b.infrastructure) * 0.01 - s.tariff * 0.01;
  c.gdpPerCapita = Math.max(100, Math.round(c.gdpPerCapita * (1 + growth / 12)));

  for (const p of [...s.projects]) {
    if (ctx.state.time < p.doneAt) continue;
    s.projects = s.projects.filter((x) => x !== p);
    if (ctx.geography.provinces[p.provinceId]?.countryId === c.id)
      finishProject(ctx, c, p.kind, p.provinceId);
  }
}

function tradeAndSanctions(ctx: GameContext): void {
  const countries = ctx.state.world.countries;
  for (const key of ctx.state.conflict.tradeDeals ?? []) {
    for (const id of key.split("|")) {
      const c = countries[id];
      if (c && c.population > 0) c.gdpPerCapita = Math.round(c.gdpPerCapita * (1 + 0.0015 / 12));
    }
  }
  for (const key of ctx.state.conflict.sanctions ?? []) {
    const [from, to] = key.split(">") as [CountryId, CountryId];
    const target = countries[to];
    const source = countries[from];
    if (target) target.gdpPerCapita = Math.round(target.gdpPerCapita * (1 - 0.002));
    if (source) source.gdpPerCapita = Math.round(source.gdpPerCapita * (1 - 0.0004));
  }
}

/** Governments that can't pay the interest default: debts are cut, at a heavy price. */
function debtCrises(ctx: GameContext): void {
  for (const c of Object.values(ctx.state.world.countries)) {
    const b = c.budget;
    if (!b || c.population === 0 || b.revenueCents <= 0) continue;
    const s = c.statecraft;
    if (s?.defaultRecovery) {
      s.defaultRecovery--;
      continue;
    }
    // The same rate the budget pays: credit-rated once a leader has set policy.
    const interest = (b.debtCents * (s ? interestRate(c) : 0.03)) / 12;
    if (interest < b.revenueCents * 0.35) continue;
    b.debtCents = Math.round(b.debtCents * 0.5);
    statecraftOf(c).defaultRecovery = 60;
    c.inflation = Math.min(3, c.inflation + 0.15);
    c.stability = Math.max(0, c.stability - 15);
    const text = `${countryName(ctx, c.id)} has defaulted on its debt.`;
    if (c.id === playerRuledCountry(ctx))
      ctx.alert("bad", `${text} Creditors take a loss; your credit rating collapses.`, "politics");
    else ctx.log("economy", text);
  }
}

/** AI juntas and unstable autocracies occasionally fall to coups too. */
function aiCoups(ctx: GameContext): void {
  const ruled = playerRuledCountry(ctx);
  for (const c of Object.values(ctx.state.world.countries)) {
    if (c.id === ruled || c.population === 0 || isDemocratic(c.government) || c.stability >= 25)
      continue;
    if (ctx.rng.chance(0.004)) seizePower(ctx, c, "A group of colonels");
  }
}

function militaryMonth(c: CountryState): void {
  const m = c.military;
  if (!m) return;
  if (m.research) m.tech = Math.min(1, Math.round((m.tech! + m.research * 0.004) * 1000) / 1000);
  if (m.conscription) m.quality = Math.max(0.1, Math.round((m.quality - 0.002) * 1000) / 1000);
}

export const statecraftSystem: System = {
  id: "statecraft",
  onMonth(ctx) {
    for (const c of Object.values(ctx.state.world.countries)) {
      if (c.population === 0) continue;
      applyPolicies(ctx, c);
      militaryMonth(c);
    }
    tradeAndSanctions(ctx);
    debtCrises(ctx);
    aiCoups(ctx);
    const ruled = playerRuledCountry(ctx);
    if (ruled) generalsMonth(ctx, ctx.state.world.countries[ruled]!);
  },
};

/** For the UI: a rough ranking of armed strength. */
export function militaryRank(ctx: GameContext, id: CountryId): number {
  const mine = armyPower(ctx.state.world.countries[id]!);
  return (
    Object.values(ctx.state.world.countries).filter((c) => c.population > 0 && armyPower(c) > mine)
      .length + 1
  );
}

export { hasPact, hasTradeDeal, sanctions };
