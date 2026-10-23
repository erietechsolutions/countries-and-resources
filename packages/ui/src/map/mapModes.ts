import {
  armyPower,
  BIOME_LABELS,
  RESOURCE_LABELS,
  formatMoney,
  type Biome,
  type ConflictState,
  type Resource,
  type WorldGeography,
  type WorldState,
} from "@cr/sim";

export type MapMode =
  "political" | "terrain" | "resources" | "wealth" | "stability" | "conflict" | "military";

export const MAP_MODES: { id: MapMode; label: string; key: string }[] = [
  { id: "political", label: "Political", key: "Q" },
  { id: "terrain", label: "Terrain", key: "W" },
  { id: "resources", label: "Resources", key: "E" },
  { id: "wealth", label: "Wealth", key: "R" },
  { id: "stability", label: "Stability", key: "T" },
  { id: "conflict", label: "Conflict", key: "Y" },
  { id: "military", label: "Military", key: "U" },
];

/** Weak to strong armies. */
const MILITARY_STOPS = [0x2c3440, 0x3d5a73, 0x6a6fa8, 0xb0607a, 0xe0703f];
const FORT = 0xf2c94c;

const CONFLICT_COLORS = {
  peace: 0x4f5b69,
  atWar: 0x8a4b45,
  occupied: 0xd9452b,
  militia: 0x9b59d0,
  rebels: 0xe8a33d,
};

/** Who holds what in the world's wars and uprisings. */
function conflictColors(geo: WorldGeography, conflict: ConflictState): Map<number, number> {
  const colors = new Map<number, number>();
  const fighting = new Set<string>();
  for (const w of conflict.wars) {
    if (w.status !== "active") continue;
    for (const id of [...w.attackers, ...w.defenders]) fighting.add(id);
    for (const id of Object.keys(w.occupied)) colors.set(Number(id), CONFLICT_COLORS.occupied);
  }
  for (const p of geo.provinces) {
    if (!colors.has(p.id) && fighting.has(p.countryId)) colors.set(p.id, CONFLICT_COLORS.atWar);
  }
  for (const ins of conflict.insurgencies)
    for (const id of ins.held) colors.set(id, CONFLICT_COLORS.rebels);
  for (const h of conflict.militia?.held ?? []) colors.set(h.provinceId, CONFLICT_COLORS.militia);
  return colors;
}

export const OCEAN = 0x0e1f2d;
const UNINHABITED = 0xd9dee5;
const NO_RESOURCE = 0x4a5361;

export const BIOME_COLORS: Record<Biome, number> = {
  polar: 0xeef2f6,
  tundra: 0xa8b5a2,
  boreal: 0x3f6b4f,
  temperate: 0x5f8f4e,
  grassland: 0x9cb85c,
  mediterranean: 0xb8b065,
  steppe: 0xc9b77a,
  desert: 0xe0c48c,
  savanna: 0xc8a24f,
  tropical: 0x2f7d46,
  mountains: 0x8a7f74,
};

export const RESOURCE_COLORS: Record<Resource, number> = {
  farmland: 0x9ccc65,
  livestock: 0xd4b483,
  timber: 0x2e7d32,
  fish: 0x4fc3f7,
  oil: 0x37323e,
  gas: 0x7e57c2,
  coal: 0x6d6d6d,
  iron: 0xb0583a,
  copper: 0xd2803b,
  gold: 0xf2c94c,
  uranium: 0xa4e34a,
  rareEarths: 0xe056a0,
};

/** Sequential palette for wealth (low → high). */
const WEALTH_STOPS = [0x2b1d4a, 0x5b3a8c, 0xa4507f, 0xe1824f, 0xf5d26a];
/** Diverging palette for stability (unstable → stable). */
const STABILITY_STOPS = [0xc0392b, 0xe67e22, 0xf1c40f, 0x7fb24a, 0x2e8b57];

function lerpColor(a: number, b: number, t: number): number {
  const ch = (c: number, s: number) => (c >> s) & 0xff;
  const mix = (s: number) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * t);
  return (mix(16) << 16) | (mix(8) << 8) | mix(0);
}

export function ramp(stops: number[], t: number): number {
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(Math.floor(x), stops.length - 2);
  return lerpColor(stops[i]!, stops[i + 1]!, x - i);
}

const WEALTH_MIN = Math.log(500);
const WEALTH_MAX = Math.log(80_000);

