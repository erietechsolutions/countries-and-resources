import { Delaunay } from "d3-delaunay";
import { Rng } from "../core/rng";
import type {
  FlatRing,
  GeoCity,
  GeoCountry,
  GeoProvince,
  GeoWaterLabel,
  WorldGeography,
} from "../world/geography";
import { CULTURES, NameGenerator, type Culture } from "./cultureNames";
import { Noise2D } from "./noise";

/**
 * Generates a whole new planet: continents and islands from layered noise over ~9,000 Voronoi
 * cells, countries grown outward from capitals across connected land, named regions and cities,
 * borders, coastlines and seas. The output is the same WorldGeography format as the real-world
 * map, and the same seed always produces the same planet, so maps are never stored in saves.
 */

export const RANDOM_GEOGRAPHY_PREFIX = "random-";
const W = 4000;
const H = 2080;
/** Map units are 10 km across, so one square unit is 100 km². */
const KM_PER_UNIT = 10;

export function randomGeographyId(seed: number): string {
  return `${RANDOM_GEOGRAPHY_PREFIX}${seed >>> 0}`;
}

export function isRandomGeographyId(id: string): boolean {
  return id.startsWith(RANDOM_GEOGRAPHY_PREFIX);
}

export function seedOfRandomGeography(id: string): number {
  return Number(id.slice(RANDOM_GEOGRAPHY_PREFIX.length)) >>> 0;
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (t: number) => t * t * (3 - 2 * t);

/** Minimal binary heap for Dijkstra. */
class MinHeap {
  private items: { key: number; value: number }[] = [];
  get size() {
    return this.items.length;
  }
  push(value: number, key: number) {
    const a = this.items;
    a.push({ key, value });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p]!.key <= a[i]!.key) break;
      [a[p], a[i]] = [a[i]!, a[p]!];
      i = p;
    }
  }
  pop(): { key: number; value: number } {
    const a = this.items;
    const top = a[0]!;
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l]!.key < a[m]!.key) m = l;
        if (r < a.length && a[r]!.key < a[m]!.key) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i]!, a[m]!];
        i = m;
      }
    }
    return top;
  }
}

function polygonOf(vor: ReturnType<Delaunay<number[]>["voronoi"]>, i: number): number[][] {
  const poly = vor.cellPolygon(i) as unknown as number[][] | null;
  if (!poly) return [];
  return poly.slice(0, -1);
}

function areaAndCentroid(poly: number[][]): { area: number; cx: number; cy: number } {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    const f = xj! * yi! - xi! * yj!;
    a += f;
    cx += (xj! + xi!) * f;
    cy += (yj! + yi!) * f;
  }
  a /= 2;
  if (Math.abs(a) < 1e-9) return { area: 0, cx: poly[0]![0]!, cy: poly[0]![1]! };
  return { area: Math.abs(a), cx: cx / (6 * a), cy: cy / (6 * a) };
}

