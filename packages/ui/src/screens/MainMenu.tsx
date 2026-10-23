import { useCallback, useEffect, useState } from "react";
import { formatDate, MODES } from "@cr/sim";
import { loadGeography } from "../data/geography";
import { checkForUpdates, isDesktop, quitApp, type AvailableUpdate } from "../platform";
import { listSaves, type SaveMeta } from "../storage/saves";

interface Props {
  onNewGame(): void;
  onLoad(): void;
  onSettings(): void;
  onContinue(saveId: string): void;
}

export function MainMenu({ onNewGame, onLoad, onSettings, onContinue }: Props) {
  const [latest, setLatest] = useState<SaveMeta | null>(null);
  const [update, setUpdate] = useState<AvailableUpdate | null>(null);
  const [installing, setInstalling] = useState<number | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  const recheck = useCallback(() => {
    setCheckError(null);
    checkForUpdates()
      .then((r) => {
        setUpdate(r.update);
        setCheckError(r.update ? null : r.error);
        setChecked(true);
      })
      .catch((e: unknown) => setCheckError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    listSaves()
      .then((saves) => setLatest(saves[0] ?? null))
      .catch(() => setLatest(null));
    // Start downloading the map while the player reads the menu.
    loadGeography("real-world").catch(() => {});
    recheck();
  }, [recheck]);

  const installUpdate = () => {
    if (!update?.install) return;
    setInstalling(0);
    setUpdateError(null);
    update.install(setInstalling).catch((e: unknown) => {
      setInstalling(null);
      setUpdateError(e instanceof Error ? e.message : String(e));
    });
  };

  return (
    <div className="menu-screen">
      <div className="menu-backdrop" aria-hidden />
      <main className="menu-panel">
        <h1 className="title">
          Countries <span>&</span> Resources
        </h1>
        <p className="subtitle">
          Start with nothing. Build a life, a fortune, a movement, a nation.
        </p>
        {update && (
          <div className="card highlight">
            <strong>Version {update.version} is available</strong>
            {update.notes && <p className="muted small">{update.notes}</p>}
            {updateError && <p className="warn-text small">Update failed: {updateError}</p>}
            {update.install ? (
              <button
                className="btn primary"
                disabled={installing !== null}
                onClick={installUpdate}
              >
                {installing === null
                  ? "Update and restart"
                  : `Downloading… ${Math.round(installing * 100)}%`}
              </button>
            ) : (
              <p className="small">
                The automatic updater couldn't install it, so download it from{" "}
                <span className="mono selectable">{update.downloadPage}</span>
                {checkError && <span className="muted"> (updater error: {checkError})</span>}
              </p>
            )}
          </div>
        )}
        <nav className="menu-buttons">
          {latest && (
            <button className="btn primary large" onClick={() => onContinue(latest.id)}>
              Continue
              <span className="btn-sub">
                {latest.summary.characterName} · {MODES[latest.summary.mode].name} ·{" "}
                {formatDate(latest.summary.gameTime)}
              </span>
            </button>
          )}
          <button className={latest ? "btn large" : "btn primary large"} onClick={onNewGame}>
            New Game
          </button>
          <button className="btn large" onClick={onLoad}>
            Load Game
          </button>
          <button className="btn large" onClick={onSettings}>
            Settings
          </button>
          {isDesktop && (
            <button className="btn large" onClick={() => void quitApp()}>
              Quit
            </button>
          )}
        </nav>
        <p className="version muted small">
          Version {__APP_VERSION__} · Map data: Natural Earth · Towns: GeoNames (CC BY 4.0)
          {isDesktop && !update && (
            <>
              {" · "}
              <button className="link" onClick={recheck}>
                Check for updates
              </button>
              {checked && !checkError && " (up to date)"}
              {checkError && <span className="warn-text"> Update check failed: {checkError}</span>}
            </>
          )}
        </p>
      </main>
    </div>
  );
}
