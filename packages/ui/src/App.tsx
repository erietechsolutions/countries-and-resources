import { useCallback, useState } from "react";
import { Game, parseSave } from "@cr/sim";
import { loadGeography } from "./data/geography";
import { GameRunner } from "./game/runner";
import { GameScreen } from "./screens/GameScreen";
import { LoadGameScreen } from "./screens/LoadGameScreen";
import { MainMenu } from "./screens/MainMenu";
import { NewGameWizard } from "./screens/NewGameWizard";
import { SettingsScreen } from "./screens/SettingsScreen";
import { readSave } from "./storage/saves";

type Screen =
  | { name: "menu" }
  | { name: "newGame" }
  | { name: "load" }
  | { name: "settings" }
  | { name: "playing"; runner: GameRunner; saveId: string | null; key: number };

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: "menu" });
  const [error, setError] = useState<string | null>(null);

  const play = useCallback((game: Game, saveId: string | null) => {
    setScreen({ name: "playing", runner: new GameRunner(game), saveId, key: Date.now() });
  }, []);

  /** Loads a save from storage or from file text and starts playing it. */
  const openSave = useCallback(
    async (source: { id: string } | { text: string }) => {
      setError(null);
      try {
        const file = "id" in source ? (await readSave(source.id)).file : parseSave(source.text);
        const geography = await loadGeography(file.state.config.geographyId);
        play(new Game(file.state, geography), "id" in source ? source.id : null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [play],
  );

  const toMenu = useCallback(() => setScreen({ name: "menu" }), []);

  return (
    <>
      {screen.name === "menu" && (
        <MainMenu
          onNewGame={() => setScreen({ name: "newGame" })}
          onLoad={() => setScreen({ name: "load" })}
          onSettings={() => setScreen({ name: "settings" })}
          onContinue={(id) => openSave({ id })}
        />
      )}
      {screen.name === "newGame" && (
        <NewGameWizard onCancel={toMenu} onStart={(game) => play(game, null)} />
      )}
      {screen.name === "load" && (
        <LoadGameScreen
          onBack={toMenu}
          onLoad={(id) => openSave({ id })}
          onImport={(text) => openSave({ text })}
        />
      )}
      {screen.name === "settings" && <SettingsScreen onBack={toMenu} />}
      {screen.name === "playing" && (
        <GameScreen
          key={screen.key}
          runner={screen.runner}
          initialSaveId={screen.saveId}
          onExit={toMenu}
          onLoadSave={(id) => openSave({ id })}
          onImportSave={(text) => openSave({ text })}
        />
      )}
      {error && (
        <div className="toast error" role="alert">
          <span>{error}</span>
          <button className="btn small" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}
    </>
  );
}
