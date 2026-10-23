import { randomName } from "../character/names";
import type { GameContext } from "../core/game";
import { Rng } from "../core/rng";
import { activeWars } from "../conflict/military";
import type { CountryId } from "../world/geography";
import type { CountryState, Resource } from "../world/types";
import type { MarketsState } from "./types";

export const COMMODITIES: Resource[] = [
  "farmland",
  "livestock",
  "timber",
  "fish",
  "oil",
  "gas",
  "coal",
  "iron",
  "copper",
  "gold",
  "uranium",
  "rareEarths",
];

/** Commodities that spike when wars disrupt supply. */
const WAR_SENSITIVE: Partial<Record<Resource, number>> = {
  oil: 0.04,
  gas: 0.04,
  gold: 0.03,
  uranium: 0.02,
};

export function emptyMarkets(): MarketsState {
  return {
    indexes: {},
    commodities: {} as MarketsState["commodities"],
    lastChange: {},
    richList: [],
  };
}

/** A country's stock index (100 when the game began). */
export function stockIndex(ctx: GameContext, id: CountryId): number {
  return ctx.state.markets.indexes[id] ?? 100;
}

export function commodityPrice(ctx: GameContext, r: Resource): number {
  return ctx.state.markets.commodities[r] ?? 1;
}

/** Yearly yield on a country's government bonds: inflation plus a premium for risk. */
export function bondYield(c: CountryState): number {
  const monthlyGdp = (c.gdpPerCapita * 100 * c.population) / 12;
  const debtRatio = c.budget && monthlyGdp > 0 ? c.budget.debtCents / (monthlyGdp * 12) : 0;
  const risk = Math.max(0, debtRatio - 0.6) * 0.04 + Math.max(0, 50 - c.stability) / 1000;
  return (
    Math.round(Math.max(0.01, Math.min(0.4, 0.015 + Math.max(0, c.inflation) + risk)) * 10000) /
    10000
  );
}

/** Whether a government is close to defaulting on its debt. */
export function defaultRisk(c: CountryState): number {
  const monthlyGdp = (c.gdpPerCapita * 100 * c.population) / 12;
  const debtRatio = c.budget && monthlyGdp > 0 ? c.budget.debtCents / (monthlyGdp * 12) : 0;
  if (debtRatio < 1.2 || c.stability > 40) return 0;
  return Math.min(0.15, (debtRatio - 1.2) * 0.05 + (40 - c.stability) / 800);
}

const PHASE_RETURN = { expansion: 0.007, recovery: 0.012, recession: -0.02 } as const;

/** One month of the world's markets. */
export function updateMarkets(ctx: GameContext): void {
  const m = ctx.state.markets;
  const rng = ctx.rng;
  const atWar = new Set(activeWars(ctx).flatMap((w) => [...w.attackers, ...w.defenders]));
  for (const c of Object.values(ctx.state.world.countries)) {
    if (c.population === 0) continue;
    const volatility = 0.025 + (1 - c.development) * 0.035;
    const r =
      c.economy.growth / 12 +
      PHASE_RETURN[c.economy.phase] -
      (atWar.has(c.id) ? 0.02 : 0) -
      (c.stability < 30 ? 0.01 : 0) +
      rng.normal(0, volatility);
    const before = m.indexes[c.id] ?? 100;
    m.indexes[c.id] = Math.max(1, Math.round(before * (1 + r) * 100) / 100);
    m.lastChange[c.id] = Math.round(r * 10000) / 10000;
  }
  const wars = activeWars(ctx).length;
  for (const r of COMMODITIES) {
    const before = m.commodities[r] ?? 1;
    const shock = (WAR_SENSITIVE[r] ?? 0) * wars;
    const change = (1 - before) * 0.08 + shock + rng.normal(0, 0.045);
    m.commodities[r] = Math.max(0.2, Math.round(before * (1 + change) * 1000) / 1000);
    m.lastChange[r] = Math.round(change * 10000) / 10000;
  }
  // The rich get richer with the markets.
  const avg =
    Object.values(m.lastChange).reduce((s, x) => s + x, 0) /
    Math.max(1, Object.keys(m.lastChange).length);
  for (const t of m.richList)
    t.netWorthCents = Math.round(t.netWorthCents * (1 + avg + rng.normal(0.003, 0.03)));
  m.richList.sort((a, b) => b.netWorthCents - a.netWorthCents);
}

/** The world's richest people, generated from the world seed the first time they're needed. */
export function ensureRichList(ctx: GameContext): void {
  const m = ctx.state.markets;
  if (m.richList.length > 0) return;
  const rng = Rng.fromKey(ctx.state.config.worldSeed, "richList");
  const countries = Object.values(ctx.state.world.countries)
    .filter((c) => c.population > 0)
    .sort((a, b) => b.gdpPerCapita * b.population - a.gdpPerCapita * a.population)
    .slice(0, 30);
  for (let i = 0; i < 40; i++) {
    const c = rng.pick(countries);
    const name = randomName(rng.pick(["male", "female"] as const), rng);
    m.richList.push({
      name: `${name.firstName} ${name.lastName}`,
      countryId: c.id,
      // From a few hundred million to a couple of hundred billion dollars.
      netWorthCents: Math.round(Math.exp(rng.float(Math.log(3e10), Math.log(2e13)))),
    });
  }
  m.richList.sort((a, b) => b.netWorthCents - a.netWorthCents);
}
