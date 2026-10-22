import { Rng } from "../core/rng";
import type { CountryId, GeoCity, GeoProvince, WorldGeography } from "../world/geography";
import type {
  Biome,
  CityState,
  CountryState,
  GovernmentType,
  ProvinceState,
  Resource,
  WorldState,
} from "../world/types";
import { hslToHex, POLITICAL_HUES } from "./color";
import { initCountryEconomy } from "./economyInit";
import { generateParties } from "./parties";

/**
 * Generates economies, governments, parties, climates and resources for a geography.
 * Used by Economic and Hard Economic modes: no real-world economic data is involved; the map
 * only contributes geography (borders, latitude, coastlines, relative settlement sizes).
 *
 * Every value comes from a keyed Rng stream, so the same seed always produces the same world.
 */
export function generateWorld(geography: WorldGeography, seed: number): WorldState {
  const provinceBiomes = generateBiomes(geography, seed);
  const countryNeighbors = buildCountryAdjacency(geography);
  const development = generateDevelopment(geography, seed, countryNeighbors);
  const colors = assignPoliticalColors(geography, seed, countryNeighbors);

  const weights = countryCityWeights(geography);
  const countries: Record<CountryId, CountryState> = {};
  const provinces: ProvinceState[] = new Array(geography.provinces.length);
  const cities: CityState[] = new Array(geography.cities.length);

  for (const geoCountry of geography.countries) {
    const rng = Rng.fromKey(seed, `country:${geoCountry.id}`);
    const dev = development.get(geoCountry.id) ?? 0.5;
    const country = generateCountry(geoCountry.id, dev, colors.get(geoCountry.id) ?? 0x888888, rng);
    countries[geoCountry.id] = country;

    const geoProvinces = geoCountry.provinceIds.map((id) => geography.provinces[id]!);
    const habitableArea = geoProvinces.reduce(
      (sum, p) => sum + p.areaKm2 * HABITABILITY[provinceBiomes[p.id]!],
      0,
    );
    if (!geoCountry.habitable) {
      country.population = 0;
    } else {
      // People per km² of habitable land. Tiny territories tend to be dense city-states.
      // Very large countries are dampened so continental nations stay plausible.
      const sizeDamping = habitableArea > 1e6 ? (1e6 / habitableArea) ** 0.35 : 1;
      const density =
        habitableArea < 2000
          ? rng.float(300, 4000)
          : clamp(Math.exp(rng.normal(Math.log(65), 0.75)) * sizeDamping, 2, 1000);
      const byArea = Math.round(habitableArea * density);
      // Countries full of large settlements can't be nearly empty: their towns set a floor.
      const bySettlements = Math.round(
        // Map city sizes are metro-wide figures, often repeated for suburbs: discount them.
        (((weights.get(geoCountry.id) ?? 0) * 0.45) / urbanShareOf(country)) * rng.float(0.7, 1.3),
      );
      country.population = Math.max(1_000, byArea, bySettlements);
    }

    generateProvinces(geography, geoProvinces, provinceBiomes, country, seed, provinces);
    initCountryEconomy(
      country,
      geoCountry.provinceIds.map((id) => provinces[id]!),
      Rng.fromKey(seed, `economy:${geoCountry.id}`),
    );
  }

  for (const geoCity of geography.cities) {
    cities[geoCity.id] = generateCity(geoCity, weights, countries, seed);
  }
  fitPopulationToCities(geography, countries, provinces, cities, "add");

  return {
    geographyId: geography.id,
    countries,
    companies: [],
    companyCities: [],
    nextCompanyId: 1,
    provinces,
    cities,
  };
}

// ---------------------------------------------------------------------------------------------
// Countries

const GOVERNMENT_WEIGHTS: Record<GovernmentType, [low: number, high: number]> = {
  democracy: [0.25, 0.62],
  constitutionalMonarchy: [0.05, 0.15],
  oligarchy: [0.18, 0.08],
  oneParty: [0.18, 0.06],
  militaryJunta: [0.14, 0.02],
  absoluteMonarchy: [0.1, 0.04],
  theocracy: [0.1, 0.03],
};

