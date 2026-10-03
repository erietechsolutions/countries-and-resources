import type { GameContext } from "../core/game";
import type { Rng } from "../core/rng";
import type { System } from "../core/systems";
import { layOff } from "../life/activities";
import { formatPercent } from "../world/format";
import type { CountryId } from "../world/geography";
import type { CountryState, EconomicPhase, Good } from "../world/types";
import { createCompany, PHASE_DEMAND, refreshOpenings } from "../work/companies";
import { companyOfJob } from "../work/jobs";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const r4 = (v: number) => Math.round(v * 10000) / 10000;

/** Chance per month of moving to the next phase of the business cycle. */
function phaseChange(phase: EconomicPhase, months: number): number {
  switch (phase) {
    case "expansion":
      return 0.01 + (months > 60 ? 0.015 : 0) + (months > 96 ? 0.02 : 0);
    case "recession":
      return months < 6 ? 0.03 : 0.2;
    case "recovery":
      return months < 6 ? 0.04 : 0.25;
  }
}

const NEXT_PHASE: Record<EconomicPhase, EconomicPhase> = {
  expansion: "recession",
  recession: "recovery",
  recovery: "expansion",
};

/** Long-run growth target for each phase; poorer countries can grow faster. */
function growthTarget(country: CountryState): number {
  const potential = 0.035 - country.development * 0.017;
  switch (country.economy.phase) {
    case "expansion":
      return potential;
    case "recovery":
      return potential * 0.6;
    case "recession":
      return -0.025;
  }
}

export interface MonthlyChange {
  price: number;
  wage: number;
  housing: number;
  food: number;
}

/**
 * Advances one country's economy by a month: business cycle, growth, unemployment, inflation,
 * goods prices (with occasional supply shocks) and wages. Returns this month's price changes so
 * local prices can follow.
 */
export function advanceCountryEconomy(
  country: CountryState,
  rng: Rng,
  onNews?: (msg: string) => void,
): MonthlyChange {
  const e = country.economy;
  e.monthsInPhase++;
  if (rng.chance(phaseChange(e.phase, e.monthsInPhase))) {
    e.phase = NEXT_PHASE[e.phase];
    e.monthsInPhase = 0;
    if (e.phase === "recession") onNews?.("has entered a recession. Businesses are cutting jobs.");
    if (e.phase === "recovery") onNews?.("is starting to recover from the recession.");
    if (e.phase === "expansion") onNews?.("is growing again. Employers are hiring.");
  }

  e.growth = r4(e.growth + (growthTarget(country) - e.growth) * 0.3 + rng.normal(0, 0.003));

  const cyclical = e.phase === "recession" ? 0.04 : e.phase === "recovery" ? 0.015 : -0.005;
  const uTarget = clamp(e.naturalUnemployment + cyclical, 0.015, 0.45);
  country.unemployment = r4(
    clamp(
      country.unemployment + (uTarget - country.unemployment) * 0.15 + rng.normal(0, 0.002),
      0.01,
      0.5,
    ),
  );

  const iTarget =
    e.baseInflation + (e.growth - 0.02) * 0.35 + (e.phase === "recession" ? -0.01 : 0);
  country.inflation = r4(
    clamp(country.inflation + (iTarget - country.inflation) * 0.2 + rng.normal(0, 0.002), -0.03, 3),
  );

  // Goods prices: drift back toward their baseline, with rare supply shocks.
  const before = { ...e.goods };
  for (const g of Object.keys(e.goods) as Good[]) {
    e.goods[g] = r4(e.goods[g] + (e.goodsBaseline[g] - e.goods[g]) * 0.12 + rng.normal(0, 0.006));
  }
  if (rng.chance(0.012)) {
    e.goods.food = r4(e.goods.food * rng.float(1.15, 1.35));
    onNews?.("is hit by a poor harvest. Food prices are rising.");
  }
  if (rng.chance(0.01)) {
    e.goods.energy = r4(e.goods.energy * rng.float(1.2, 1.5));
    onNews?.("faces an energy price shock.");
  }
  // Housing gets steadily pricier when the economy grows.
  e.goodsBaseline.housing = r4(e.goodsBaseline.housing * (1 + Math.max(0, e.growth) * 0.04));

  const priceStep = 1 + country.inflation / 12;
  e.priceIndex = r4(e.priceIndex * priceStep);
  const wageStep =
    1 +
    (country.inflation + e.growth * 0.5 - (country.unemployment - e.naturalUnemployment) * 0.4) /
      12;
  e.wageIndex = r4(e.wageIndex * wageStep);
  country.gdpPerCapita = Math.round(
    country.gdpPerCapita * (1 + (e.growth + country.inflation) / 12),
  );
  country.medianWageCents = Math.max(1, Math.round(country.medianWageCents * wageStep));

  const ratio = (g: Good) => e.goods[g] / before[g];
  return {
    price: priceStep,
    wage: wageStep,
    housing: priceStep * ratio("housing"),
    food: priceStep * (0.6 * ratio("food") + 0.4 * ratio("energy")),
  };
}

/**
 * Social classes react to the economy: real wages, jobs and food prices. Their mood pulls
 * national stability up or down.
 */
