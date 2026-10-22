import {
  ageInYears,
  DISTANT_RELATIVE,
  formatDate,
  formatMoney,
  inheritanceTaxRate,
  personById,
  personName,
} from "@cr/sim";
import { useGameUi } from "../game/GameContext";

/** Shown when the player's character dies: pick an heir to carry on, or end the story. */
export function SuccessionModal({ onExit }: { onExit(): void }) {
  const { game, act } = useGameUi();
  const s = game.state.succession;
  if (!s) return null;
  const p = game.state.player;
  const inherits = (id: string) =>
    s.estateCents - Math.round(s.estateCents * inheritanceTaxRate(game, id));
  return (
    <div className="modal-backdrop">
      <div className="modal story-modal" role="dialog" aria-modal aria-labelledby="death-title">
        <h3 id="death-title">{s.name} is dead</h3>
        <p>
          {s.name} {s.cause} on {formatDate(s.time)}, aged {s.age}. They leave{" "}
          {formatMoney(s.estateCents, true)} after debts
          {game.state.businesses.some((b) => b.status === "active") && ", and their businesses"}.
        </p>
        <p className="muted small">Who carries the family on?</p>
        <div className="menu-buttons">
          {s.heirs.map((id, i) => {
            const person = id === DISTANT_RELATIVE ? undefined : personById(game, id);
            const rel = p.relationships.find((r) => r.personId === id);
            const label = person
              ? `${personName(person)} (${rel?.kind === "spouse" ? "spouse" : "child"}, ${ageInYears(person.birthTime, game.time)})`
              : `A distant relative from the ${p.lastName} family`;
            return (
              <button
                key={id}
                className={i === 0 ? "btn primary large" : "btn large"}
                onClick={() => act({ type: "succession.choose", personId: id })}
              >
                Continue as {label}
                <span className="btn-sub">
                  Inherits {formatMoney(inherits(id), true)} after taxes
                </span>
              </button>
            );
          })}
          <button className="btn large" onClick={onExit}>
            End the story
          </button>
        </div>
      </div>
    </div>
  );
}