const STABILITY_BONUS: Record<GovernmentType, number> = {
  democracy: 5,
  constitutionalMonarchy: 8,
  oligarchy: -3,
  oneParty: 4,
  militaryJunta: -12,
  absoluteMonarchy: 0,
  theocracy: -2,
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round2 = (v: number) => Math.round(v * 100) / 100;
const round3 = (v: number) => Math.round(v * 1000) / 1000;

export function headOfStateTitle(government: GovernmentType, rng: Rng): string {
  switch (government) {
    case "democracy":
      return rng.pick(["President", "Prime Minister", "Chancellor"]);
    case "constitutionalMonarchy":
      return "Prime Minister";
    case "oligarchy":
      return "President";
    case "oneParty":
      return rng.pick(["General Secretary", "Chairman", "President"]);
    case "militaryJunta":
      return rng.pick(["General", "Chairman of the Council", "Marshal"]);
    case "absoluteMonarchy":
      return rng.pick(["King", "Queen", "Emir", "Sultan"]);
    case "theocracy":
      return "Supreme Leader";
  }
}

function generateCountry(id: CountryId, dev: number, color: number, rng: Rng): CountryState {
  const government = rng.weighted(
    (Object.entries(GOVERNMENT_WEIGHTS) as [GovernmentType, [number, number]][]).map(
      ([g, [lo, hi]]) => [g, lo + (hi - lo) * dev] as const,
    ),
  );
  const gdpPerCapita = Math.round(900 * Math.exp(dev * 4.1) * rng.float(0.85, 1.15));
  const stability = Math.round(
    clamp(35 + dev * 45 + STABILITY_BONUS[government] + rng.normal(0, 10), 5, 98),
  );
  let inflation = clamp(
    rng.normal(0.03 + (1 - dev) * 0.05 + (1 - stability / 100) * 0.05, 0.02),
    -0.01,
    0.4,
  );
  if (stability < 30 && rng.chance(0.2)) inflation = rng.float(0.5, 2.5); // hyperinflation
  const unemployment = clamp(
    rng.normal(0.05 + (1 - dev) * 0.06 + (1 - stability / 100) * 0.04, 0.025),
    0.015,
    0.4,
  );
  const medianWageCents = Math.max(25, Math.round((gdpPerCapita / 2080) * 0.85 * 100));
  const hasMinimumWage = rng.chance(0.55 + dev * 0.35);
  const { parties, rulingPartyId } = generateParties(id, government, rng);

  return {
    id,
    government,
    headOfStateTitle: headOfStateTitle(government, rng),
    development: round3(dev),
    population: 0,
    gdpPerCapita,
    unemployment: round3(unemployment),
    inflation: round3(inflation),
    stability,
    taxes: {
      income: round2(clamp(rng.normal(0.06 + dev * 0.26, 0.05), 0, 0.5)),
      corporate: round2(clamp(rng.normal(0.22, 0.06), 0, 0.4)),
      sales: round2(clamp(rng.normal(0.1 + dev * 0.06, 0.05), 0, 0.27)),
    },
    minimumWageCents: hasMinimumWage
      ? Math.max(5, Math.round(medianWageCents * rng.float(0.35, 0.6)))
      : 0,
    medianWageCents,
    costOfLivingIndex: Math.round(100 * (gdpPerCapita / 12000) ** 0.6 * rng.float(0.9, 1.1)),
    parties,
    rulingPartyId,
    color,
    // Filled in by initCountryEconomy once the country's provinces exist.
    economy: undefined as unknown as CountryState["economy"],
    pops: [],
    healthcare: "none",
    socialServices: 0,
  };
}

function buildCountryAdjacency(geography: WorldGeography): Map<CountryId, Set<CountryId>> {
  const adjacency = new Map<CountryId, Set<CountryId>>();
  for (const c of geography.countries) adjacency.set(c.id, new Set());
  for (const p of geography.provinces) {
    for (const n of p.neighbors) {
      const other = geography.provinces[n]!.countryId;
      if (other !== p.countryId) adjacency.get(p.countryId)!.add(other);
    }
  }
  return adjacency;
}

/**
 * Development (0–1) is random but spatially correlated, so rich and poor regions form clusters
 * instead of a checkerboard. Values are smoothed with neighbors, then spread back out by rank.
 */
function generateDevelopment(
  geography: WorldGeography,
  seed: number,
  neighbors: Map<CountryId, Set<CountryId>>,
): Map<CountryId, number> {
  let values = new Map<CountryId, number>();
  for (const c of geography.countries) {
    const rng = Rng.fromKey(seed, `development:${c.id}`);
    values.set(c.id, (rng.next() + rng.next() + rng.next()) / 3);
  }
  for (let pass = 0; pass < 2; pass++) {
    const next = new Map<CountryId, number>();
    for (const [id, v] of values) {
      const ns = [...neighbors.get(id)!];
      if (ns.length === 0) {
        next.set(id, v);
        continue;
      }
      const avg = ns.reduce((s, n) => s + values.get(n)!, 0) / ns.length;
      next.set(id, v * 0.5 + avg * 0.5);
    }
    values = next;
  }
  const ranked = [...values.entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
  const result = new Map<CountryId, number>();
  ranked.forEach(([id], i) => {
    const jitter = Rng.fromKey(seed, `development-jitter:${id}`).float(-0.04, 0.04);
    result.set(id, clamp(0.03 + (i / Math.max(1, ranked.length - 1)) * 0.94 + jitter, 0, 1));
  });
  return result;
}

/** Greedy graph coloring so neighboring countries never share a political map color. */
function assignPoliticalColors(
  geography: WorldGeography,
  seed: number,
  neighbors: Map<CountryId, Set<CountryId>>,
): Map<CountryId, number> {
  const hueIndex = new Map<CountryId, number>();
  const order = [...geography.countries].sort(
    (a, b) => neighbors.get(b.id)!.size - neighbors.get(a.id)!.size || a.id.localeCompare(b.id),
  );
  const colors = new Map<CountryId, number>();
  for (const c of order) {
    const rng = Rng.fromKey(seed, `color:${c.id}`);
    const used = new Set([...neighbors.get(c.id)!].map((n) => hueIndex.get(n)));
    const start = rng.int(0, POLITICAL_HUES.length - 1);
    let index = start;
    for (let i = 0; i < POLITICAL_HUES.length; i++) {
      const candidate = (start + i) % POLITICAL_HUES.length;
      if (!used.has(candidate)) {
        index = candidate;
        break;
      }
    }
    hueIndex.set(c.id, index);
    colors.set(
      c.id,
      hslToHex(
        POLITICAL_HUES[index]! + rng.float(-6, 6),
        rng.float(0.32, 0.48),
        rng.float(0.5, 0.62),
      ),
    );
  }
  return colors;
}

// ---------------------------------------------------------------------------------------------
// Provinces

const HABITABILITY: Record<Biome, number> = {
  polar: 0.005,
  tundra: 0.04,
  boreal: 0.2,
  mountains: 0.3,
  desert: 0.08,
  steppe: 0.4,
  savanna: 0.6,
  tropical: 0.55,
  grassland: 0.9,
  temperate: 1,
  mediterranean: 1,
};

const BIOME_RESOURCES: Record<Biome, [Resource, number][]> = {
  polar: [
    ["oil", 2],
    ["gas", 2],
    ["rareEarths", 1],
  ],
  tundra: [
    ["oil", 3],
    ["gas", 3],
    ["iron", 1],
    ["gold", 1],
    ["uranium", 1],
  ],
  boreal: [
    ["timber", 5],
    ["iron", 2],
    ["oil", 1],
    ["coal", 1],
    ["gold", 1],
  ],
  mountains: [
    ["copper", 3],
    ["gold", 2],
    ["iron", 2],
    ["coal", 2],
    ["uranium", 1],
    ["rareEarths", 1],
    ["livestock", 1],
  ],
  desert: [
    ["oil", 5],
    ["gas", 3],
    ["copper", 1],
    ["uranium", 1],
    ["rareEarths", 1],
  ],
  steppe: [
    ["livestock", 4],
    ["farmland", 2],
    ["coal", 2],
    ["oil", 1],
    ["uranium", 1],
  ],
  savanna: [
    ["livestock", 4],
    ["farmland", 3],
    ["gold", 1],
    ["copper", 1],
  ],
  tropical: [
    ["timber", 4],
    ["farmland", 3],
    ["oil", 1],
    ["rareEarths", 1],
  ],
  grassland: [
    ["farmland", 6],
    ["livestock", 3],
    ["coal", 1],
    ["oil", 1],
  ],
  temperate: [
    ["farmland", 5],
    ["timber", 3],
    ["coal", 2],
    ["iron", 2],
    ["gas", 1],
  ],
  mediterranean: [
    ["farmland", 5],
    ["livestock", 2],
    ["copper", 1],
  ],
};

/** Climate from latitude plus noise, then smoothed so neighboring provinces form regions. */
function generateBiomes(geography: WorldGeography, seed: number): Biome[] {
  const initial = geography.provinces.map((p) => {
    const rng = Rng.fromKey(seed, `biome:${p.id}`);
    const lat = Math.abs(p.lat) + rng.normal(0, 4);
    const mountainRoll = rng.chance(0.12);
    const mountainous = p.elevation !== undefined ? p.elevation > 0.62 : mountainRoll;
    if (mountainous && lat < 70) return "mountains" as Biome;
    if (lat > 72) return "polar";
    if (lat > 62) return "tundra";
    if (lat > 50)
      return rng.weighted<Biome>([
        ["boreal", 6],
        ["temperate", 3],
        ["grassland", 1],
      ]);
    if (lat > 35) {
      return rng.weighted<Biome>([
        ["temperate", 5],
        ["grassland", 3],
        ["mediterranean", 2],
        ["steppe", 2],
      ]);
    }
    if (lat > 15) {
      return rng.weighted<Biome>([
        ["desert", 4],
        ["steppe", 3],
        ["savanna", 2],
        ["mediterranean", 1],
        ["grassland", 1],
      ]);
    }
    return rng.weighted<Biome>([
      ["tropical", 5],
      ["savanna", 4],
      ["grassland", 1],
    ]);
  });

  return geography.provinces.map((p) => {
    const own = initial[p.id]!;
    if (own === "mountains" || p.neighbors.length < 2) return own;
    const counts = new Map<Biome, number>();
    for (const n of p.neighbors) {
      const b = initial[n]!;
      if (b !== "mountains") counts.set(b, (counts.get(b) ?? 0) + 1);
    }
    let majority: Biome = own;
    let best = 0;
    for (const [b, c] of counts) {
      if (c > best || (c === best && b < majority)) {
        majority = b;
        best = c;
      }
    }
    const rng = Rng.fromKey(seed, `biome-smooth:${p.id}`);
    return best >= 2 && majority !== own && rng.chance(0.6) ? majority : own;
  });
}

function generateResources(p: GeoProvince, biome: Biome, rng: Rng): Resource[] {
  const pool = [...BIOME_RESOURCES[biome]];
  if (p.coastal) pool.push(["fish", 4], ["oil", 1]);
  const count = rng.weighted([
    [0, 1],
    [1, 4],
    [2, 4],
    [3, 2],
  ] as const);
  const chosen: Resource[] = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const r = rng.weighted(pool);
    chosen.push(r);
    for (let j = pool.length - 1; j >= 0; j--) if (pool[j]![0] === r) pool.splice(j, 1);
  }
  return chosen;
}

function generateProvinces(
  geography: WorldGeography,
  geoProvinces: GeoProvince[],
  biomes: Biome[],
  country: CountryState,
  seed: number,
  out: ProvinceState[],
) {
  // Settlement weights from the map's relative city sizes (not real population figures).
  const cityWeight = new Map<number, number>();
  for (const c of geography.cities) {
    if (c.countryId !== country.id) continue;
    cityWeight.set(c.provinceId, (cityWeight.get(c.provinceId) ?? 0) + 10 ** (c.importance - 5));
  }
  const weights = geoProvinces.map((p) => {
    const land = (p.areaKm2 * HABITABILITY[biomes[p.id]!]) ** 0.6;
    return land / 100 + (cityWeight.get(p.id) ?? 0) * 0.3 + 0.01;
  });
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const baseUrbanization = 0.25 + country.development * 0.55;

  geoProvinces.forEach((p, i) => {
    const rng = Rng.fromKey(seed, `province:${p.id}`);
    const share = weights[i]! / totalWeight;
    const urbanBoost = Math.min(0.25, (cityWeight.get(p.id) ?? 0) * 0.05);
    const urbanization = clamp(baseUrbanization + urbanBoost + rng.normal(0, 0.08), 0.02, 0.98);
    out[p.id] = {
      id: p.id,
      // Rural population only; city populations are added once cities exist.
      population: Math.round(country.population * (1 - urbanShareOf(country)) * share),
      gdpPerCapita: Math.round(
        country.gdpPerCapita * (0.65 + urbanization * 0.7) * rng.float(0.85, 1.15),
      ),
      urbanization: round2(urbanization),
      biome: biomes[p.id]!,
      resources: generateResources(p, biomes[p.id]!, rng),
      stability: Math.round(clamp(country.stability + rng.normal(0, 8), 0, 100)),
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Cities

/**
 * Generates economic data for cities a world doesn't have yet, e.g. towns added to the map after a
 * save was made. Values are scaled by the economy's price and wage changes since the game began.
 */
export function generateMissingCities(
  geography: WorldGeography,
  world: WorldState,
  seed: number,
): number {
  const missing = geography.cities.filter((c) => !world.cities[c.id]);
  if (missing.length === 0) return 0;
  const weights = countryCityWeights(geography);
  for (const geoCity of missing) {
    const city = generateCity(geoCity, weights, world.countries, seed);
    const e = world.countries[geoCity.countryId]?.economy;
    if (e) {
      city.medianWageCents = Math.round(city.medianWageCents * e.wageIndex);
      city.rentCents = Math.round(city.rentCents * e.priceIndex);
      city.livingCostCents = Math.round(city.livingCostCents * e.priceIndex);
    }
    world.cities[geoCity.id] = city;
  }
  fitPopulationToCities(geography, world.countries, world.provinces, world.cities, "atLeast");
  return missing.length;
}

/** Share of a country's people living in its named cities and towns. */
const urbanShareOf = (country: CountryState) => (0.25 + country.development * 0.55) * 0.7;

const cityWeight = (c: GeoCity) => 10 ** c.importance * (c.capital === 2 ? 1.5 : 1);

/** Sum of settlement weights per country, used to share out each country's urban population. */
function countryCityWeights(geography: WorldGeography): Map<CountryId, number> {
  const totals = new Map<CountryId, number>();
  for (const c of geography.cities)
    totals.set(c.countryId, (totals.get(c.countryId) ?? 0) + cityWeight(c));
  return totals;
}

/**
 * Puts each region's city dwellers into its population and recomputes country totals.
 * "add": regions start with rural population only (new worlds). "atLeast": regions are raised
 * just enough to hold their cities (older saves gaining new towns).
 */
function fitPopulationToCities(
  geography: WorldGeography,
  countries: Record<CountryId, CountryState>,
  provinces: ProvinceState[],
  cities: CityState[],
  mode: "add" | "atLeast",
): void {
  const urban = new Map<number, number>();
  for (const c of geography.cities) {
    urban.set(c.provinceId, (urban.get(c.provinceId) ?? 0) + (cities[c.id]?.population ?? 0));
  }
  for (const [provinceId, people] of urban) {
    const province = provinces[provinceId];
    if (!province) continue;
    if (mode === "add") {
      province.population += people;
    } else {
      const needed = Math.ceil(people / Math.max(0.35, province.urbanization));
      if (province.population < needed) province.population = needed;
    }
  }
  for (const geoCountry of geography.countries) {
    const country = countries[geoCountry.id];
    if (!country || country.population === 0) continue;
    country.population = geoCountry.provinceIds.reduce(
      (sum, id) => sum + (provinces[id]?.population ?? 0),
      0,
    );
  }
}

function generateCity(
  geoCity: GeoCity,
  weights: Map<CountryId, number>,
  countries: Record<CountryId, CountryState>,
  seed: number,
): CityState {
  const cityId = geoCity.id;
  const rng = Rng.fromKey(seed, `city:${cityId}`);
  const country = countries[geoCity.countryId]!;

  // A country's urban population is shared among its settlements by their relative size, so a
  // big city stays big even when it sits in a tiny region.
  const urbanShare = urbanShareOf(country);
  const share = cityWeight(geoCity) / (weights.get(geoCity.countryId) ?? cityWeight(geoCity));
  let population = Math.max(
    300,
    Math.round(country.population * urbanShare * share * rng.float(0.85, 1.15)),
  );
  // Soft cap so no city grows far beyond the largest real-world metro areas.
  if (population > 20_000_000)
    population = Math.round(20_000_000 + (population - 20_000_000) * 0.3);

  // 0 for a town of 10k, 1 for a metropolis of 10M.
  const size = clamp((Math.log10(population) - 4) / 3, 0, 1);
  const medianWageCents = Math.round(
    country.medianWageCents * (0.8 + 0.45 * size) * rng.float(0.92, 1.08),
  );
  const costOfLivingIndex = Math.round(
    country.costOfLivingIndex * (0.75 + 0.6 * size) * rng.float(0.9, 1.1),
  );
  const monthlyMedianIncome = medianWageCents * 160;
  return {
    id: cityId,
    population,
    medianWageCents,
    rentCents:
      Math.round((monthlyMedianIncome * 0.3 * (0.75 + 0.6 * size) * rng.float(0.85, 1.15)) / 100) *
      100,
    livingCostCents: Math.round((monthlyMedianIncome * 0.3 * rng.float(0.9, 1.1)) / 100) * 100,
    costOfLivingIndex,
  };
}
