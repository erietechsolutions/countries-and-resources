import { useState } from "react";
import { countryName, formatDate, snapshot } from "@cr/sim";
import { useGameUi } from "../game/GameContext";
import { recordStats, RecordTable } from "../panels/GovernmentPanel";

const YEAR = 365 * 24;

/** Leader mode: shown once the player is out of power, with their record. */
export function ReignEndedModal({ onExit }: { onExit(): void }) {
  const { game } = useGameUi();
  const [dismissed, setDismissed] = useState(false);
  const reign = game.state.reign;
  if (!reign || reign.endedAt === null || dismissed) return null;
  const years = (reign.endedAt - reign.startedAt) / YEAR;
  return (
    <div className="modal-backdrop">
      <div className="modal story-modal" role="dialog" aria-modal aria-labelledby="reign-title">
        <h3 id="reign-title">Your rule is over</h3>
        <p>
          {reign.endReason} You led {countryName(game, reign.countryId)} from{" "}
          {formatDate(reign.startedAt)} to {formatDate(reign.endedAt)} (
          {years < 1 ? "less than a year" : `${years.toFixed(1)} years`}).
        </p>
        {(game.state.world.countries[reign.countryId]?.population ?? 0) > 0 && (
          <RecordTable stats={recordStats(reign.start, snapshot(game, reign.countryId))} />
        )}
        <div className="menu-buttons">
          <button className="btn primary large" onClick={onExit}>
            Exit to main menu
          </button>
          <button className="btn large" onClick={() => setDismissed(true)}>
            Keep watching the world
          </button>
        </div>
      </div>
    </div>
  );
}