export function updatePops(country: CountryState, change: MonthlyChange): void {
  const e = country.economy;
  const realWage = e.wageIndex / e.priceIndex;
  const jobPain = (country.unemployment - e.naturalUnemployment) * 300;
  const foodPain = (e.goods.food / e.goodsBaseline.food - 1) * 60;
  for (const pop of country.pops) {
    pop.incomeCents = Math.round(pop.incomeCents * change.wage);
    const sensitivity = pop.class === "lower" ? 1.4 : pop.class === "middle" ? 1 : 0.5;
    const target = clamp(
      country.stability +
        (realWage - 1) * 120 -
        (jobPain + foodPain) * sensitivity +
        (pop.class === "upper" ? 10 : pop.class === "lower" ? -8 : 0),
      0,
      100,
    );
    pop.satisfaction = Math.round(pop.satisfaction + (target - pop.satisfaction) * 0.15);
  }
  const mood = country.pops.reduce((s, p) => s + p.satisfaction * p.share, 0);
  country.stability = Math.round(
    clamp(country.stability + (mood - country.stability) * 0.05, 0, 100),
  );
}

/** Local prices follow the national economy, more strongly in cities that are booming. */
function updateCities(ctx: GameContext, changes: Map<CountryId, MonthlyChange>): void {
  const p = ctx.state.player;
  ctx.geography.cities.forEach((geoCity, id) => {
    const change = changes.get(geoCity.countryId);
    const city = ctx.state.world.cities[id];
    if (!change || !city) return;
    const oldWage = city.medianWageCents;
    city.medianWageCents = Math.max(1, Math.round(city.medianWageCents * change.wage));
    city.rentCents = Math.max(100, Math.round(city.rentCents * change.housing));
    city.livingCostCents = Math.max(100, Math.round(city.livingCostCents * change.food));
    // The player's pay keeps pace with local wages.
    if (p.job && id === p.cityId && change.wage > 1) {
      p.job.wageCents = Math.round(p.job.wageCents * (city.medianWageCents / oldWage));
    }
  });
  for (const country of Object.values(ctx.state.world.countries)) {
    const change = changes.get(country.id);
    if (change && country.minimumWageCents > 0 && change.price > 1) {
      country.minimumWageCents = Math.round(country.minimumWageCents * change.price);
    }
  }
}

/** Companies grow or shrink with demand, lay people off, fail, and get founded. */
function updateCompanies(ctx: GameContext): void {
  const world = ctx.state.world;
  const rng = ctx.rng;
  const p = ctx.state.player;
  const employer = companyOfJob(ctx);
  for (const company of [...world.companies]) {
    const country = world.countries[ctx.geography.cities[company.cityId]!.countryId]!;
    const demand = PHASE_DEMAND[country.economy.phase];
    company.health = clamp(company.health + (demand - 0.72) * 12 + rng.normal(0, 4), -10, 100);
    company.employees = Math.max(1, Math.round(company.employees * (1 + (demand - 0.8) * 0.05)));
    refreshOpenings(company, demand, rng);

    if (company.health < 0) {
      world.companies = world.companies.filter((c) => c !== company);
      if (company === employer) {
        layOff(ctx, `${company.name} (it went out of business)`);
      } else if (company.cityId === p.cityId) {
        ctx.log("economy", `${company.name} has gone out of business.`);
      }
      continue;
    }
    if (company === employer && company.health < 25 && rng.chance(0.12 * (1.3 - demand))) {
      layOff(ctx, company.name);
    }
  }
  // New businesses open when times are good.
  for (const cityId of world.companyCities) {
    const country = world.countries[ctx.geography.cities[cityId]!.countryId]!;
    const demand = PHASE_DEMAND[country.economy.phase];
    if (rng.chance(0.35 * demand)) {
      const sector = rng.pick([
        "hospitality",
        "retail",
        "logistics",
        "construction",
        "office",
        "healthcare",
      ] as const);
      const company = createCompany(ctx, cityId, sector, rng);
      world.companies.push(company);
      if (cityId === p.cityId) ctx.log("economy", `A new business opened: ${company.name}.`);
    }
  }
}

export const economySystem: System = {
  id: "economy",
  onMonth(ctx) {
    const playerCountry = ctx.geography.cities[ctx.state.player.cityId]!.countryId;
    const changes = new Map<CountryId, MonthlyChange>();
    for (const geoCountry of ctx.geography.countries) {
      const country = ctx.state.world.countries[geoCountry.id];
      if (!country || country.population === 0) continue;
      const wasInflation = country.inflation;
      const change = advanceCountryEconomy(country, ctx.rng, (msg) => {
        if (geoCountry.id === playerCountry)
          ctx.alert("info", `${geoCountry.name} ${msg}`, "economy");
      });
      updatePops(country, change);
      changes.set(geoCountry.id, change);
      if (geoCountry.id === playerCountry && country.inflation > 0.08 && wasInflation <= 0.08) {
        ctx.alert(
          "info",
          `Inflation in ${geoCountry.name} has reached ${formatPercent(country.inflation)}.`,
          "economy",
        );
      }
    }
    updateCities(ctx, changes);
    updateCompanies(ctx);
  },
};
