import {
  averageRelationship,
  cityCosts,
  formatMoney,
  ITEMS,
  MOVE_BACK_RELATIONSHIP,
  personalityLabel,
  rentalListings,
  unitType,
} from "@cr/sim";
import { Meter } from "../components/Meter";
import { ResidencyCard } from "./MovePanel";
import { useGameUi } from "../game/GameContext";

export function HomePanel() {
  const { game, act } = useGameUi();
  const p = game.state.player;
  const h = p.housing;
  const costs = cityCosts(game, p.cityId);
  const family = game.state.family;
  const rel = averageRelationship(family);

  return (
    <div className="panel-stack">
      <ResidencyCard />
      <section className="card">
        <h4 className="no-margin">Where you live</h4>
        {h.kind === "parents" && (
          <p>
            <strong>Your parents' basement.</strong>{" "}
            <span className="muted small">
              Free rent and cheaper living, as long as they're happy with you.
            </span>
          </p>
        )}
        {h.kind === "homeless" && (
          <p>
            <strong>Homeless.</strong>{" "}
            <span className="muted small">
              {p.shelterBedUntil
                ? "You have a shelter bed tonight."
                : "Check into a shelter in the evening (5–11 PM) for a bed."}
            </span>
          </p>
        )}
        {h.kind === "renting" && (
          <p>
            <strong>{unitType(h.unit).label}</strong>{" "}
            <span className="muted small">
              {formatMoney(h.rentCents)}/month, charged on the 1st.
              {h.missedPayments > 0 && " You're behind on rent: pay next month or be evicted."}
            </span>
          </p>
        )}
        {h.kind !== "parents" && family.length > 0 && (
          <button
            className="btn small"
            disabled={rel < MOVE_BACK_RELATIONSHIP}
            onClick={() => act({ type: "housing.moveBackHome" })}
          >
            Move back in with parents{" "}
            {rel < MOVE_BACK_RELATIONSHIP && `(needs relationship ${MOVE_BACK_RELATIONSHIP})`}
          </button>
        )}
      </section>

      {family.length > 0 && (
        <section className="card">
          <h4 className="no-margin">Family</h4>
          {family.map((m) => (
            <div key={m.id} className="family-row">
              <div className="small">
                <strong>
                  {m.firstName} {m.lastName}
                </strong>{" "}
                <span className="muted">
                  · {m.relation === "mother" ? "Mother" : "Father"} ·{" "}
                  {personalityLabel(m.personality)}
                </span>
              </div>
              <Meter label="Relationship" value={m.relationship} compact />
            </div>
          ))}
          {h.kind === "parents" && !p.job && !p.education && (
            <p className="muted small">
              Your parents expect you to work or study. Helping around the house keeps the peace.
            </p>
          )}
        </section>
      )}

      <section className="card">
        <h4 className="no-margin">Apartments for rent</h4>
        <ul className="offer-list">
          {rentalListings(game).map((l) => (
            <li key={l.unit}>
              <div>
                <strong>{l.label}</strong>{" "}
                <span className="small">{formatMoney(l.rentCents, true)}/mo</span>
                <div className="muted small">
                  {l.available
                    ? `${formatMoney(l.upfrontCents, true)} up front (deposit + first month)${l.cosigned ? " · your parents will co-sign" : ""}`
                    : l.reason}
                </div>
              </div>
              <button
                className="btn small"
                disabled={!l.available}
                onClick={() => act({ type: "housing.rent", unit: l.unit })}
              >
                Rent
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h4 className="no-margin">Shop</h4>
        <ul className="offer-list">
          {ITEMS.map((item) => {
            const owned = p.inventory.items.includes(item.id);
            const price = costs.itemCents(item.id);
            return (
              <li key={item.id}>
                <div>
                  <strong>{item.name}</strong> <span className="small">{formatMoney(price)}</span>
                  <div className="muted small">{item.description}</div>
                </div>
                {owned ? (
                  <button
                    className="btn small"
                    onClick={() => act({ type: "shop.sell", item: item.id })}
                    title="Sell for about a third of the price"
                  >
                    Sell
                  </button>
                ) : (
                  <button
                    className="btn small"
                    disabled={price > p.cashCents}
                    onClick={() => act({ type: "shop.buy", item: item.id })}
                  >
                    Buy
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
