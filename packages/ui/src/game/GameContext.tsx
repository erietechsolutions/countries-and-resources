import { createContext, useCallback, useContext } from "react";
import type { Command, Game } from "@cr/sim";
import type { GameRunner } from "./runner";

export interface GameUi {
  runner: GameRunner;
  game: Game;
  /** Sends a command; shows the reason as a notification if it is refused. */
  act(command: Command): boolean;
  notify(level: "good" | "bad" | "info", message: string): void;
}

export const GameUiContext = createContext<GameUi | null>(null);

export function useGameUi(): GameUi {
  const ui = useContext(GameUiContext);
  if (!ui) throw new Error("useGameUi must be used inside a game screen");
  return ui;
}

export function useAct(runner: GameRunner, notify: GameUi["notify"]) {
  return useCallback(
    (command: Command) => {
      const result = runner.dispatch(command);
      if (!result.ok) notify("bad", result.reason);
      return result.ok;
    },
    [runner, notify],
  );
}
