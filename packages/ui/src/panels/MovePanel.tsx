import { useState } from "react";
import {
  currentResidency,
  formatDate,
  formatMoney,
  formatPercent,
  naturalizationBlocker,
  planMove,
  RESIDENCY_LABELS,
  VISA_LABELS,
  visaOptions,
  type CityId,
} from "@cr/sim";
import { useGameUi } from "../game/GameContext";

/** Shown under a selected city: moving there, and the visas needed if it's abroad. */
export function MovePanel({ cityId }: { cityId: CityId }) {
  const { game, act } = useGameUi();
  const [confirmIllegal, setConfirmIllegal] = useState(false);
  const p = game.state.player;
  if (cityId === p.cityId) return null;
  const city = game.geography.cities[cityId]!;
  const country = game.geography.countries.find((c) => c.id === city.countryId)!;
  const plan = planMove(game, cityId);
  const abroad = plan.international;
  const needsVisa = abroad && !plan.status;
  const pendingHere = p.visaApplication?.countryId === country.id;

  return (
    <section className="card">
      <h4 className="no-margin">Move to {city.name}</h4>
      <p className="muted small">
        {formatMoney(plan.costCents, true)} · {plan.hours}h of travel
        {plan.status && ` · you'd live there as: ${RESIDENCY_LABELS[plan.status]}`}. Moving means
        leaving your job and home.
      </p>
      {!needsVisa && (
        <button
          className="btn small primary align-start"
          disabled={!!plan.blocker}
          title={plan.blocker ?? undefined}
          onClick={() => act({ type: "move.to", cityId })}
        >
          Move here
        </button>
      )}
      {plan.blocker && !needsVisa && <p className="warn-text small">{plan.blocker}</p>}
      {needsVisa && (
        <>
          {pendingHere ? (
            <p className="small">
              Your {VISA_LABELS[p.visaApplication!.visa].toLowerCase()} application is being
              processed (decision by {formatDate(p.visaApplication!.decideAt)}).
            </p>
          ) : (
            <p className="small">To live in {country.name} legally, you need a visa:</p>
          )}
          <ul className="offer-list">
            {visaOptions(game, country.id).map((v) => (
              <li key={v.visa}>
                <div>
                  <strong>{VISA_LABELS[v.visa]}</strong>{" "}
                  <span className="muted small">
                    {formatMoney(v.feeCents, true)} · ~{formatPercent(v.chance, 0)} approval ·{" "}
                    {v.days} days
                  </span>
                  <div className="muted small">{v.blocker ?? v.description}</div>
                </div>
                <button
                  className="btn small"
                  disabled={!!v.blocker}
                  onClick={() =>
                    act({ type: "immigration.apply", countryId: country.id, visa: v.visa })
                  }
                >
                  Apply
                </button>
              </li>
            ))}
          </ul>
          <div className="row">
            {confirmIllegal ? (
              <>
                <span className="small warn-text">
                  Risky: you may be caught at the border, and without papers you can't work formally
                  or rent.
                </span>
                <button
                  className="btn small danger"
                  onClick={() => act({ type: "move.to", cityId, illegal: true })}
                >
                  Cross anyway ({formatMoney(planMove(game, cityId, true).costCents, true)})
                </button>
                <button className="btn small" onClick={() => setConfirmIllegal(false)}>
                  Cancel
                </button>
              </>
            ) : (
              <button className="btn small danger" onClick={() => setConfirmIllegal(true)}>
                Cross the border illegally…
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

/** Legal status where the player lives, shown in the Home tab. */
export function ResidencyCard() {
  const { game, act } = useGameUi();
  const p = game.state.player;
  const r = currentResidency(game);
  const country = game.geography.countries.find((c) => c.id === r.countryId)!;
  const blocked = naturalizationBlocker(game);
  return (
    <section className="card">
      <h4 className="no-margin">Legal status</h4>
      <p>
        <strong>{RESIDENCY_LABELS[r.status]}</strong>{" "}
        <span className="muted small">in {country.name}</span>
        {r.expiresAt !== null && (
          <span className="muted small"> · expires {formatDate(r.expiresAt)}</span>
        )}
      </p>
      <p className="muted small">
        Citizenship:{" "}
        {p.citizenship
          .map((id) => game.geography.countries.find((c) => c.id === id)?.name ?? id)
          .join(", ")}
      </p>
      {p.visaApplication && (
        <p className="small">
          Pending: {VISA_LABELS[p.visaApplication.visa]} for{" "}
          {game.geography.countries.find((c) => c.id === p.visaApplication!.countryId)?.name}{" "}
          (decision {formatDate(p.visaApplication.decideAt)})
        </p>
      )}
      {p.visas.map((v) => (
        <p key={v.countryId} className="good-text small">
          Approved: {VISA_LABELS[v.visa]} for{" "}
          {game.geography.countries.find((c) => c.id === v.countryId)?.name}. Move there before{" "}
          {formatDate(v.validUntil)}.
        </p>
      ))}
      {r.status !== "citizen" && (
        <button
          className="btn small align-start"
          disabled={!!blocked}
          title={blocked ?? undefined}
          onClick={() => act({ type: "immigration.naturalize" })}
        >
          {r.status === "permanent" ? "Apply for citizenship" : "Apply for permanent residency"}
        </button>
      )}
      {r.status !== "citizen" && blocked && <p className="muted small">{blocked}</p>}
    </section>
  );
}
