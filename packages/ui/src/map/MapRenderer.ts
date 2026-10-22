import { Application, Container, Graphics, Text } from "pixi.js";
import type {
  CityId,
  CountryId,
  FlatRing,
  GeoCity,
  ProvinceId,
  WaterKind,
  WorldGeography,
} from "@cr/sim";
import { ProvinceHitTester } from "./hitTest";
import { OCEAN } from "./mapModes";

export interface MapCallbacks {
  onProvinceClick(id: ProvinceId | null): void;
  onCityClick(id: CityId): void;
}

export interface MapSelection {
  provinceId: ProvinceId | null;
  countryId: CountryId | null;
  cityId: CityId | null;
}

interface CountryLabel {
  text: Text;
  /** Font size in map units. */
  size: number;
}

interface WaterLabel {
  text: Text;
  /** Largest font size in map units at which the name fits inside the water. */
  size: number;
  /** Largest on-screen font size in pixels, so names stay readable but quiet when zoomed in. */
  maxPx: number;
}

const WATER_FONT = 24;
const WATER_MAX_PX: Record<WaterKind, number> = {
  ocean: 26,
  sea: 17,
  bay: 14,
  strait: 12,
  lake: 13,
};
const WATER_MIN_PX = 8.5;

const DRAG_THRESHOLD = 5;
const MAX_ZOOM = 90;
const MAX_CITY_LABELS = 140;

/**
 * Renders the world map with PixiJS: province fills (recolored by tint for each map mode),
 * borders, country and city labels, selection highlights, and pan/zoom/click handling.
 * Framework-agnostic; MapView wraps it for React.
 */
export class MapRenderer {
  private app = new Application();
  private ready = false;
  private destroyed = false;
  private host: HTMLElement | null = null;

  private world = new Container();
  private provinces = new Container();
  private provinceGfx: Graphics[] = [];
  private coast = new Graphics();
  private lakes = new Graphics();
  private lakeShores = new Graphics();
  private waterLabelLayer = new Container();
  private waterLabels: WaterLabel[] = [];
  private lastLabelScale = 0;
  private provinceBorders = new Graphics();
  private countryBorders = new Graphics();
  private selectionGfx = new Graphics();
  private hoverGfx = new Graphics();
  private countryLabelLayer = new Container();
  private countryLabels: CountryLabel[] = [];

  private overlay = new Container();
  private cityDots = new Graphics();
  private cityLabelLayer = new Container();
  private cityLabelPool: Text[] = [];
  private visibleCities: { city: GeoCity; sx: number; sy: number }[] = [];

  private hit: ProvinceHitTester;
  private fitScale = 1;
  private selection: MapSelection = { provinceId: null, countryId: null, cityId: null };
  private hoverId: ProvinceId | null = null;
  /** Regions that changed hands during play; outlined as borders. */
  private changedProvinces: ProvinceId[] = [];
  private playerCityId: CityId | null = null;
  private showCityLabels = true;
  private showTowns = true;
  private zoomRedrawTimer = 0;
  private drag: { x: number; y: number; px: number; py: number; moved: boolean } | null = null;
  private cleanup: (() => void)[] = [];

  constructor(
    private geo: WorldGeography,
    private callbacks: MapCallbacks,
  ) {
    this.hit = new ProvinceHitTester(geo);
  }

  async init(host: HTMLElement): Promise<void> {
    this.host = host;
    await this.app.init({
      resizeTo: host,
      background: OCEAN,
      antialias: true,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
    });
    if (this.destroyed) {
      this.app.destroy(true, { children: true });
      return;
    }
    host.appendChild(this.app.canvas);
    this.buildScene();
    this.attachInput(this.app.canvas);
    this.app.renderer.on("resize", () => this.onViewChanged());
    this.ready = true;
    this.fitToView();
  }

  destroy(): void {
    this.destroyed = true;
    window.clearTimeout(this.zoomRedrawTimer);
    this.cleanup.forEach((fn) => fn());
    if (this.ready) this.app.destroy(true, { children: true });
  }

  setCallbacks(callbacks: MapCallbacks): void {
    this.callbacks = callbacks;
  }

