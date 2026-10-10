import { useState } from "react";
import {
  ACTIVITIES,
  activityBlocker,
  caseOptions,
  CRIME_LABELS,
  CRIME_RISK,
  detectionChance,
  embezzlementCap,
  formatDate,
  formatMoney,
  formatPercent,
  GANG_RANKS,
} from "@cr/sim";
import { Meter } from "../components/Meter";
import { useGameUi } from "../game/GameContext";

export function LawPanel() {
  const { game, act } = useGameUi();
  const p = game.state.player;
  const legal = p.legal;
  const [amount, setAmount] = useState("");
  const cap = embezzlementCap(game);
  const crimes = ACTIVITIES.filter((a) => a.category === "crime");

  return (
    <div className="panel-stack">
      {legal.pendingCase && (
        <section className="card highlight">
          <h4 className="no-margin">You've been arrested</h4>
          <p className="small">
            Charge: <strong>{CRIME_LABELS[legal.pendingCase.crime]}</strong>. Hearing on{" "}
            {formatDate(legal.pendingCase.trialAt)}. If you don't decide, a public defender handles
            it.
          </p>
          <ul className="offer-list">
            {caseOptions(game).map((o) => (
              <li key={o.choice}>
                <div>
                  <strong>{o.label}</strong>{" "}
                  {o.costCents > 0 && (
                    <span className="small">{formatMoney(o.costCents, true)}</span>
                  )}
                  <div className="muted small">{o.note}</div>
                </div>
                <button
                  className="btn small"
                  disabled={o.costCents > p.cashCents}
                  onClick={() => act({ type: "legal.resolve", choice: o.choice })}
                >
                  Choose
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <h4 className="no-margin">Legal status</h4>
        <p className="small">
          {legal.prisonUntil
            ? `In prison until ${formatDate(legal.prisonUntil)}.`
            : (legal.probationUntil ?? 0) > game.time
              ? `On probation until ${formatDate(legal.probationUntil!)}: getting caught again is more likely.`
              : legal.record.length
                ? "Free, with a criminal record."
                : "Clean record."}
        </p>
        <Meter
          label="Police attention"
          value={legal.heat}
          compact
          tone={legal.heat > 50 ? "auto" : "accent"}
        />
        {legal.record.length > 0 && (
          <>
            <h4>Criminal record</h4>
            <ul className="gov-list">
              {legal.record.map((r, i) => (
                <li key={i}>
                  <span>
                    {CRIME_LABELS[r.crime]}{" "}
                    <span className="muted small">{formatDate(r.time)}</span>
                  </span>
                  <span className="small">{r.sentence}</span>
                </li>
              ))}
            </ul>
            <p className="muted small">
              A record makes it harder to get hired, win elections and get visas.
            </p>
          </>
        )}
        {legal.secrets.length > 0 && (
          <p className="warn-text small">
            {legal.secrets.length} thing{legal.secrets.length > 1 ? "s" : ""} in your past could
            still come out as a scandal. The more famous you get, the likelier it is.
          </p>
        )}
      </section>

      <section className="card">
        <h4 className="no-margin">Crime</h4>
        <p className="muted small">
          Quick money, real risk. Odds of getting caught right now are shown for each.
        </p>
        <ul className="action-list">
          {crimes.map((def) => {
            const blocked = activityBlocker(game, def);
            const risk = detectionChance(
              game,
              CRIME_RISK[def.id as keyof typeof CRIME_RISK] ?? 0.15,
            );
            return (
              <li
                key={def.id}
                className={blocked ? "action blocked" : "action"}
                title={def.description}
              >
                <div className="action-main">
                  <span className="action-name">{def.label}</span>
                  <span className="muted small">
                    {def.hours(game)}h · {formatPercent(risk, 0)} chance of arrest
                    {blocked && ` · ${blocked}`}
                  </span>
                </div>
                <button
                  className="btn small danger"
                  disabled={!!blocked}
                  onClick={() => act({ type: "activity.start", activityId: def.id })}
                >
                  Do it
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="card">
        <h4 className="no-margin">Organized crime</h4>
        {legal.gangRank > 0 ? (
          <div className="row between">
            <span>
              Gang rank: <strong>{GANG_RANKS[legal.gangRank]}</strong>
            </span>
            <button className="btn small danger" onClick={() => act({ type: "crime.leaveGang" })}>
              Leave the gang
            </button>
          </div>
        ) : (
          <div className="row between">
            <span className="muted small">
              Gangs only take people with a name in the underworld (15+).
            </span>
            <button
              className="btn small"
              disabled={p.reputation.underworld < 15}
              onClick={() => act({ type: "crime.joinGang" })}
            >
              Join a gang
            </button>
          </div>
        )}
      </section>

      {cap > 0 && (
        <section className="card">
          <h4 className="no-margin">Public funds</h4>
          <p className="muted small">
            As an official you could quietly move up to {formatMoney(cap, true)} of public money to
            yourself. It might never come out. It might.
          </p>
          <div className="row">
            <input
              className="input small-input"
              placeholder="$"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <button
              className="btn small danger"
              onClick={() =>
                act({
                  type: "crime.embezzle",
                  amountCents: Math.round(Number(amount.replace(/[^0-9.]/g, "")) * 100) || 0,
                })
              }
            >
              Embezzle
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
