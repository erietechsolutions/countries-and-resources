import { useEffect, useState } from "react";
import { formatDate, MODES } from "@cr/sim";
import { loadGeography } from "../data/geography";
import { isDesktop, quitApp } from "../platform";
import { listSaves, type SaveMeta } from "../storage/saves";

interface Props {
  onNewGame(): void;
  onLoad(): void;
  onSettings(): void;
  onContinue(saveId: string): void;
}

export function MainMenu({ onNewGame, onLoad, onSettings, onContinue }: Props) {
  const [latest, setLatest] = useState<SaveMeta | null>(null);

  useEffect(() => {
    listSaves()
      .then((saves) => setLatest(saves[0] ?? null))
      .catch(() => setLatest(null));
    // Start downloading the map while the player reads the menu.
    loadGeography("real-world").catch(() => {});
  }, []);

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
        <p className="version muted small">Version 0.1 · Phase 1 preview</p>
      </main>
    </div>
  );
}