export function generateRandomGeography(seed: number, cellTarget = 9000): WorldGeography {
  const rng = Rng.fromKey(seed, "map");

  // ---- Cells: jittered grid, relaxed once so cells are evenly sized.
  const cols = Math.round(Math.sqrt((cellTarget * W) / H));
  const rows = Math.round(cellTarget / cols);
  const dx = W / cols;
  const dy = H / rows;
  let points: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      points.push((c + 0.5 + rng.float(-0.45, 0.45)) * dx, (r + 0.5 + rng.float(-0.45, 0.45)) * dy);
    }
  }
  let delaunay = new Delaunay(points);
  let vor = delaunay.voronoi([0, 0, W, H]);
  const relaxed: number[] = [];
  const n = points.length / 2;
  for (let i = 0; i < n; i++) {
    const poly = polygonOf(vor, i);
    const { cx, cy } = poly.length
      ? areaAndCentroid(poly)
      : { cx: points[i * 2]!, cy: points[i * 2 + 1]! };
    relaxed.push(cx, cy);
  }
  points = relaxed;
  delaunay = new Delaunay(points);
  vor = delaunay.voronoi([0, 0, W, H]);
  const px = (i: number) => points[i * 2]!;
  const py = (i: number) => points[i * 2 + 1]!;
  const neighborsOf: number[][] = Array.from({ length: n }, (_, i) => [...delaunay.neighbors(i)]);

  // ---- Elevation: continent masks plus warped fractal noise, fading out at the map edges.
  const noise = new Noise2D(Rng.fromKey(seed, "noise"));
  const warp = new Noise2D(Rng.fromKey(seed, "warp"));
  const continents = Array.from({ length: rng.int(4, 7) }, () => ({
    x: rng.float(0.12, 0.88) * W,
    y: rng.float(0.2, 0.8) * H,
    r: rng.float(0.11, 0.24) * W,
  }));
  const elevation = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const x = px(i);
    const y = py(i);
    const wx = x + warp.fbm(x / 900, y / 900, 3) * 260;
    const wy = y + warp.fbm(x / 900 + 31, y / 900 + 17, 3) * 260;
    let mask = 0;
    for (const c of continents) mask = Math.max(mask, 1 - Math.hypot(wx - c.x, wy - c.y) / c.r);
    const detail = noise.fbm(wx / 650, wy / 650, 5);
    const edge =
      smooth(clamp01(Math.min(x, W - x) / (W * 0.07))) *
      smooth(clamp01(Math.min(y, H - y) / (H * 0.11)));
    elevation[i] = (0.6 * Math.max(0, mask) + 0.45 * detail + 0.05) * edge - (1 - edge) * 0.6;
  }
  const sorted = [...elevation].sort((a, b) => a - b);
  const landFraction = rng.float(0.29, 0.36);
  const seaLevel = sorted[Math.floor((1 - landFraction) * n)]!;
  const maxElevation = sorted[n - 1]!;
  const land = Array.from(elevation, (e) => e > seaLevel);
  // Fill single-cell lakes so coastlines look clean.
  for (let i = 0; i < n; i++) {
    if (!land[i] && neighborsOf[i]!.length > 0 && neighborsOf[i]!.every((j) => land[j]))
      land[i] = true;
  }
  const height01 = (i: number) => clamp01((elevation[i]! - seaLevel) / (maxElevation - seaLevel));

  // ---- Landmasses.
  const component = new Int32Array(n).fill(-1);
  const components: number[][] = [];
  for (let i = 0; i < n; i++) {
    if (!land[i] || component[i] !== -1) continue;
    const id = components.length;
    const cells: number[] = [];
    const stack = [i];
    component[i] = id;
    while (stack.length) {
      const c = stack.pop()!;
      cells.push(c);
      for (const nb of neighborsOf[c]!) {
        if (land[nb] && component[nb] === -1) {
          component[nb] = id;
          stack.push(nb);
        }
      }
    }
    components.push(cells);
  }
  const landCount = components.reduce((s, c) => s + c.length, 0);

  // ---- Countries: capitals spread out across each landmass, then grown by terrain-aware distance.
  const targetCountries = Math.max(40, Math.min(140, Math.round(landCount / 30)));
  const avgSize = landCount / targetCountries;
  const owner = new Int32Array(n).fill(-1);
  const capitals: number[] = [];
  const heap = new MinHeap();
  const cost = new Float64Array(n).fill(Infinity);
  const smallComponents: number[][] = [];
  for (const cells of components) {
    if (cells.length < 8) {
      smallComponents.push(cells);
      continue;
    }
    const k = Math.max(1, Math.round((cells.length / avgSize) * rng.float(0.75, 1.25)));
    const chosen: number[] = [rng.pick(cells)];
    while (chosen.length < k) {
      let best = cells[0]!;
      let bestD = -1;
      for (const c of cells) {
        let d = Infinity;
        for (const s of chosen) d = Math.min(d, (px(c) - px(s)) ** 2 + (py(c) - py(s)) ** 2);
        d *= rng.float(0.7, 1); // a little randomness so capitals aren't perfectly spaced
        if (d > bestD) {
          bestD = d;
          best = c;
        }
      }
      chosen.push(best);
    }
    for (const s of chosen) {
      const id = capitals.length;
      capitals.push(s);
      owner[s] = id;
      cost[s] = 0;
      heap.push(s, 0);
    }
  }
  const roughness = new Noise2D(Rng.fromKey(seed, "borders"));
  while (heap.size) {
    const { value: c, key } = heap.pop();
    if (key > cost[c]!) continue;
    for (const nb of neighborsOf[c]!) {
      if (!land[nb]) continue;
      const step =
        (Math.hypot(px(nb) - px(c), py(nb) - py(c)) / dx) *
        (1 + Math.max(0, height01(nb) - 0.55) * 5) *
        (0.75 + (0.5 * (roughness.noise(px(nb) / 300, py(nb) / 300) + 1)) / 2);
      if (key + step < cost[nb]!) {
        cost[nb] = key + step;
        owner[nb] = owner[c]!;
        heap.push(nb, key + step);
      }
    }
  }
  // Small islands: some become island nations, the rest belong to the nearest country.
  for (const cells of smallComponents) {
    if (cells.length >= 3 && rng.chance(0.45)) {
      const id = capitals.length;
      capitals.push(cells[0]!);
      for (const c of cells) owner[c] = id;
      continue;
    }
    const [cx, cy] = [px(cells[0]!), py(cells[0]!)];
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < n; i++) {
      if (owner[i]! < 0 || component[i] === component[cells[0]!]) continue;
      const d = (px(i) - cx) ** 2 + (py(i) - cy) ** 2;
      if (d < bestD) {
        bestD = d;
        best = owner[i]!;
      }
    }
    if (best < 0) {
      best = capitals.length;
      capitals.push(cells[0]!);
    }
    for (const c of cells) owner[c] = best;
  }

  // ---- Cultures: a handful of naming cultures, each covering a region of the world.
  const cultures = rng.shuffle([...CULTURES]).slice(0, rng.int(5, Math.min(8, CULTURES.length)));
  const cultureCenters = cultures.map(() => capitals[rng.int(0, capitals.length - 1)]!);
  const cultureOf: Culture[] = capitals.map((cap) => {
    let best = 0;
    let bestD = Infinity;
    cultureCenters.forEach((c, i) => {
      const d = (px(cap) - px(c)) ** 2 + (py(cap) - py(c)) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return cultures[best]!;
  });
  const names = new NameGenerator(Rng.fromKey(seed, "names"));

  // ---- Countries and provinces (each land cell is one province).
  const usedCodes = new Set<string>();
  const countries: GeoCountry[] = capitals.map((_, i) => {
    const name = names.country(cultureOf[i]!);
    const letters = name
      .normalize("NFD")
      .replace(/[^A-Za-z]/g, "")
      .toUpperCase();
    let code = (letters + "XXX").slice(0, 3);
    for (let k = 2; usedCodes.has(code); k++) code = `${letters.slice(0, 2)}${k}`.slice(0, 3);
    usedCodes.add(code);
    return { id: code, name, provinceIds: [], capitalCityId: null, habitable: true };
  });
  const provinceOfCell = new Int32Array(n).fill(-1);
  const provinces: GeoProvince[] = [];
  for (let i = 0; i < n; i++) {
    if (!land[i] || owner[i]! < 0) continue;
    const poly = polygonOf(vor, i);
    if (poly.length < 3) continue;
    const { area, cx, cy } = areaAndCentroid(poly);
    const country = countries[owner[i]!]!;
    const id = provinces.length;
    provinceOfCell[i] = id;
    const flat = poly.flatMap(([x, y]) => [r1(x!), r1(y!)]);
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const [x, y] of poly) {
      x0 = Math.min(x0, x!);
      y0 = Math.min(y0, y!);
      x1 = Math.max(x1, x!);
      y1 = Math.max(y1, y!);
    }
    provinces.push({
      id,
      name: names.region(cultureOf[owner[i]!]!),
      countryId: country.id,
      lat: r1(90 - (cy / H) * 180),
      lon: r1((cx / W) * 360 - 180),
      areaKm2: Math.round(area * KM_PER_UNIT * KM_PER_UNIT),
      coastal:
        neighborsOf[i]!.some((j) => !land[j]) ||
        poly.some(([x, y]) => x! <= 0.5 || y! <= 0.5 || x! >= W - 0.5 || y! >= H - 0.5),
      neighbors: [],
      label: [r1(cx), r1(cy)],
      bbox: [r1(x0), r1(y0), r1(x1), r1(y1)],
      polygons: [[flat]],
      elevation: Math.round(height01(i) * 100) / 100,
    });
    country.provinceIds.push(id);
  }
  for (let i = 0; i < n; i++) {
    const p = provinceOfCell[i]!;
    if (p < 0) continue;
    provinces[p]!.neighbors = neighborsOf[i]!.map((j) => provinceOfCell[j]!).filter((j) => j >= 0);
  }

  // ---- Cities: more and bigger in temperate lowlands and on coasts; one capital per country.
  const cityRng = Rng.fromKey(seed, "cities");
  type Draft = Omit<GeoCity, "id">;
  const drafts: Draft[] = [];
  const capitalDraft = new Map<number, Draft>();
  for (let i = 0; i < n; i++) {
    const pid = provinceOfCell[i]!;
    if (pid < 0) continue;
    const prov = provinces[pid]!;
    const lat = Math.abs(prov.lat);
    const climate = lat < 12 ? 0.75 : lat < 55 ? 1 : lat < 65 ? 0.55 : 0.15;
    const habit = clamp01((1 - (prov.elevation ?? 0) * 0.9) * climate * (prov.coastal ? 1.25 : 1));
    const countryIndex = owner[i]!;
    const isCapitalCell = capitals[countryIndex] === i;
    const culture = cultureOf[countryIndex]!;
    let count = cityRng.chance(0.2 + 0.55 * habit) ? (cityRng.chance(0.2 * habit) ? 2 : 1) : 0;
    if (isCapitalCell) count = Math.max(count, 1);
    for (let k = 0; k < count; k++) {
      // Second cities sit partway toward a corner of the cell.
      const poly = prov.polygons[0]![0]!;
      const v = cityRng.int(0, poly.length / 2 - 1);
      const t = k === 0 ? 0 : 0.45;
      const draft: Draft = {
        name: names.city(culture),
        provinceId: pid,
        countryId: prov.countryId,
        x: r1(prov.label[0] + (poly[v * 2]! - prov.label[0]) * t),
        y: r1(prov.label[1] + (poly[v * 2 + 1]! - prov.label[1]) * t),
        capital: 0,
        importance:
          Math.round(
            Math.min(6.4, 3.7 + habit * 1.1 + Math.exp(cityRng.normal(0, 0.45)) * 0.7) * 100,
          ) / 100,
      };
      if (isCapitalCell && k === 0) {
        draft.capital = 2;
        draft.importance = Math.round(cityRng.float(5.9, 6.9) * 100) / 100;
        capitalDraft.set(countryIndex, draft);
      }
      drafts.push(draft);
    }
  }
  // The biggest city in every country also gets regional-capital status for a few provinces.
  drafts.sort((a, b) => b.importance - a.importance);
  const cities: GeoCity[] = drafts.map((d, id) => ({ ...d, id }));
  const idOfDraft = new Map(drafts.map((d, id) => [d, id]));
  countries.forEach((c, i) => {
    const d = capitalDraft.get(i);
    c.capitalCityId = d ? idOfDraft.get(d)! : null;
  });

  // ---- Borders: every Voronoi edge is a coastline, a country border or a province border.
  const edgeCells = new Map<string, number[]>();
  const edgeCoords = new Map<string, FlatRing>();
  for (let i = 0; i < n; i++) {
    const poly = polygonOf(vor, i);
    for (let k = 0; k < poly.length; k++) {
      const a = poly[k]!;
      const b = poly[(k + 1) % poly.length]!;
      const ka = `${r1(a[0]!)},${r1(a[1]!)}`;
      const kb = `${r1(b[0]!)},${r1(b[1]!)}`;
      if (ka === kb) continue;
      const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      const list = edgeCells.get(key) ?? [];
      list.push(i);
      edgeCells.set(key, list);
      if (!edgeCoords.has(key)) edgeCoords.set(key, [r1(a[0]!), r1(a[1]!), r1(b[0]!), r1(b[1]!)]);
    }
  }
  const borders = {
    country: [] as FlatRing[],
    province: [] as FlatRing[],
    coast: [] as FlatRing[],
  };
  for (const [key, cellsOnEdge] of edgeCells) {
    const [a, b] = cellsOnEdge;
    const landA = a !== undefined && provinceOfCell[a]! >= 0;
    const landB = b !== undefined && provinceOfCell[b]! >= 0;
    const coords = edgeCoords.get(key)!;
    if (landA && landB) {
      (owner[a!] === owner[b!] ? borders.province : borders.country).push(coords);
    } else if (landA !== landB) {
      borders.coast.push(coords);
    }
  }

  // ---- Seas: label open water far from land as oceans, and smaller waters near coasts as seas.
  const distance = new Int32Array(n).fill(-1);
  const queue: number[] = [];
  for (let i = 0; i < n; i++) {
    if (land[i]) {
      distance[i] = 0;
      queue.push(i);
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const c = queue[q]!;
    for (const nb of neighborsOf[c]!) {
      if (distance[nb] === -1) {
        distance[nb] = distance[c]! + 1;
        queue.push(nb);
      }
    }
  }
  const nearestCulture = (i: number): Culture => {
    let best = cultures[0]!;
    let bestD = Infinity;
    capitals.forEach((cap, ci) => {
      const d = (px(cap) - px(i)) ** 2 + (py(cap) - py(i)) ** 2;
      if (d < bestD) {
        bestD = d;
        best = cultureOf[ci]!;
      }
    });
    return best;
  };
  const seaCells = Array.from({ length: n }, (_, i) => i)
    .filter(
      (i) =>
        !land[i] && px(i) > W * 0.06 && px(i) < W * 0.94 && py(i) > H * 0.08 && py(i) < H * 0.92,
    )
    .sort((a, b) => distance[b]! - distance[a]!);
  const waterLabels: GeoWaterLabel[] = [];
  const placed: [number, number, number][] = [];
  const free = (x: number, y: number, gap: number) =>
    placed.every(([ox, oy, og]) => Math.hypot(ox - x, oy - y) > Math.max(gap, og));
  for (const i of seaCells) {
    const d = distance[i]!;
    if (waterLabels.filter((w) => w.kind === "ocean").length >= 4 || d < 7) break;
    if (!free(px(i), py(i), 700)) continue;
    const name = names.sea(nearestCulture(i), "ocean");
    waterLabels.push({
      name: name.length > 14 ? name.replace(/ Ocean$/, "\nOcean") : name,
      kind: "ocean",
      x: r1(px(i)),
      y: r1(py(i)),
      size: 40,
      rotation: 0,
    });
    placed.push([px(i), py(i), 700]);
  }
  for (const i of seaCells) {
    const d = distance[i]!;
    if (waterLabels.length >= 16) break;
    if (d < 2 || d > 6 || !free(px(i), py(i), 320)) continue;
    const kind = d <= 3 ? "bay" : "sea";
    waterLabels.push({
      name: names.sea(nearestCulture(i), kind),
      kind,
      x: r1(px(i)),
      y: r1(py(i)),
      size: Math.round(Math.min(kind === "bay" ? 12 : 22, d * dx * 0.3) * 10) / 10,
      rotation: 0,
    });
    placed.push([px(i), py(i), 320]);
  }

  return {
    id: randomGeographyId(seed),
    name: "Generated world",
    width: W,
    height: H,
    countries: countries
      .filter((c) => c.provinceIds.length > 0)
      .sort((a, b) => a.name.localeCompare(b.name)),
    provinces,
    cities,
    borders,
    lakes: [],
    waterLabels,
  };
}
