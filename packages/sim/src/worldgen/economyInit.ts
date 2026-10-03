import type { Rng } from "../core/rng";
import type {
  CountryState,
  Economy,
  GoodsPrices,
  Healthcare,
  Pop,
  ProvinceState,
  Resource,
} from "../world/types";

const FOOD_RESOURCES: Resource[] = ["farmland", "livestock", "fish"];
const ENERGY_RESOURCES: Resource[] = ["oil", "gas", "coal", "uranium"];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * Starting goods prices. Countries rich in farmland eat cheaply; countries sitting on oil and
 * coal have cheap energy. Richer countries pay a bit more for everyday goods.
 */
function goodsBaseline(country: CountryState, provinces: ProvinceState[], rng: Rng): GoodsPrices {
  const total = Math.max(1, provinces.length);
  const share = (list: Resource[]) =>
    provinces.filter((p) => p.resources.some((r) => list.includes(r))).length / total;
  return {
    food: round3(clamp(1.25 - share(FOOD_RESOURCES) * 0.5 + rng.normal(0, 0.05), 0.7, 1.4)),
    energy: round3(clamp(1.3 - share(ENERGY_RESOURCES) * 0.8 + rng.normal(0, 0.06), 0.55, 1.5)),
    housing: 1,
    goods: round3(clamp(0.9 + country.development * 0.2 + rng.normal(0, 0.04), 0.8, 1.25)),
  };
}

function pickHealthcare(dev: number, rng: Rng): Healthcare {
  if (dev > 0.6)
    return rng.weighted<Healthcare>([
      ["universal", 7],
      ["insurance", 3],
    ]);
  if (dev > 0.35)
    return rng.weighted<Healthcare>([
      ["universal", 3.5],
      ["insurance", 4.5],
      ["none", 2],
    ]);
  return rng.weighted<Healthcare>([
    ["universal", 1.5],
    ["insurance", 2],
    ["none", 6.5],
  ]);
}

export function initialPops(country: CountryState): Pop[] {
  const dev = country.development;
  const lower = clamp(0.68 - 0.36 * dev, 0.25, 0.75);
  const upper = clamp(0.03 + 0.06 * dev, 0.02, 0.12);
  const monthlyMedian = country.medianWageCents * 160;
  const s = country.stability;
  return [
    {
      class: "lower",
      share: round3(lower),
      incomeCents: Math.round(monthlyMedian * 0.55),
      satisfaction: clamp(s - 12, 0, 100),
    },
    {
      class: "middle",
      share: round3(1 - lower - upper),
      incomeCents: Math.round(monthlyMedian * 1.25),
      satisfaction: s,
    },
    {
      class: "upper",
      share: round3(upper),
      incomeCents: Math.round(monthlyMedian * 4.5),
      satisfaction: clamp(s + 10, 0, 100),
    },
  ];
}

/** Fills in a country's economy, social classes, healthcare system and social services. */
export function initCountryEconomy(
  country: CountryState,
  provinces: ProvinceState[],
  rng: Rng,
): void {
  const dev = country.development;
  const baseline = goodsBaseline(country, provinces, rng);
  const economy: Economy = {
    phase: rng.weighted([
      ["expansion", 7],
      ["recovery", 2],
      ["recession", 1],
    ] as const),
    monthsInPhase: rng.int(0, 36),
    growth: round3(clamp(rng.normal(0.035 - dev * 0.015, 0.015), -0.03, 0.08)),
    naturalUnemployment: round3(clamp(country.unemployment * 0.85, 0.02, 0.3)),
    baseInflation: round3(clamp(country.inflation, 0.005, 0.3)),
    priceIndex: 1,
    wageIndex: 1,
    goods: { ...baseline },
    goodsBaseline: baseline,
  };
  country.economy = economy;
  country.pops = initialPops(country);
  country.healthcare = pickHealthcare(dev, rng);
  const democratic =
    country.government === "democracy" || country.government === "constitutionalMonarchy";
  country.socialServices = round3(
    clamp(dev * 0.8 + (democratic ? 0.1 : 0) + rng.float(-0.1, 0.1), 0.05, 0.95),
  );
}