  setColors(colors: number[]): void {
    this.provinceGfx.forEach((g, i) => (g.tint = colors[i] ?? 0x888888));
  }

  setSelection(selection: MapSelection): void {
    this.selection = selection;
    if (this.ready) {
      this.drawSelection();
      this.drawCities();
    }
  }

  /** Borders moved: outline the regions that changed hands and re-place country names. */
  setTerritory(changed: ProvinceId[]): void {
    this.changedProvinces = changed;
    if (!this.ready) return;
    for (const label of this.countryLabels) label.text.destroy();
    this.countryLabels = [];
    this.buildCountryLabels();
    this.countryLabels.sort((a, b) => b.size - a.size);
    this.lastLabelScale = 0;
    this.updateLabels();
    this.drawCountryBorders();
  }

  setPlayerCity(id: CityId | null): void {
    this.playerCityId = id;
    if (this.ready) this.drawCities();
  }

  setShowProvinceBorders(show: boolean): void {
    this.provinceBorders.visible = show;
  }

  setShowTowns(show: boolean): void {
    this.showTowns = show;
    if (this.ready) this.drawCities();
  }

  setShowCityLabels(show: boolean): void {
    this.showCityLabels = show;
    if (this.ready) this.drawCities();
  }

  /** Centers the view on a map point, zooming in to at least `zoom` × the fitted scale. */
  focus(x: number, y: number, zoom = 6): void {
    if (!this.ready) return;
    const scale = Math.max(this.world.scale.x, this.fitScale * zoom);
    this.world.scale.set(scale);
    const { width, height } = this.app.screen;
    this.world.position.set(width / 2 - x * scale, height / 2 - y * scale);
    this.onViewChanged(true);
  }

  // ---------------------------------------------------------------------------------------------
  // Scene construction

  private buildScene(): void {
    const stage = this.app.stage;
    this.world.isRenderGroup = true;
    stage.addChild(this.world, this.overlay);

    for (const p of this.geo.provinces) {
      const g = new Graphics();
      for (const poly of p.polygons) {
        g.poly(poly[0]!).fill(0xffffff);
        for (const hole of poly.slice(1)) g.poly(hole).cut();
      }
      this.provinceGfx.push(g);
      this.provinces.addChild(g);
    }

    for (const poly of this.geo.lakes) {
      this.lakes.poly(poly[0]!).fill(OCEAN);
      for (const island of poly.slice(1)) this.lakes.poly(island).cut();
      for (const ring of poly) {
        this.lakeShores.moveTo(ring[0]!, ring[1]!);
        for (let i = 2; i < ring.length; i += 2) this.lakeShores.lineTo(ring[i]!, ring[i + 1]!);
        this.lakeShores.closePath();
      }
    }
    this.lakeShores.stroke({ color: 0x6f8aa0, alpha: 0.55, pixelLine: true });

    strokeLines(this.coast, this.geo.borders.coast);
    this.coast.stroke({ color: 0x6f8aa0, alpha: 0.55, pixelLine: true });
    strokeLines(this.provinceBorders, this.geo.borders.province);
    this.provinceBorders.stroke({ color: 0x10161d, alpha: 0.28, pixelLine: true });

    this.buildCountryLabels();
    this.countryLabels.sort((a, b) => b.size - a.size);
    this.buildWaterLabels();
    this.world.addChild(
      this.provinces,
      this.lakes,
      this.lakeShores,
      this.coast,
      this.provinceBorders,
      this.countryBorders,
      this.hoverGfx,
      this.selectionGfx,
      this.waterLabelLayer,
      this.countryLabelLayer,
    );
    this.overlay.addChild(this.cityDots, this.cityLabelLayer);
  }

