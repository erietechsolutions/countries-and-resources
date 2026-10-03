import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ageInYears,
  createSaveFile,
  formatDate,
  formatMoney,
  formatTime,
  fullName,
  MODES,
  serializeSave,
  toDateParts,
  weekdayName,
  type CityId,
  type ProvinceId,
} from "@cr/sim";
import { Avatar } from "../components/Avatar";
import { CitySummary, CountryCard, ProvinceCard } from "../components/InfoCards";
import { SPEEDS, useRunnerVersion, type GameRunner, type Speed } from "../game/runner";
import { MapView, type FocusRequest } from "../map/MapView";
import { useSettings } from "../storage/settings";
import { AUTOSAVE_ID, newSaveId, writeSave } from "../storage/saves";
import { LoadGamePanel } from "./LoadGameScreen";
import { SettingsPanel } from "./SettingsScreen";

interface Props {
  runner: GameRunner;
  initialSaveId: string | null;
  onExit(): void;
  onLoadSave(id: string): void;
  onImportSave(text: string): void;
}

type Menu = null | "main" | "save" | "load" | "settings" | "confirmExit";

export function GameScreen({ runner, initialSaveId, onExit, onLoadSave, onImportSave }: Props) {
  useRunnerVersion(runner);
  const { game } = runner;
  const { state, geography } = game;
  const settings = useSettings();

  const [menu, setMenuState] = useState<Menu>(null);
  const [tab, setTab] = useState<"character" | "region">("character");
  const [provinceId, setProvinceId] = useState<ProvinceId | null>(null);
  const [cityId, setCityId] = useState<CityId | null>(null);
  const [saveId, setSaveId] = useState<string | null>(initialSaveId);
  const [savedAtTime, setSavedAtTime] = useState<number | null>(initialSaveId ? state.time : null);
  const [toast, setToast] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState(true);
  const speedBeforeMenu = useRef<Speed>(0);

  const playerCity = geography.cities[state.player.cityId]!;
  const [focus, setFocus] = useState<FocusRequest | null>({
    x: playerCity.x,
    y: playerCity.y,
    zoom: 6,
    key: 0,
  });

  useEffect(() => {
    runner.start();
    return () => runner.stop();
  }, [runner]);

  const flash = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast((t) => (t === message ? null : t)), 2500);
  }, []);

  const saveTo = useCallback(
    async (id: string, name: string) => {
      const file = createSaveFile(game.state, game.geography, new Date().toISOString());
      await writeSave(id, name, file, serializeSave(file));
      return file;
    },
    [game],
  );

  // Autosave at the start of each in-game month.
  const autosaveEnabled = settings.autosave;
  useEffect(() => {
    if (!autosaveEnabled) return;
    return game.events.on("month", () => {
      saveTo(AUTOSAVE_ID, "Autosave")
        .then(() => flash("Autosaved"))
        .catch(() => flash("Autosave failed"));
    });
  }, [game, autosaveEnabled, saveTo, flash]);

  /** Opening the menu pauses the game; closing it restores the previous speed. */
  const setMenu = useCallback(
    (next: Menu) => {
      if (menu === null && next !== null) {
        speedBeforeMenu.current = runner.speed;
        runner.setSpeed(0);
      } else if (menu !== null && next === null) {
        runner.setSpeed(speedBeforeMenu.current);
      }
      setMenuState(next);
    },
    [menu, runner],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === "Escape") {
        setMenu(menu === null ? "main" : null);
        return;
      }
      if (menu !== null) return;
      if (e.code === "Space") {
        e.preventDefault();
        runner.togglePause();
      } else if (e.key === "1" || e.key === "2" || e.key === "3") {
        runner.setSpeed(SPEEDS[Number(e.key) - 1]!);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu, runner, setMenu]);

  const dirty = savedAtTime !== state.time;
  const date = toDateParts(state.time);
  const country = geography.countries.find((c) => c.id === playerCity.countryId)!;
  const selectedCountryId = provinceId !== null ? geography.provinces[provinceId]!.countryId : null;
  const selection = useMemo(
    () => ({ provinceId, countryId: selectedCountryId, cityId }),
    [provinceId, selectedCountryId, cityId],
  );

  const quickSave = async (asNew: boolean, name?: string) => {
    const id = asNew || !saveId || saveId === AUTOSAVE_ID ? newSaveId() : saveId;
    const label = name?.trim() || `${fullName(state.player)} · ${formatDate(state.time)}`;
    try {
      await saveTo(id, label);
      setSaveId(id);
      setSavedAtTime(state.time);
      flash("Game saved");
      return true;
    } catch (e) {
      flash(e instanceof Error ? `Save failed: ${e.message}` : "Save failed");
      return false;
    }
  };

  return (
    <div className="game-screen">
      <header className="top-bar">
        <button
          className="btn icon"
          onClick={() => setMenu("main")}
          aria-label="Menu"
          title="Menu (Esc)"
        >
          ☰
        </button>
        <div className="clock">
          <span className="clock-date">
            {weekdayName(date.weekday)}, {formatDate(state.time)}
          </span>
          <span className="clock-time">{formatTime(state.time)}</span>
        </div>
        <div className="speed" role="group" aria-label="Game speed">
          <button
            className={runner.speed === 0 ? "active" : undefined}
            onClick={() => runner.setSpeed(0)}
            title="Pause (Space)"
            aria-label="Pause"
          >
            ❚❚
          </button>
          {SPEEDS.map((s, i) => (
            <button
              key={s}
              className={runner.speed === s ? "active" : undefined}
              onClick={() => runner.setSpeed(s)}
              title={`Speed ${s}x (${i + 1})`}
            >
              {s}x
            </button>
          ))}
        </div>
        {runner.speed === 0 && <span className="paused-badge">Paused</span>}
        <div className="top-stats">
          <span title="Cash">
            <span className="muted small">Cash</span>{" "}
            <strong>{formatMoney(state.player.cashCents)}</strong>
          </span>
          <span title="Home">
            <span className="muted small">Home</span>{" "}
            <strong>{state.player.housing === "homeless" ? "Homeless" : "Parents' house"}</strong>
          </span>
          <button
            className="link"
            onClick={() => setFocus({ x: playerCity.x, y: playerCity.y, zoom: 6, key: Date.now() })}
            title="Show on map"
          >
            📍 {playerCity.name}, {country.name}
          </button>
        </div>
      </header>

      <div className="game-body">
        <MapView
          geography={geography}
          world={state.world}
          selection={selection}
          playerCityId={state.player.cityId}
          focus={focus}
          onProvinceClick={(id) => {
            setProvinceId(id);
            setCityId(null);
            if (id !== null) setTab("region");
          }}
          onCityClick={(id) => {
            setCityId(id);
            setProvinceId(geography.cities[id]!.provinceId);
            setTab("region");
          }}
        />

        <aside className="side-panel right">
          <div className="tabs" role="tablist">
            <button
              role="tab"
              aria-selected={tab === "character"}
              onClick={() => setTab("character")}
            >
              Character
            </button>
            <button role="tab" aria-selected={tab === "region"} onClick={() => setTab("region")}>
              Region
            </button>
          </div>
          {tab === "character" ? (
            <section className="card">
              <div className="character-head">
                <Avatar appearance={state.player.appearance} size={88} />
                <div>
                  <h3>{fullName(state.player)}</h3>
                  <p className="muted small">
                    Age {ageInYears(state.player.birthTime, state.time)} · Born{" "}
                    {formatDate(state.player.birthTime)}
                  </p>
                  <p className="small">{MODES[state.config.mode].name} mode</p>
                </div>
              </div>
              <div className="stat-grid">
                <div className="stat">
                  <span className="stat-label">Cash</span>
                  <span className="stat-value">{formatMoney(state.player.cashCents)}</span>
                </div>
                <div className="stat">
                  <span className="stat-label">Health</span>
                  <span className="stat-value">{state.player.health}/100</span>
                </div>
                <div className="stat">
                  <span className="stat-label">Home</span>
                  <span className="stat-value">
                    {state.player.housing === "homeless" ? "Homeless" : "Parents' house"}
                  </span>
                </div>
                <div className="stat">
                  <span className="stat-label">Citizenship</span>
                  <span className="stat-value">
                    {state.player.citizenship
                      .map((id) => geography.countries.find((c) => c.id === id)?.name ?? id)
                      .join(", ")}
                  </span>
                </div>
              </div>
              <h4>Where you live</h4>
              <CitySummary geo={geography} world={state.world} cityId={state.player.cityId} />
              <p className="hint">
                Needs, jobs and daily life arrive in Phase 2. For now, explore the world map and
                watch time pass.
              </p>
            </section>
          ) : provinceId === null ? (
            <p className="hint">Click a region or city on the map to see its details.</p>
          ) : (
            <>
              {cityId !== null && (
                <section className="card highlight">
                  <CitySummary geo={geography} world={state.world} cityId={cityId} />
                </section>
              )}
              <ProvinceCard geo={geography} world={state.world} provinceId={provinceId} />
              {selectedCountryId && (
                <CountryCard geo={geography} world={state.world} countryId={selectedCountryId} />
              )}
            </>
          )}
        </aside>

        <section className={logOpen ? "log-panel" : "log-panel collapsed"} aria-label="Event log">
          <button className="log-toggle" onClick={() => setLogOpen(!logOpen)}>
            {logOpen ? "▾" : "▸"} Events
          </button>
          {logOpen && (
            <ol>
              {state.log
                .slice(-8)
                .reverse()
                .map((entry, i) => (
                  <li key={`${entry.time}-${i}`} className={`log-${entry.category}`}>
                    <span className="muted small">{formatDate(entry.time)}</span> {entry.message}
                  </li>
                ))}
            </ol>
          )}
        </section>
      </div>

      {menu !== null && (
        <div className="modal-backdrop" onClick={() => setMenu(null)}>
          <div className="modal" role="dialog" aria-modal onClick={(e) => e.stopPropagation()}>
            {menu === "main" && (
              <div className="menu-buttons">
                <h3>Game Menu</h3>
                <button className="btn primary large" onClick={() => setMenu(null)}>
                  Resume
                </button>
                <button className="btn large" onClick={() => setMenuState("save")}>
                  Save Game
                </button>
                <button className="btn large" onClick={() => setMenuState("load")}>
                  Load Game
                </button>
                <button className="btn large" onClick={() => setMenuState("settings")}>
                  Settings
                </button>
                <button
                  className="btn large"
                  onClick={() => (dirty ? setMenuState("confirmExit") : onExit())}
                >
                  Exit to Main Menu
                </button>
              </div>
            )}
            {menu === "save" && (
              <SaveDialog
                onCancel={() => setMenuState("main")}
                hasSlot={!!saveId && saveId !== AUTOSAVE_ID}
                onSave={async (asNew, name) => {
                  if (await quickSave(asNew, name)) setMenu(null);
                }}
              />
            )}
            {menu === "load" && (
              <>
                <h3>Load Game</h3>
                {dirty && (
                  <p className="warn-text small">Unsaved progress in this game will be lost.</p>
                )}
                <LoadGamePanel onLoad={onLoadSave} onImport={onImportSave} />
                <button className="btn" onClick={() => setMenuState("main")}>
                  ← Back
                </button>
              </>
            )}
            {menu === "settings" && (
              <>
                <h3>Settings</h3>
                <SettingsPanel />
                <button className="btn" onClick={() => setMenuState("main")}>
                  ← Back
                </button>
              </>
            )}
            {menu === "confirmExit" && (
              <div className="menu-buttons">
                <h3>Exit to main menu?</h3>
                <p className="muted">You have unsaved progress.</p>
                <button
                  className="btn primary large"
                  onClick={async () => {
                    if (await quickSave(false)) onExit();
                  }}
                >
                  Save and Exit
                </button>
                <button className="btn large danger" onClick={onExit}>
                  Exit Without Saving
                </button>
                <button className="btn large" onClick={() => setMenuState("main")}>
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function SaveDialog({
  hasSlot,
  onSave,
  onCancel,
}: {
  hasSlot: boolean;
  onSave(asNew: boolean, name: string): void;
  onCancel(): void;
}) {
  const [name, setName] = useState("");
  return (
    <form
      className="save-dialog"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(!hasSlot, name);
      }}
    >
      <h3>Save Game</h3>
      <label className="field">
        <span>Save name (optional)</span>
        <input
          className="input"
          value={name}
          maxLength={60}
          placeholder="Name · date"
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
      </label>
      <div className="row">
        {hasSlot && (
          <button type="submit" className="btn primary">
            Overwrite current save
          </button>
        )}
        <button
          type={hasSlot ? "button" : "submit"}
          className={hasSlot ? "btn" : "btn primary"}
          onClick={hasSlot ? () => onSave(true, name) : undefined}
        >
          Save as new
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
