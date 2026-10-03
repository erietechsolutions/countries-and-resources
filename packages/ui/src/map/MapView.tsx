import { useEffect, useMemo, useRef, useState } from "react";
import type { CityId, ProvinceId, WorldGeography, WorldState } from "@cr/sim";
import { useSettings } from "../storage/settings";
import { MapRenderer, type MapSelection } from "./MapRenderer";
import { hex, legendFor, MAP_MODES, provinceColors, type MapMode } from "./mapModes";

export interface FocusRequest {
  x: number;
  y: number;
  zoom?: number;
  /** Change this to re-trigger focusing on the same point. */
  key: number;
}

interface Props {
  geography: WorldGeography;
  world: WorldState;
  selection: MapSelection;
  playerCityId?: CityId | null;
  focus?: FocusRequest | null;
  onProvinceClick(id: ProvinceId | null): void;
  onCityClick(id: CityId): void;
}

export function MapView({
  geography,
  world,
  selection,
  playerCityId = null,
  focus,
  onProvinceClick,
  onCityClick,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<MapRenderer | null>(null);
  const [mode, setMode] = useState<MapMode>("political");
  const [loaded, setLoaded] = useState(false);
  const settings = useSettings();
  const callbacks = useRef({ onProvinceClick, onCityClick });
  callbacks.current = { onProvinceClick, onCityClick };

  useEffect(() => {
    const renderer = new MapRenderer(geography, {
      onProvinceClick: (id) => callbacks.current.onProvinceClick(id),
      onCityClick: (id) => callbacks.current.onCityClick(id),
    });
    rendererRef.current = renderer;
    let cancelled = false;
    renderer.init(hostRef.current!).then(() => {
      if (!cancelled) setLoaded(true);
    });
    return () => {
      cancelled = true;
      setLoaded(false);
      renderer.destroy();
      rendererRef.current = null;
    };
  }, [geography]);

  const colors = useMemo(() => provinceColors(mode, geography, world), [mode, geography, world]);

  useEffect(() => {
    if (loaded) rendererRef.current?.setColors(colors);
  }, [loaded, colors]);

  useEffect(() => {
    if (loaded) rendererRef.current?.setSelection(selection);
  }, [loaded, selection]);

  useEffect(() => {
    if (loaded) rendererRef.current?.setPlayerCity(playerCityId);
  }, [loaded, playerCityId]);

  useEffect(() => {
    if (!loaded) return;
    rendererRef.current?.setShowProvinceBorders(settings.showProvinceBorders);
    rendererRef.current?.setShowCityLabels(settings.showCityLabels);
    rendererRef.current?.setShowTowns(settings.showTowns);
  }, [loaded, settings.showProvinceBorders, settings.showCityLabels, settings.showTowns]);

  useEffect(() => {
    if (loaded && focus) rendererRef.current?.focus(focus.x, focus.y, focus.zoom);
  }, [loaded, focus]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLSelectElement ||
        e.ctrlKey ||
        e.metaKey
      )
        return;
      const m = MAP_MODES.find((mm) => mm.key === e.key.toUpperCase());
      if (m) setMode(m.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const legend = legendFor(mode);

  return (
    <div className="map-view">
      <div ref={hostRef} className="map-canvas" />
      {!loaded && <div className="map-loading">Drawing the world…</div>}
      <div className="map-toolbar" role="toolbar" aria-label="Map modes">
        {MAP_MODES.map((m) => (
          <button
            key={m.id}
            className={m.id === mode ? "chip active" : "chip"}
            onClick={() => setMode(m.id)}
            title={`${m.label} (${m.key})`}
          >
            {m.label}
          </button>
        ))}
      </div>
      <div className="map-zoom">
        <button
          className="icon-btn"
          onClick={() => rendererRef.current?.zoomBy(1.6)}
          aria-label="Zoom in"
        >
          +
        </button>
        <button
          className="icon-btn"
          onClick={() => rendererRef.current?.zoomBy(1 / 1.6)}
          aria-label="Zoom out"
        >
          −
        </button>
        <button
          className="icon-btn"
          onClick={() => rendererRef.current?.resetView()}
          aria-label="Show whole world"
          title="Show whole world"
        >
          ⤢
        </button>
      </div>
      <div className="map-legend">
        {legend.kind === "none" && <span className="muted">{legend.note}</span>}
        {legend.kind === "swatches" && (
          <div className="legend-swatches">
            {legend.items.map((item) => (
              <span key={item.label} className="legend-item">
                <i style={{ background: hex(item.color) }} />
                {item.label}
              </span>
            ))}
          </div>
        )}
        {legend.kind === "gradient" && (
          <div className="legend-gradient">
            <span>{legend.low}</span>
            <i
              style={{ background: `linear-gradient(90deg, ${legend.stops.map(hex).join(", ")})` }}
            />
            <span>{legend.high}</span>
          </div>
        )}
      </div>
    </div>
  );
}