  /** Names of oceans, seas, bays, straits and lakes, in the classic italic map style. */
  private buildWaterLabels(): void {
    const resolution = Math.max(1.5, 1.25 * (window.devicePixelRatio || 1));
    for (const w of this.geo.waterLabels) {
      const ocean = w.kind === "ocean";
      const text = new Text({
        text: ocean ? w.name.toUpperCase() : w.name,
        resolution,
        style: {
          fontFamily: "Georgia, 'Times New Roman', serif",
          fontStyle: "italic",
          fontSize: WATER_FONT,
          letterSpacing: ocean ? 9 : 1.5,
          align: "center",
          lineHeight: WATER_FONT * 1.25,
          fill: w.kind === "lake" ? 0x9fc2dc : 0x86aecb,
          stroke: { color: OCEAN, width: 4 },
        },
      });
      text.anchor.set(0.5);
      text.position.set(w.x, w.y);
      text.rotation = w.rotation;
      text.visible = false;
      this.waterLabelLayer.addChild(text);
      this.waterLabels.push({ text, size: w.size, maxPx: WATER_MAX_PX[w.kind] });
    }
  }

  /** Places each country's name over the middle of its largest connected landmass. */
  private buildCountryLabels(): void {
    for (const country of this.geo.countries) {
      const ids = new Set(country.provinceIds);
      const seen = new Set<number>();
      let best: number[] = [];
      let bestArea = 0;
      for (const start of country.provinceIds) {
        if (seen.has(start)) continue;
        const component: number[] = [];
        const stack = [start];
        seen.add(start);
        while (stack.length) {
          const id = stack.pop()!;
          component.push(id);
          for (const n of this.geo.provinces[id]!.neighbors) {
            if (ids.has(n) && !seen.has(n)) {
              seen.add(n);
              stack.push(n);
            }
          }
        }
        const area = component.reduce((s, id) => s + this.geo.provinces[id]!.areaKm2, 0);
        if (area > bestArea) {
          bestArea = area;
          best = component;
        }
      }
      if (bestArea < 15_000) continue;
      let cx = 0;
      let cy = 0;
      for (const id of best) {
        const p = this.geo.provinces[id]!;
        cx += p.label[0] * p.areaKm2;
        cy += p.label[1] * p.areaKm2;
      }
      cx /= bestArea;
      cy /= bestArea;
      // Snap to the nearest province label so the name sits on land.
      let anchor = this.geo.provinces[best[0]!]!.label;
      let bestD = Infinity;
      for (const id of best) {
        const l = this.geo.provinces[id]!.label;
        const d = (l[0] - cx) ** 2 + (l[1] - cy) ** 2;
        if (d < bestD) {
          bestD = d;
          anchor = l;
        }
      }
      const size = Math.min(70, Math.sqrt(bestArea) * 0.016);
      const text = new Text({
        text: country.name.toUpperCase(),
        resolution: Math.max(2, 1.5 * (window.devicePixelRatio || 1)),
        style: {
          fontFamily: "system-ui, sans-serif",
          fontSize: 32,
          fontWeight: "600",
          letterSpacing: 3,
          fill: 0xffffff,
          stroke: { color: 0x0b1118, width: 4 },
        },
      });
      text.anchor.set(0.5);
      text.alpha = 0.78;
      text.scale.set(size / 32);
      text.position.set(anchor[0], anchor[1]);
      this.countryLabelLayer.addChild(text);
      this.countryLabels.push({ text, size });
    }
  }

  // ---------------------------------------------------------------------------------------------
  // View updates

  private fitToView(): void {
    const { width, height } = this.app.screen;
    this.fitScale = Math.min(width / this.geo.width, height / this.geo.height);
    this.world.scale.set(this.fitScale);
    this.world.position.set(
      (width - this.geo.width * this.fitScale) / 2,
      (height - this.geo.height * this.fitScale) / 2,
    );
    this.onViewChanged(true);
  }

  /** Called after any pan/zoom. Zoom-dependent line widths are redrawn shortly after zooming stops. */
  private onViewChanged(zoomed = false): void {
    if (!this.ready) return;
    this.clampView();
    this.updateLabels();
    this.drawCities();
    if (zoomed) {
      window.clearTimeout(this.zoomRedrawTimer);
      this.zoomRedrawTimer = window.setTimeout(() => {
        this.drawCountryBorders();
        this.drawSelection();
        this.drawHover();
      }, 60);
    }
  }

