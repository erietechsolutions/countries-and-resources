/**
 * Builds data/geography/real-world.json from Natural Earth (public domain) data.
 *
 *   npm run geodata
 *
 * Steps: download → simplify into a shared-border topology (mapshaper) → compute neighbors,
 * coastlines and border meshes → project to flat map coordinates → assign cities to provinces.
 * Raw downloads are cached in tools/geodata/.cache (gitignored); the output is committed.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { geoArea, geoNaturalEarth1, geoPath } from "d3-geo";
import type { Feature, FeatureCollection, MultiLineString, Point } from "geojson";
import { feature, mesh, neighbors } from "topojson-client";
import type { GeometryCollection, GeometryObject, Topology } from "topojson-specification";
import type {
  FlatRing,
  GeoCity,
  GeoCountry,
  GeoPolygon,
  GeoProvince,
  WorldGeography,
} from "../../packages/sim/src/world/geography";
import { REAL_WORLD_GEOGRAPHY_ID } from "../../packages/sim/src/world/geography";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const cacheDir = path.join(here, ".cache");
const outFile = path.join(root, "data/geography/real-world.json");

const NE_BASE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson";
// The "_lakes" variant cuts large lakes (e.g. the Great Lakes) out of province shapes.
const ADMIN1 = "ne_10m_admin_1_states_provinces_lakes.geojson";
const PLACES = "ne_10m_populated_places_simple.geojson";

/** Width of the projected map in map units. */
const MAP_WIDTH = 4000;
/** Percentage of vertices kept when simplifying province outlines. */
const SIMPLIFY = "4%";
/** Territories where nobody can start or live. */
const UNINHABITABLE = new Set([
  "ATA",
  "ATF",
  "HMD",
  "SGS",
  "BVT",
  "IOT",
  "CLP",
  "IOA",
  "ATC", // remote or polar
  "USG",
  "KAS",
  "ESB",
  "WSB",
  "CSI",
  "PGA",
  "UMI",
  "BJN",
  "SER",
  "SCR", // bases and outposts
]);
const EXCLUDED_PLACE_CLASSES = new Set([
  "Scientific station",
  "Meteorological Station",
  "Historic place",
]);

interface AdminProps {
  name: string | null;
  adm0_a3: string;
  admin: string;
  latitude: number | null;
  longitude: number | null;
}

interface PlaceProps {
  name: string;
  featurecla: string;
  adm0_a3: string;
  latitude: number;
  longitude: number;
  pop_max: number;
}

const round = (v: number) => Math.round(v * 10) / 10;
const cleanName = (s: string) => s.replace(/\s+/g, " ").trim();

async function download(file: string): Promise<string> {
  const target = path.join(cacheDir, file);
  if (fs.existsSync(target)) return target;
  fs.mkdirSync(cacheDir, { recursive: true });
  console.log(`Downloading ${file}...`);
  const res = await fetch(`${NE_BASE}/${file}`);
  if (!res.ok) throw new Error(`Download failed for ${file}: ${res.status}`);
  fs.writeFileSync(target, Buffer.from(await res.arrayBuffer()));
  return target;
}

function simplifyToTopology(input: string): Topology {
  const out = path.join(cacheDir, "admin1-simplified.topojson");
  const bin = path.join(root, "node_modules/.bin/mapshaper");
  console.log(`Simplifying provinces (${SIMPLIFY})...`);
  execFileSync(
    bin,
    [
      "-i",
      input,
      "-filter-fields",
      "name,adm0_a3,admin,latitude,longitude",
      "-simplify",
      SIMPLIFY,
      "keep-shapes",
      "-o",
      out,
      "format=topojson",
      "quantization=200000",
      "force",
    ],
    { stdio: "inherit" },
  );
  return JSON.parse(fs.readFileSync(out, "utf8")) as Topology;
}

/** A d3-geo path context that records projected rings/lines as flat coordinate arrays. */
class FlatRecorder {
  rings: FlatRing[] = [];
  private current: FlatRing | null = null;

  moveTo(x: number, y: number) {
    this.current = [round(x), round(y)];
    this.rings.push(this.current);
  }
  lineTo(x: number, y: number) {
    const c = this.current;
    if (!c) return;
    const rx = round(x);
    const ry = round(y);
    if (c[c.length - 2] !== rx || c[c.length - 1] !== ry) c.push(rx, ry);
  }
  closePath() {
    this.current = null;
  }
  arc() {}
  take(minPoints: number): FlatRing[] {
    const result = this.rings.filter((r) => r.length >= minPoints * 2);
    this.rings = [];
    this.current = null;
    return result;
  }
}

function ringArea(r: FlatRing): number {
  let a = 0;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    a += (r[j]! + r[i]!) * (r[j + 1]! - r[i + 1]!);
  }
  return a / 2;
}

function pointInRing(x: number, y: number, r: FlatRing): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const xi = r[i]!,
      yi = r[i + 1]!,
      xj = r[j]!,
      yj = r[j + 1]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Groups loose rings into polygons with holes, using containment depth (even = outer). */
