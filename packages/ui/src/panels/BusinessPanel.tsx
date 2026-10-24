import { useState } from "react";
import {
  activeBusinesses,
  activityBlocker,
  activityById,
  cityCosts,
  formatMoney,
  formatPercent,
  foundingCost,
  locationSetupCost,
  PRICE_LABELS,
  runBusinessMonth,
  SECTOR_ECONOMICS,
  SECTOR_LABELS,
  staffCapacity,
  upgradeCost,
  valuation,
  WAGE_LABELS,
  type Business,
  type PriceLevel,
  type Sector,
  type WageLevel,
  formatDate,
  supplyFactor,
  salaryVerified,
  sustainableSalary,
  VERIFIED_DAYS,
} from "@cr/sim";
import { Meter } from "../components/Meter";
import { useGameUi } from "../game/GameContext";

const toCents = (text: string) => Math.round(Number(text.replace(/[^0-9.]/g, "")) * 100) || 0;

function FoundForm() {
  const { game, act } = useGameUi();
  const { fee, minCapital } = foundingCost(game);
  const [name, setName] = useState("");
  const [sector, setSector] = useState<Sector>("hospitality");
  const [capital, setCapital] = useState(String(Math.ceil(minCapital / 100)));
  return (
    <section className="card">
      <h4 className="no-margin">Start a business</h4>
      <p className="muted small">
        Registration costs {formatMoney(fee, true)}. You also put in starting capital (at least{" "}
        {formatMoney(minCapital, true)}), which becomes the business's own money.
      </p>
      <div className="form-grid">
        <label className="field">
          <span>Name</span>
          <input
            className="input"
            value={name}
            maxLength={40}
            placeholder="e.g. Riverside Café"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Sector</span>
          <select
            className="input"
            value={sector}
            onChange={(e) => setSector(e.target.value as Sector)}
          >
            {(Object.keys(SECTOR_ECONOMICS) as Sector[]).map((s) => (
              <option key={s} value={s}>
                {SECTOR_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Starting capital ($)</span>
          <input
            className="input"
            value={capital}
            onChange={(e) => setCapital(e.target.value)}
            inputMode="decimal"
          />
        </label>
      </div>
      <p className="muted small">{SECTOR_ECONOMICS[sector].description}</p>
      <button
        className="btn primary align-start"
        onClick={() =>
          act({ type: "business.found", name, sector, capitalCents: toCents(capital) })
        }
      >
        Found business
      </button>
    </section>
  );
}

function BusinessCard({ b }: { b: Business }) {
  const { game, act } = useGameUi();
  const [money, setMoney] = useState("");
  const [marketing, setMarketing] = useState(String(Math.round(b.marketingCents / 100)));
  const [expandCity, setExpandCity] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<"sell" | "close" | null>(null);
  const last = b.history.at(-1);
  const projection = runBusinessMonth(game, b, false);
  const capacity = staffCapacity(b);
  const manage = activityById("manageBusiness")!;
  const manageBlocked = activityBlocker(game, manage, undefined, b.id);
  const homeCountry = game.geography.cities[b.locations[0]!.cityId]!.countryId;
  const expansionCities = game.geography.cities
    .filter(
      (c) => c.countryId === homeCountry && !c.minor && !b.locations.some((l) => l.cityId === c.id),
    )
    .slice(0, 40);
  const wage = cityCosts(game, b.locations[0]!.cityId).medianWageCents;

  return (
    <section className="card">
      <div className="row between">
        <div>
          <h3>{b.name}</h3>
          <p className="muted small">
            {SECTOR_LABELS[b.sector]} · {b.locations.length} location
            {b.locations.length > 1 ? "s" : ""} · you own {formatPercent(b.playerShare, 0)}
          </p>
        </div>
        <button
          className="btn small primary"
          disabled={!!manageBlocked}
          title={manageBlocked ?? manage.description}
          onClick={() =>
            act({ type: "activity.start", activityId: "manageBusiness", targetId: b.id })
          }
        >
          Work on it (4h)
        </button>
      </div>
      <div className="stat-grid">
        <div className="stat">
          <span className="stat-label">Business cash</span>
          <span className={b.cashCents < 0 ? "stat-value bad-text" : "stat-value"}>
            {formatMoney(b.cashCents, true)}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">Value</span>
          <span className="stat-value">{formatMoney(valuation(b), true)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Last month</span>
          <span className="stat-value">
            {last ? (
              <span className={last.profitCents >= 0 ? "good-text" : "bad-text"}>
                {last.profitCents >= 0 ? "+" : "−"}
                {formatMoney(Math.abs(last.profitCents), true)}
              </span>
            ) : (
              "—"
            )}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">This month (projected)</span>
          <span className={projection.profit >= 0 ? "stat-value good-text" : "stat-value bad-text"}>
            {projection.profit >= 0 ? "+" : "−"}
            {formatMoney(Math.abs(projection.profit), true)}
          </span>
        </div>
      </div>
      <p className="muted small">
        Revenue {formatMoney(projection.revenue, true)} · costs{" "}
        {formatMoney(projection.costs, true)} · market share {formatPercent(projection.share, 0)} ·
        owner hours this month: {b.ownerHours}
      </p>
      <div className="skill-grid">
        <Meter label="Quality" value={b.quality} compact />
        <Meter label="Brand" value={b.brand} compact tone="accent" />
        <Meter label="Staff morale" value={b.morale} compact />
      </div>

      <h4>Staff</h4>
      <div className="row">
        <button
          className="btn small"
          onClick={() =>
            act({
              type: "business.staff",
              businessId: b.id,
              employees: Math.max(0, b.employees - 1),
            })
          }
        >
          −
        </button>
        <span className="mono">
          {b.employees} / {capacity}
        </span>
        <button
          className="btn small"
          onClick={() =>
            act({ type: "business.staff", businessId: b.id, employees: b.employees + 1 })
          }
        >
          +
        </button>
        <select
          className="input small-input wide"
          value={b.wageLevel}
          onChange={(e) =>
            act({
              type: "business.policy",
              businessId: b.id,
              wageLevel: e.target.value as WageLevel,
            })
          }
        >
          {(Object.keys(WAGE_LABELS) as WageLevel[]).map((w) => (
            <option key={w} value={w}>
              Pay: {WAGE_LABELS[w]}
            </option>
          ))}
        </select>
        <select
          className="input small-input wide"
          value={b.priceLevel}
          onChange={(e) =>
            act({
              type: "business.policy",
              businessId: b.id,
              priceLevel: e.target.value as PriceLevel,
            })
          }
        >
          {(Object.keys(PRICE_LABELS) as PriceLevel[]).map((pr) => (
            <option key={pr} value={pr}>
              Prices: {PRICE_LABELS[pr]}
            </option>
          ))}
        </select>
      </div>
      <p className="muted small">
        Hiring costs a week's wages per person; layoffs cost two weeks of severance and hurt morale.
        Local wage: {formatMoney(wage)}/hr.
      </p>
      <div className="row">
        <span className="small">Marketing per month $</span>
        <input
          className="input small-input"
          value={marketing}
          onChange={(e) => setMarketing(e.target.value)}
        />
        <button
          className="btn small"
          onClick={() =>
            act({ type: "business.policy", businessId: b.id, marketingCents: toCents(marketing) })
          }
        >
          Set
        </button>
      </div>

      <h4>Locations</h4>
      <ul className="offer-list">
        {b.locations.map((l, i) => (
          <li key={l.cityId}>
            <span>
              <strong>{game.geography.cities[l.cityId]!.name}</strong>{" "}
              <span className="muted small">
                size {l.size}/5 · room for {l.size * 8} staff
              </span>
            </span>
            <button
              className="btn small"
              disabled={l.size >= 5}
              onClick={() => act({ type: "business.upgrade", businessId: b.id, locationIndex: i })}
            >
              Expand ({formatMoney(upgradeCost(game, b, i), true)})
            </button>
          </li>
        ))}
      </ul>
      <div className="row">
        <select
          className="input"
          value={expandCity ?? ""}
          onChange={(e) => setExpandCity(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">Open a new location in…</option>
          {expansionCities.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({formatMoney(locationSetupCost(game, c.id), true)})
            </option>
          ))}
        </select>
        <button
          className="btn small"
          disabled={expandCity === null}
          onClick={() =>
            expandCity !== null &&
            act({ type: "business.openLocation", businessId: b.id, cityId: expandCity })
          }
        >
          Open
        </button>
      </div>

      <h4>Money</h4>
      <div className="row">
        <input
          className="input small-input"
          placeholder="$"
          value={money}
          onChange={(e) => setMoney(e.target.value)}
          aria-label="Amount"
        />
        <button
          className="btn small"
          onClick={() =>
            act({ type: "business.invest", businessId: b.id, amountCents: toCents(money) })
          }
        >
          Put money in
        </button>
        <button
          className="btn small"
          onClick={() =>
            act({ type: "business.withdraw", businessId: b.id, amountCents: toCents(money) })
          }
        >
          Take money out
        </button>
      </div>
      <OwnerSalary b={b} />
      <div className="row">
        <span className="small">Sell a stake to investors:</span>
        {[5, 10, 20].map((pct) => (
          <button
            key={pct}
            className="btn small"
            onClick={() => act({ type: "business.raise", businessId: b.id, sharePercent: pct })}
          >
            {pct}% ({formatMoney(Math.round(valuation(b) * (pct / 100)), true)})
          </button>
        ))}
      </div>
      <p className="muted small">
        {b.listed ? "Listed on the stock market. " : ""}
        {b.contract && b.contract.until > game.time
          ? `Government contract with ${b.contract.agency}: ${formatMoney(b.contract.monthlyCents, true)}/month until ${formatDate(b.contract.until)}. `
          : ""}
        Material costs are {Math.round(supplyFactor(game, b) * 100)}% of normal here.
      </p>
      {!b.listed && (
        <button
          className="btn small"
          title="Needs 2+ locations, a year of results and a value of $2M+"
          onClick={() => act({ type: "business.ipo", businessId: b.id })}
        >
          Go public (sell 25% on the stock market)
        </button>
      )}
      <div className="row">
        {confirm ? (
          <>
            <span className="small">
              {confirm === "sell"
                ? `Sell for ${formatMoney(Math.round(valuation(b) * b.playerShare), true)}?`
                : "Close the business?"}
            </span>
            <button
              className="btn small danger"
              onClick={() =>
                act({
                  type: confirm === "sell" ? "business.sell" : "business.close",
                  businessId: b.id,
                })
              }
            >
              Yes
            </button>
            <button className="btn small" onClick={() => setConfirm(null)}>
              No
            </button>
          </>
        ) : (
          <>
            <button className="btn small" onClick={() => setConfirm("sell")}>
              Sell business
            </button>
            <button className="btn small danger" onClick={() => setConfirm("close")}>
              Close business
            </button>
          </>
        )}
      </div>
      {b.history.length > 0 && (
        <>
          <h4>History</h4>
          <div className="spark">
            {b.history.slice(-12).map((m, i) => {
              const max = Math.max(1, ...b.history.slice(-12).map((x) => Math.abs(x.profitCents)));
              const h = (Math.abs(m.profitCents) / max) * 100;
              return (
                <i
                  key={i}
                  title={formatMoney(m.profitCents, true)}
                  className={m.profitCents >= 0 ? "pos" : "neg"}
                  style={{ height: `${Math.max(4, h)}%` }}
                />
              );
            })}
          </div>
          <p className="muted small">
            Monthly profit, last {Math.min(12, b.history.length)} months
          </p>
        </>
      )}
    </section>
  );
}

/** The owner's salary: steady pay that landlords and banks count as income after 14 days. */
function OwnerSalary({ b }: { b: Business }) {
  const { game, act } = useGameUi();
  const [salary, setSalary] = useState("");
  const current = b.ownerSalaryCents ?? 0;
  const steady = salaryVerified(game, b);
  const daysLeft =
    b.salaryPaidSince != null
      ? Math.max(0, Math.ceil(VERIFIED_DAYS - (game.time - b.salaryPaidSince) / 24))
      : VERIFIED_DAYS;
  const affordable = sustainableSalary(b);
  return (
    <>
      <div className="row wrap">
        <span className="small">
          Your salary: <strong>{formatMoney(current, true)}/month</strong>
        </span>
        <input
          className="input small-input"
          placeholder="$ per month"
          value={salary}
          onChange={(e) => setSalary(e.target.value)}
          aria-label="Monthly salary"
        />
        <button
          className="btn small"
          onClick={() =>
            act({ type: "business.salary", businessId: b.id, monthlyCents: toCents(salary) })
          }
        >
          Set salary
        </button>
      </div>
      <p className="muted small">
        Paid every Friday from the business, taxed like wages.{" "}
        {current === 0
          ? `Pay yourself to have income landlords and banks accept: it counts after ${VERIFIED_DAYS} days of steady pay.`
          : steady
            ? `Counts as income: ${formatMoney(Math.min(current, affordable), true)}/month${current > affordable ? " (what the business can really afford)" : ""}.`
            : `Counts as income in ${daysLeft} day${daysLeft === 1 ? "" : "s"}, if every payday goes through.`}
      </p>
    </>
  );
}

export function BusinessPanel() {
  const { game } = useGameUi();
  const active = activeBusinesses(game);
  const past = game.state.businesses.filter((b) => b.status !== "active");
  return (
    <div className="panel-stack">
      {active.map((b) => (
        <BusinessCard key={b.id} b={b} />
      ))}
      {active.length < 5 && <FoundForm />}
      {past.length > 0 && (
        <section className="card">
          <h4 className="no-margin">Past businesses</h4>
          <ul className="offer-list">
            {past.map((b) => (
              <li key={b.id}>
                <span>
                  {b.name}{" "}
                  <span className="muted small">
                    {b.status === "bankrupt" ? "went bankrupt" : "closed or sold"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