  private clampView(): void {
    const s = this.world.scale.x;
    const { width, height } = this.app.screen;
    const margin = 120;
    const w = this.geo.width * s;
    const h = this.geo.height * s;
    const p = this.world.position;
    p.x = Math.min(Math.max(p.x, width - w - margin), margin);
    p.y = Math.min(Math.max(p.y, height - h - margin), margin);
    if (w + margin * 2 < width) p.x = (width - w) / 2;
    if (h + margin * 2 < height) p.y = (height - h) / 2;
  }

  private drawCountryBorders(): void {
    const g = this.countryBorders.clear();
    strokeLines(g, this.geo.borders.country);
    for (const id of this.changedProvinces) outlineProvince(g, this.geo, id);
    g.stroke({ color: 0x0b1118, alpha: 0.9, width: 1.4 / this.world.scale.x });
  }

  private drawSelection(): void {
    const g = this.selectionGfx.clear();
    const s = this.world.scale.x;
    const { countryId, provinceId } = this.selection;
    if (countryId) {
      const country = this.geo.countries.find((c) => c.id === countryId);
      for (const id of country?.provinceIds ?? []) outlineProvince(g, this.geo, id);
      g.stroke({ color: 0xffffff, alpha: 0.45, width: 1.2 / s });
    }
    if (provinceId !== null) {
      outlineProvince(g, this.geo, provinceId);
      g.stroke({ color: 0xf0b54a, width: 2.4 / s });
    }
  }

  private drawHover(): void {
    const g = this.hoverGfx.clear();
    if (this.hoverId === null || this.hoverId === this.selection.provinceId) return;
    outlineProvince(g, this.geo, this.hoverId);
    g.stroke({ color: 0xffffff, alpha: 0.7, width: 1.2 / this.world.scale.x });
  }