function groupRings(rings: FlatRing[]): GeoPolygon[] {
  const sorted = [...rings].sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)));
  const polygons: { outer: FlatRing; rings: GeoPolygon }[] = [];
  const placed: { ring: FlatRing; depth: number; owner: GeoPolygon }[] = [];
  for (const ring of sorted) {
    let container: (typeof placed)[number] | undefined;
    for (let i = placed.length - 1; i >= 0; i--) {
      const p = placed[i]!;
      if (pointInRing(ring[0]!, ring[1]!, p.ring)) {
        container = p;
        break;
      }
    }
    const depth = container ? container.depth + 1 : 0;
    if (depth % 2 === 1 && container) {
      container.owner.push(ring);
      placed.push({ ring, depth, owner: container.owner });
    } else {
      const poly: GeoPolygon = [ring];
      polygons.push({ outer: ring, rings: poly });
      placed.push({ ring, depth, owner: poly });
    }
  }
  return polygons.map((p) => p.rings);
}

function inPolygons(x: number, y: number, polygons: GeoPolygon[]): boolean {
  for (const poly of polygons) {
    if (!pointInRing(x, y, poly[0]!)) continue;
    if (poly.slice(1).some((hole) => pointInRing(x, y, hole))) continue;
    return true;
  }
  return false;
}

function bboxOf(polygons: GeoPolygon[]): [number, number, number, number] {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const poly of polygons) {
    const r = poly[0]!;
    for (let i = 0; i < r.length; i += 2) {
      x0 = Math.min(x0, r[i]!);
      x1 = Math.max(x1, r[i]!);
      y0 = Math.min(y0, r[i + 1]!);
      y1 = Math.max(y1, r[i + 1]!);
    }
  }
  return [x0, y0, x1, y1];
}

function arcIndices(geom: GeometryObject): number[] {
  const out: number[] = [];
  const walk = (a: unknown) => {
    if (typeof a === "number") out.push(a < 0 ? ~a : a);
    else if (Array.isArray(a)) a.forEach(walk);
  };
  if ("arcs" in geom) walk(geom.arcs);
  return out;
}

