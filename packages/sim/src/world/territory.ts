import type { GameContext } from "../core/game";
import type { CityId, CountryId, GeoCountry, ProvinceId, WorldGeography } from "./geography";
import type { GovernmentType, WorldState } from "./types";

/**
 * Borders can change during play: militias take regions, wars end in annexations and new
 * countries are founded. The map file never changes, so each game works on a live copy of it
 * with the save's territorial changes applied. The copy is shallow (shapes and borders are
 * shared), so it is cheap, and everything that asks "which country is this city in?" keeps
 * working unchanged.
 */
export function liveGeography(base: WorldGeography, world: WorldState): WorldGeography {
  const geo: WorldGeography = {
    ...base,
    countries: base.countries.map((c) => ({
      ...c,
      provinceIds: [...c.provinceIds],
      homeCapitalCityId: c.homeCapitalCityId ?? c.capitalCityId,
    })),
    provinces: base.provinces.map((p) => ({ ...p })),
    cities: base.cities.map((c) => ({ ...c })),
  };
  for (const f of world.foundedCountries ?? []) {
    geo.countries.push({
      id: f.id,
      name: f.name,
      provinceIds: [],
      capitalCityId: f.capitalCityId,
      homeCapitalCityId: f.capitalCityId,
      habitable: true,
    });
  }
  for (const [id, owner] of Object.entries(world.provinceOwners ?? {})) {
    setOwner(geo, Number(id), owner);
  }
  for (const c of geo.countries) refreshCapital(geo, c);
  return geo;
}

export function geoCountry(geo: WorldGeography, id: CountryId): GeoCountry | undefined {
  return geo.countries.find((c) => c.id === id);
}

export function countryName(ctx: GameContext, id: CountryId): string {
  return geoCountry(ctx.geography, id)?.name ?? id;
}

export function citiesInProvince(geo: WorldGeography, provinceId: ProvinceId): CityId[] {
  const ids: CityId[] = [];
  for (const c of geo.cities) if (c.provinceId === provinceId) ids.push(c.id);
  return ids;
}

/** Countries that share a land border with this one. */
export function landNeighbors(geo: WorldGeography, id: CountryId): CountryId[] {
  const result = new Set<CountryId>();
  for (const pid of geoCountry(geo, id)?.provinceIds ?? []) {
    for (const n of geo.provinces[pid]!.neighbors) {
      const other = geo.provinces[n]!.countryId;
      if (other !== id) result.add(other);
    }
  }
  return [...result].sort();
}

/** Provinces of `target` that touch provinces of `from`. */
export function borderProvinces(
  geo: WorldGeography,
  from: CountryId,
  target: CountryId,
): ProvinceId[] {
  const result = new Set<ProvinceId>();
  for (const pid of geoCountry(geo, from)?.provinceIds ?? []) {
    for (const n of geo.provinces[pid]!.neighbors) {
      if (geo.provinces[n]!.countryId === target) result.add(n);
    }
  }
  return [...result].sort((a, b) => a - b);
}

function setOwner(geo: WorldGeography, provinceId: ProvinceId, owner: CountryId): void {
  const province = geo.provinces[provinceId];
  const next = geoCountry(geo, owner);
  if (!province || !next || province.countryId === owner) return;
  const old = geoCountry(geo, province.countryId);
  if (old) old.provinceIds = old.provinceIds.filter((id) => id !== provinceId);
  next.provinceIds.push(provinceId);
  province.countryId = owner;
  for (const city of geo.cities) if (city.provinceId === provinceId) city.countryId = owner;
}

/**
 * A country's capital is its original one while it still holds it; otherwise its largest city.
 * Depending only on current borders keeps capitals the same after a save is reloaded.
 */
function refreshCapital(geo: WorldGeography, country: GeoCountry): void {
  const owns = (id: CityId | null | undefined) =>
    id !== null && id !== undefined && geo.cities[id]?.countryId === country.id;
  if (owns(country.homeCapitalCityId)) {
    country.capitalCityId = country.homeCapitalCityId!;
    return;
  }
  let best: CityId | null = null;
  let bestSize = -Infinity;
  for (const pid of country.provinceIds) {
    for (const city of geo.cities) {
      if (city.provinceId !== pid || city.importance <= bestSize) continue;
      best = city.id;
      bestSize = city.importance;
    }
  }
  country.capitalCityId = best;
}

/**
 * Hands a province to another country: the map, populations, local offices and the player's
 * legal status all follow.
 */
