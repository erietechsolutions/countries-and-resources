import type { GeoPolygon, WorldGeography } from "@cr/sim";

const CELL = 40;

function pointInRing(x: number, y: number, r: number[]): boolean {
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

function inPolygons(x: number, y: number, polygons: GeoPolygon[]): boolean {
  return polygons.some(
    (poly) => pointInRing(x, y, poly[0]!) && !poly.slice(1).some((hole) => pointInRing(x, y, hole)),
  );
}

/** Finds which province is under a map point, using a coarse grid to skip most provinces. */
export class ProvinceHitTester {
  private grid = new Map<number, number[]>();
  private cols: number;

  constructor(private geo: WorldGeography) {
    this.cols = Math.ceil(geo.width / CELL) + 1;
    for (const p of geo.provinces) {
      const [x0, y0, x1, y1] = p.bbox;
      for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) {
        for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy++) {
          const key = cy * this.cols + cx;
          const list = this.grid.get(key) ?? [];
          list.push(p.id);
          this.grid.set(key, list);
        }
      }
    }
  }

  provinceAt(x: number, y: number): number | null {
    const candidates = this.grid.get(Math.floor(y / CELL) * this.cols + Math.floor(x / CELL));
    if (!candidates) return null;
    for (const id of candidates) {
      const p = this.geo.provinces[id]!;
      const [x0, y0, x1, y1] = p.bbox;
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      if (inPolygons(x, y, p.polygons)) return id;
    }
    return null;
  }
}