  /** Country and water label visibility. Only depends on zoom, so panning skips this work. */
  private updateLabels(): void {
    const s = this.world.scale.x;
    if (s === this.lastLabelScale) return;
    this.lastLabelScale = s;
    type Box = { x0: number; y0: number; x1: number; y1: number };
    const placed: Box[] = [];
    const overlaps = (box: Box) =>
      placed.some((b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0);

    // Country names: biggest countries first; a smaller name hides if it would collide.
    for (const { text, size } of this.countryLabels) {
      const px = size * s;
      let visible = px >= 9 && px <= 44;
      text.alpha = px > 34 ? 0.78 * (1 - (px - 34) / 10) : 0.78;
      if (visible) {
        const hw = (text.width / 2) * 1.04;
        const hh = (text.height / 2) * 1.04;
        const box = { x0: text.x - hw, y0: text.y - hh, x1: text.x + hw, y1: text.y + hh };
        visible = !overlaps(box);
        if (visible) placed.push(box);
      }
      text.visible = visible;
    }

    for (const { text, size, maxPx } of this.waterLabels) {
      const px = size * s;
      if (px < WATER_MIN_PX) {
        text.visible = false;
        continue;
      }
      text.scale.set(Math.min(px, maxPx) / s / WATER_FONT);
      // Labels are sorted biggest first; smaller names give way when they would overlap.
      // Axis-aligned box around the (possibly rotated) label.
      const cos = Math.abs(Math.cos(text.rotation));
      const sin = Math.abs(Math.sin(text.rotation));
      const hw = ((text.width * cos + text.height * sin) / 2) * 1.05;
      const hh = ((text.width * sin + text.height * cos) / 2) * 1.05;
      const box = { x0: text.x - hw, y0: text.y - hh, x1: text.x + hw, y1: text.y + hh };
      const hidden = overlaps(box);
      text.visible = !hidden;
      if (!hidden) placed.push(box);
    }
  }

  private drawCities(): void {
    const s = this.world.scale.x;
    const zoom = s / this.fitScale;
    const { width, height } = this.app.screen;
    // Higher zoom reveals smaller towns, but slowly enough that the map never fills with dots.
    const minImportance = 7.5 - 0.8 * Math.log2(Math.max(zoom, 1));
    const ox = this.world.position.x;
    const oy = this.world.position.y;

    this.visibleCities = [];
    for (const city of this.geo.cities) {
      const pinned = city.id === this.selection.cityId || city.id === this.playerCityId;
      if (city.minor && !this.showTowns && !pinned) continue;
      const important =
        city.importance >= minImportance ||
        (city.capital === 2 && zoom >= 1.8) ||
        city.id === this.selection.cityId ||
        city.id === this.playerCityId;
      if (!important) continue;
      const sx = ox + city.x * s;
      const sy = oy + city.y * s;
      if (sx < -20 || sy < -20 || sx > width + 20 || sy > height + 20) continue;
      this.visibleCities.push({ city, sx, sy });
    }

    const g = this.cityDots.clear();
    for (const { city, sx, sy } of this.visibleCities) {
      const r = city.capital === 2 ? 3.6 : 2.6;
      if (city.capital === 2) g.rect(sx - r, sy - r, r * 2, r * 2);
      else g.circle(sx, sy, r);
      g.fill(0xf4f1ea).stroke({ color: 0x0b1118, width: 1.2 });
    }
    const selected = this.visibleCities.find((c) => c.city.id === this.selection.cityId);
    if (selected) g.circle(selected.sx, selected.sy, 7).stroke({ color: 0xf0b54a, width: 2.5 });
    const player = this.visibleCities.find((c) => c.city.id === this.playerCityId);
    if (player) {
      g.star(player.sx, player.sy - 14, 5, 8, 3.6)
        .fill(0x4ade80)
        .stroke({ color: 0x0b1118, width: 1.5 });
    }

    this.drawCityLabels(zoom);
  }

  private drawCityLabels(zoom: number): void {
    const labels: { text: string; x: number; y: number; bold: boolean }[] = [];
    if (this.showCityLabels && zoom >= 2.4) {
      // Country and water names take priority; city names are placed around them.
      const occupied: [number, number, number, number][] = [];
      for (const { text } of [...this.countryLabels, ...this.waterLabels]) {
        if (!text.visible) continue;
        const b = text.getBounds();
        occupied.push([b.minX, b.minY, b.maxX, b.maxY]);
      }
      // The selected city and the player's home always get a label, then capitals, then by size.
      const isPinned = (c: GeoCity) => c.id === this.selection.cityId || c.id === this.playerCityId;
      const ordered = [...this.visibleCities].sort(
        (a, b) =>
          Number(isPinned(b.city)) - Number(isPinned(a.city)) ||
          b.city.capital - a.city.capital ||
          b.city.importance - a.city.importance,
      );
      for (const { city, sx, sy } of ordered) {
        if (labels.length >= MAX_CITY_LABELS) break;
        const w = city.name.length * 6.6 + 4;
        const box: [number, number, number, number] = [sx + 5, sy - 8, sx + 5 + w, sy + 8];
        const pinned = city.id === this.selection.cityId || city.id === this.playerCityId;
        if (
          !pinned &&
          occupied.some((o) => box[0] < o[2] && box[2] > o[0] && box[1] < o[3] && box[3] > o[1])
        ) {
          continue;
        }
        occupied.push(box);
        labels.push({ text: city.name, x: sx + 6, y: sy, bold: city.capital === 2 || pinned });
      }
    }
    while (this.cityLabelPool.length < labels.length) {
      const t = new Text({
        text: "",
        style: {
          fontFamily: "system-ui, sans-serif",
          fontSize: 12,
          fill: 0xf4f1ea,
          stroke: { color: 0x0b1118, width: 3 },
        },
      });
      t.anchor.set(0, 0.5);
      this.cityLabelPool.push(t);
      this.cityLabelLayer.addChild(t);
    }
    this.cityLabelPool.forEach((t, i) => {
      const label = labels[i];
      t.visible = !!label;
      if (!label) return;
      if (t.text !== label.text) t.text = label.text;
      t.style.fontWeight = label.bold ? "700" : "400";
      t.position.set(label.x, label.y);
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Input

  private attachInput(canvas: HTMLCanvasElement): void {
    const listen = <K extends keyof HTMLElementEventMap>(
      type: K,
      fn: (e: HTMLElementEventMap[K]) => void,
      options?: AddEventListenerOptions,
    ) => {
      canvas.addEventListener(type, fn, options);
      this.cleanup.push(() => canvas.removeEventListener(type, fn, options));
    };
    const local = (e: PointerEvent | WheelEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const toMap = (x: number, y: number) => ({
      x: (x - this.world.position.x) / this.world.scale.x,
      y: (y - this.world.position.y) / this.world.scale.y,
    });

    listen("pointerdown", (e) => {
      const p = local(e);
      this.drag = {
        x: p.x,
        y: p.y,
        px: this.world.position.x,
        py: this.world.position.y,
        moved: false,
      };
      canvas.setPointerCapture(e.pointerId);
    });
    listen("pointermove", (e) => {
      const p = local(e);
      if (this.drag) {
        const dx = p.x - this.drag.x;
        const dy = p.y - this.drag.y;
        if (!this.drag.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) this.drag.moved = true;
        if (this.drag.moved) {
          this.world.position.set(this.drag.px + dx, this.drag.py + dy);
          this.onViewChanged();
          canvas.style.cursor = "grabbing";
        }
        return;
      }
      const m = toMap(p.x, p.y);
      const id = this.hit.provinceAt(m.x, m.y);
      if (id !== this.hoverId) {
        this.hoverId = id;
        this.drawHover();
        canvas.style.cursor = id === null ? "default" : "pointer";
      }
    });
    listen("pointerup", (e) => {
      const drag = this.drag;
      this.drag = null;
      canvas.style.cursor = "default";
      if (!drag || drag.moved) return;
      const p = local(e);
      const city = this.visibleCities.find((c) => Math.hypot(c.sx - p.x, c.sy - p.y) <= 7);
      if (city) {
        this.callbacks.onCityClick(city.city.id);
        return;
      }
      const m = toMap(p.x, p.y);
      this.callbacks.onProvinceClick(this.hit.provinceAt(m.x, m.y));
    });
    listen("pointerleave", () => {
      if (this.hoverId !== null) {
        this.hoverId = null;
        this.drawHover();
      }
    });
    listen(
      "wheel",
      (e) => {
        e.preventDefault();
        const p = local(e);
        const before = toMap(p.x, p.y);
        const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0018));
        const scale = Math.min(
          Math.max(this.world.scale.x * factor, this.fitScale * 0.9),
          this.fitScale * MAX_ZOOM,
        );
        this.world.scale.set(scale);
        this.world.position.set(p.x - before.x * scale, p.y - before.y * scale);
        this.onViewChanged(true);
      },
      { passive: false },
    );
  }

  /** Zooms by a factor around the center of the view (for on-screen zoom buttons). */
  zoomBy(factor: number): void {
    if (!this.ready) return;
    const { width, height } = this.app.screen;
    const cx = (width / 2 - this.world.position.x) / this.world.scale.x;
    const cy = (height / 2 - this.world.position.y) / this.world.scale.y;
    const scale = Math.min(
      Math.max(this.world.scale.x * factor, this.fitScale * 0.9),
      this.fitScale * MAX_ZOOM,
    );
    this.world.scale.set(scale);
    this.world.position.set(width / 2 - cx * scale, height / 2 - cy * scale);
    this.onViewChanged(true);
  }

  resetView(): void {
    if (this.ready) this.fitToView();
  }
}

function strokeLines(g: Graphics, lines: FlatRing[]): void {
  for (const line of lines) {
    g.moveTo(line[0]!, line[1]!);
    for (let i = 2; i < line.length; i += 2) g.lineTo(line[i]!, line[i + 1]!);
  }
}

function outlineProvince(g: Graphics, geo: WorldGeography, id: ProvinceId): void {
  for (const poly of geo.provinces[id]?.polygons ?? []) {
    for (const ring of poly) {
      g.moveTo(ring[0]!, ring[1]!);
      for (let i = 2; i < ring.length; i += 2) g.lineTo(ring[i]!, ring[i + 1]!);
      g.closePath();
    }
  }
}