export function transferProvince(ctx: GameContext, provinceId: ProvinceId, to: CountryId): void {
  const geo = ctx.geography;
  const world = ctx.state.world;
  const province = geo.provinces[provinceId];
  if (!province || province.countryId === to || !world.countries[to]) return;
  const from = province.countryId;

  world.provinceOwners ??= {};
  world.provinceOwners[provinceId] = to;
  world.territoryVersion = (world.territoryVersion ?? 0) + 1;
  setOwner(geo, provinceId, to);
  for (const id of [from, to]) {
    const c = geoCountry(geo, id);
    if (c) refreshCapital(geo, c);
  }

  const pop = world.provinces[provinceId]?.population ?? 0;
  const old = world.countries[from];
  if (old)
    old.population = geoCountry(geo, from)!.provinceIds.length
      ? Math.max(0, old.population - pop)
      : 0;
  world.countries[to]!.population += pop;

  dropLocalOffices(ctx, provinceId);

  const p = ctx.state.player;
  if (geo.cities[p.cityId]?.provinceId === provinceId) {
    p.residency = {
      countryId: to,
      status: p.citizenship.includes(to) ? "citizen" : "permanent",
      since: ctx.state.time,
      expiresAt: null,
    };
    if (
      p.politics.partyId &&
      !world.countries[to]!.parties.some((x) => x.id === p.politics.partyId)
    ) {
      p.politics = { ...p.politics, partyId: null, rank: 0, standing: 0, candidacy: null };
    }
    ctx.alert(
      "info",
      `${province.name} is now part of ${countryName(ctx, to)}. You live under its laws now.`,
      "politics",
    );
  }
}

/** City and regional offices belong to the old country; the new one sets up its own. */
function dropLocalOffices(ctx: GameContext, provinceId: ProvinceId): void {
  const politics = ctx.state.politics;
  const geo = ctx.geography;
  const inProvince = (o: { cityId?: CityId; provinceId?: ProvinceId }) =>
    o.provinceId === provinceId ||
    (o.cityId !== undefined && geo.cities[o.cityId]?.provinceId === provinceId);
  const dropped = politics.offices.filter((o) => o.level !== "national" && inProvince(o));
  if (dropped.length === 0) return;
  const ids = new Set(dropped.map((o) => o.id));
  for (const o of dropped) {
    if (o.holders.includes("player"))
      ctx.alert("bad", `You lost your position: ${o.title}.`, "politics");
  }
  politics.offices = politics.offices.filter((o) => !ids.has(o.id));
  const electionIds = new Set(
    politics.elections.filter((e) => ids.has(e.officeId)).map((e) => e.id),
  );
  politics.elections = politics.elections.filter((e) => !electionIds.has(e.id));
  const c = ctx.state.player.politics.candidacy;
  if (c && electionIds.has(c.electionId)) ctx.state.player.politics.candidacy = null;
  politics.setUpCities = politics.setUpCities.filter(
    (id) => geo.cities[id]?.provinceId !== provinceId,
  );
}

export interface NewCountry {
  name: string;
  parentId: CountryId;
  founderId: string;
  government: GovernmentType;
  provinces: ProvinceId[];
  color: number;
}

/** Ids for countries founded in play: "X1", "X2"... never clashing with map ids. */
export function nextCountryId(world: WorldState): CountryId {
  let n = (world.foundedCountries?.length ?? 0) + 1;
  while (world.countries[`X${n}`]) n++;
  return `X${n}`;
}

/** Registers a new country on the live map and gives it its provinces. */
export function registerCountry(ctx: GameContext, id: CountryId, spec: NewCountry): void {
  const world = ctx.state.world;
  const geo = ctx.geography;
  // Capital: the largest city in the new territory.
  let capital: CityId | null = null;
  let size = -Infinity;
  for (const city of geo.cities) {
    if (spec.provinces.includes(city.provinceId) && city.importance > size) {
      capital = city.id;
      size = city.importance;
    }
  }
  world.foundedCountries ??= [];
  world.foundedCountries.push({
    id,
    name: spec.name,
    parentId: spec.parentId,
    founderId: spec.founderId,
    foundedAt: ctx.state.time,
    capitalCityId: capital,
  });
  geo.countries.push({
    id,
    name: spec.name,
    provinceIds: [],
    capitalCityId: capital,
    homeCapitalCityId: capital,
    habitable: true,
  });
  for (const pid of spec.provinces) transferProvince(ctx, pid, id);
}