async function main() {
  const admin1Path = await download(ADMIN1);
  const placesPath = await download(PLACES);
  const topology = simplifyToTopology(admin1Path);
  const object = Object.values(topology.objects)[0] as GeometryCollection<AdminProps>;
  const geoms = object.geometries;

  const projection = geoNaturalEarth1().precision(0.5);
  projection.fitWidth(MAP_WIDTH, { type: "Sphere" });
  const recorder = new FlatRecorder();
  const path2d = geoPath(projection, recorder as unknown as Parameters<typeof geoPath>[1]);
  const sphereBounds = geoPath(projection).bounds({ type: "Sphere" });
  const height = Math.ceil(sphereBounds[1][1]);

  // Arcs used by exactly one province are outer edges (coastlines).
  const arcUse = new Map<number, number>();
  for (const g of geoms) for (const a of arcIndices(g)) arcUse.set(a, (arcUse.get(a) ?? 0) + 1);

  const adjacency = neighbors(geoms as GeometryObject[]);

  console.log("Projecting provinces...");
  const provinces: GeoProvince[] = [];
  const countries = new Map<string, GeoCountry>();
  const unnamedCounter = new Map<string, number>();
  geoms.forEach((g, id) => {
    const props = g.properties as AdminProps;
    const f = feature(topology, g) as Feature;
    path2d(f);
    let polygons = groupRings(recorder.take(3));
    let area = geoArea(f);
    if (area > 2 * Math.PI) area = 4 * Math.PI - area;
    const lat = props.latitude ?? 0;
    const lon = props.longitude ?? 0;
    if (polygons.length === 0) {
      // Microstates (e.g. Vatican City) vanish at map resolution; give them a small marker.
      const [cx, cy] = projection([lon, lat]) ?? [0, 0];
      const s = 0.6;
      polygons = [[[cx - s, cy - s, cx + s, cy - s, cx + s, cy + s, cx - s, cy + s].map(round)]];
    }
    const countryId = props.adm0_a3;
    let name = props.name && cleanName(props.name);
    if (!name) {
      const n = (unnamedCounter.get(countryId) ?? 0) + 1;
      unnamedCounter.set(countryId, n);
      name = `${props.admin} Region ${n}`;
    }
    const bbox = bboxOf(polygons);
    let label = projection([lon, lat]) as [number, number] | null;
    if (!label || !inPolygons(label[0], label[1], polygons)) {
      label = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
    }
    provinces.push({
      id,
      name,
      countryId,
      lat: round(lat),
      lon: round(lon),
      areaKm2: Math.round(area * 6371 * 6371),
      coastal: arcIndices(g).some((a) => arcUse.get(a) === 1),
      neighbors: adjacency[id] ?? [],
      label: [round(label[0]), round(label[1])],
      bbox,
      polygons,
    });
    let country = countries.get(countryId);
    if (!country) {
      country = {
        id: countryId,
        name: cleanName(props.admin),
        provinceIds: [],
        capitalCityId: null,
        habitable: !UNINHABITABLE.has(countryId),
      };
      countries.set(countryId, country);
    }
    country.provinceIds.push(id);
  });

  console.log("Building border meshes...");
  const countryOf = (g: GeometryObject) => (g.properties as AdminProps).adm0_a3;
  const lines = (filter: (a: GeometryObject, b: GeometryObject) => boolean) => {
    const m = mesh(topology, object as GeometryCollection, filter) as MultiLineString;
    path2d(m);
    return recorder.take(2);
  };
  const borders = {
    country: lines((a, b) => a !== b && countryOf(a) !== countryOf(b)),
    province: lines((a, b) => a !== b && countryOf(a) === countryOf(b)),
    coast: lines((a, b) => a === b),
  };

  console.log("Assigning cities to provinces...");
  const places = JSON.parse(fs.readFileSync(placesPath, "utf8")) as FeatureCollection<
    Point,
    PlaceProps
  >;
  const byCountry = new Map<string, GeoProvince[]>();
  for (const p of provinces) {
    const list = byCountry.get(p.countryId) ?? [];
    list.push(p);
    byCountry.set(p.countryId, list);
  }
  const nearest = (x: number, y: number, list: GeoProvince[]) => {
    let best: GeoProvince | undefined;
    let bestD = Infinity;
    for (const p of list) {
      const d = (p.label[0] - x) ** 2 + (p.label[1] - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best!;
  };

  const cityKeys = new Map<string, GeoCity & { pop: number; nationalCapital: boolean }>();
  for (const place of places.features) {
    const pr = place.properties;
    if (EXCLUDED_PLACE_CLASSES.has(pr.featurecla)) continue;
    const pt = projection([pr.longitude, pr.latitude]);
    if (!pt) continue;
    const [x, y] = pt;
    let province = provinces.find(
      (p) =>
        x >= p.bbox[0] &&
        x <= p.bbox[2] &&
        y >= p.bbox[1] &&
        y <= p.bbox[3] &&
        inPolygons(x, y, p.polygons),
    );
    province ??= nearest(x, y, byCountry.get(pr.adm0_a3) ?? provinces);
    if (!countries.get(province.countryId)!.habitable) continue;
    const cityName = cleanName(pr.name);
    const key = `${province.id}|${cityName}`;
    const existing = cityKeys.get(key);
    if (existing && existing.pop >= pr.pop_max) continue;
    const nationalCapital = pr.featurecla === "Admin-0 capital";
    cityKeys.set(key, {
      id: 0,
      name: cityName,
      provinceId: province.id,
      countryId: province.countryId,
      x: round(x),
      y: round(y),
      capital: nationalCapital ? 2 : pr.featurecla.includes("capital") ? 1 : 0,
      importance: Math.round(Math.log10(Math.max(pr.pop_max, 500)) * 100) / 100,
      pop: pr.pop_max,
      nationalCapital,
    });
  }

  // Synthesize a settlement for habitable territories that have none.
  for (const country of countries.values()) {
    if (!country.habitable) continue;
    if ([...cityKeys.values()].some((c) => c.countryId === country.id)) continue;
    const largest = country.provinceIds
      .map((id) => provinces[id]!)
      .sort((a, b) => b.areaKm2 - a.areaKm2)[0]!;
    cityKeys.set(`${largest.id}|${largest.name}`, {
      id: 0,
      name: largest.name,
      provinceId: largest.id,
      countryId: country.id,
      x: largest.label[0],
      y: largest.label[1],
      capital: 2,
      importance: 3.5,
      pop: 0,
      nationalCapital: true,
    });
  }

  const sortedCities = [...cityKeys.values()].sort((a, b) => b.importance - a.importance);
  const cities: GeoCity[] = sortedCities.map(({ pop: _pop, nationalCapital: _nc, ...c }, id) => ({
    ...c,
    id,
  }));

  // One national capital per country: the largest city flagged as capital, else the largest city.
  for (const country of countries.values()) {
    const own = cities.filter((c) => c.countryId === country.id);
    if (own.length === 0) continue;
    const capital = own.find((c) => c.capital === 2) ?? own[0]!;
    for (const c of own) if (c.capital === 2 && c !== capital) c.capital = 1;
    capital.capital = 2;
    country.capitalCityId = capital.id;
  }

  const geography: WorldGeography = {
    id: REAL_WORLD_GEOGRAPHY_ID,
    name: "Earth",
    width: MAP_WIDTH,
    height,
    countries: [...countries.values()].sort((a, b) => a.name.localeCompare(b.name)),
    provinces,
    cities,
    borders,
  };

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const json = JSON.stringify(geography);
  fs.writeFileSync(outFile, json);
  const vertices = provinces.reduce(
    (n, p) => n + p.polygons.reduce((m, poly) => m + poly.reduce((k, r) => k + r.length / 2, 0), 0),
    0,
  );
  console.log(
    `Wrote ${path.relative(root, outFile)}: ${(json.length / 1e6).toFixed(1)} MB, ` +
      `${countries.size} countries, ${provinces.length} provinces, ${cities.length} cities, ` +
      `${vertices} vertices`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