/** Countries shaded by armed strength, on a log scale between the weakest and strongest. */
function militaryShades(world: WorldState): Map<string, number> {
  const powers = Object.values(world.countries)
    .filter((c) => c.population > 0 && c.military)
    .map((c) => [c.id, Math.log10(1 + armyPower(c))] as const);
  const lo = Math.min(...powers.map(([, p]) => p));
  const hi = Math.max(...powers.map(([, p]) => p));
  return new Map(
    powers.map(([id, p]) => [id, ramp(MILITARY_STOPS, (p - lo) / Math.max(0.001, hi - lo))]),
  );
}

/** The fill color of every province for a map mode, indexed by province id. */
export function provinceColors(
  mode: MapMode,
  geo: WorldGeography,
  world: WorldState,
  conflict?: ConflictState,
): number[] {
  const fronts = mode === "conflict" && conflict ? conflictColors(geo, conflict) : null;
  const strength = mode === "military" ? militaryShades(world) : null;
  const occupied =
    mode === "military" && conflict
      ? new Set(
          conflict.wars
            .filter((w) => w.status === "active")
            .flatMap((w) => Object.keys(w.occupied).map(Number)),
        )
      : null;
  return geo.provinces.map((gp) => {
    const country = world.countries[gp.countryId];
    const province = world.provinces[gp.id];
    if (!country || !province) return UNINHABITED;
    const inhabited = province.population > 0;
    switch (mode) {
      case "political":
        return inhabited ? country.color : UNINHABITED;
      case "terrain":
        return BIOME_COLORS[province.biome];
      case "resources": {
        const r = province.resources[0];
        return r ? RESOURCE_COLORS[r] : NO_RESOURCE;
      }
      case "wealth":
        return inhabited
          ? ramp(
              WEALTH_STOPS,
              (Math.log(province.gdpPerCapita) - WEALTH_MIN) / (WEALTH_MAX - WEALTH_MIN),
            )
          : UNINHABITED;
      case "stability":
        return inhabited ? ramp(STABILITY_STOPS, province.stability / 100) : UNINHABITED;
      case "conflict":
        return inhabited ? (fronts?.get(gp.id) ?? CONFLICT_COLORS.peace) : UNINHABITED;
      case "military":
        if (!inhabited) return UNINHABITED;
        if (occupied?.has(gp.id)) return CONFLICT_COLORS.occupied;
        if (country.statecraft?.forts.includes(gp.id)) return FORT;
        return strength?.get(gp.countryId) ?? MILITARY_STOPS[0]!;
    }
  });
}

export type Legend =
  | { kind: "none"; note: string }
  | { kind: "swatches"; items: { color: number; label: string }[] }
  | { kind: "gradient"; stops: number[]; low: string; high: string };

export function legendFor(mode: MapMode): Legend {
  switch (mode) {
    case "political":
      return { kind: "none", note: "Each color is a country. Click a region for details." };
    case "terrain":
      return {
        kind: "swatches",
        items: (Object.keys(BIOME_COLORS) as Biome[]).map((b) => ({
          color: BIOME_COLORS[b],
          label: BIOME_LABELS[b],
        })),
      };
    case "resources":
      return {
        kind: "swatches",
        items: (Object.keys(RESOURCE_COLORS) as Resource[]).map((r) => ({
          color: RESOURCE_COLORS[r],
          label: RESOURCE_LABELS[r],
        })),
      };
    case "wealth":
      return {
        kind: "gradient",
        stops: WEALTH_STOPS,
        low: `${formatMoney(50_000, true)}/yr`,
        high: `${formatMoney(8_000_000, true)}/yr`,
      };
    case "stability":
      return { kind: "gradient", stops: STABILITY_STOPS, low: "Unstable", high: "Stable" };
    case "military":
      return {
        kind: "gradient",
        stops: MILITARY_STOPS,
        low: "Weak army",
        high: "Strong army (forts in gold, occupied in red)",
      };
    case "conflict":
      return {
        kind: "swatches",
        items: [
          { color: CONFLICT_COLORS.atWar, label: "At war" },
          { color: CONFLICT_COLORS.occupied, label: "Occupied" },
          { color: CONFLICT_COLORS.rebels, label: "Held by rebels" },
          { color: CONFLICT_COLORS.militia, label: "Held by your militia" },
          { color: CONFLICT_COLORS.peace, label: "At peace" },
        ],
      };
  }
}

export function hex(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}
