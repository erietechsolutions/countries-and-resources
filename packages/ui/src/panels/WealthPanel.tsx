import { useState } from "react";
import {
  bondYield,
  capitalGainsRate,
  COMMODITIES,
  commodityPrice,
  countryName,
  countryOf,
  donationMinimum,
  formatMoney,
  formatPercent,
  holdingValue,
  investmentLabel,
  lobbyingCost,
  mediaPrice,
  mortgageRate,
  netWorth,
  policiesForLevel,
  propertyLabel,
  PROPERTY_KINDS,
  propertyPrice,
  propertyRent,
  propertyValue,
  RESOURCE_LABELS,
  richListRank,
  savingsRate,
  stockIndex,
  unitPrice,
  type Game,
  type HoldingKind,
  type Resource,
} from "@cr/sim";
import { useGameUi } from "../game/GameContext";

const toCents = (t: string) => Math.round(Number(t.replace(/[^0-9.]/g, "")) * 100) || 0;

function change(game: Game, key: string) {
  const c = game.state.markets.lastChange[key] ?? 0;
  return (
    <span className={c > 0 ? "good-text" : c < 0 ? "warn-text" : "muted"}>
      {c >= 0 ? "+" : ""}
      {formatPercent(c, 1)}
    </span>
  );
}

function NetWorthCard() {
  const { game } = useGameUi();
  const w = netWorth(game);
  const rank = richListRank(game);
  const top = game.state.markets.richList.slice(0, 3);
  const rows: [string, number][] = [
    ["Cash", w.cash],
    ["Savings", w.savings],
    ["Offshore", w.offshore],
    ["Investments", w.investments],
    ["Property (equity)", w.property],
    ["Businesses (your share)", w.businesses],
    ["Media", w.media],
    ["Debts", -w.debts],
  ];
  return (
    <section className="card highlight">
      <div className="row between">
        <h4 className="no-margin">Net worth</h4>
        <strong>{formatMoney(w.total, true)}</strong>
      </div>
      <ul className="gov-list">
        {rows
          .filter(([, v]) => v !== 0)
          .map(([label, v]) => (
            <li key={label}>
              <span>{label}</span>
              <span className="small">{formatMoney(v, true)}</span>
            </li>
          ))}
      </ul>
      {top.length > 0 && (
        <p className="muted small">
          {rank
            ? `You are #${rank} on the world's rich list.`
            : `The world's richest: ${top.map((t) => `${t.name} (${formatMoney(t.netWorthCents, true)})`).join(", ")}.`}
        </p>
      )}
    </section>
  );
}

function AccountsCard() {
  const { game, act } = useGameUi();
  const w = game.state.wealth;
  const [amount, setAmount] = useState("");
  const cents = toCents(amount);
  return (
    <section className="card">
      <h4 className="no-margin">Accounts</h4>
      <ul className="gov-list">
        <li>
          <span>
            Savings <span className="muted small">{formatPercent(savingsRate(game), 1)}/yr</span>
          </span>
          <span className="small">{formatMoney(w.savingsCents, true)}</span>
        </li>
        <li>
          <span>
            Offshore <span className="muted small">2%/yr, untaxed, a secret</span>
          </span>
          <span className="small">{formatMoney(w.offshoreCents, true)}</span>
        </li>
      </ul>
      <div className="row wrap">
        <input
          className="input small-input"
          placeholder="$"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          aria-label="Amount"
        />
        <button
          className="btn small"
          onClick={() => act({ type: "savings.move", amountCents: cents })}
        >
          Save
        </button>
        <button
          className="btn small"
          onClick={() => act({ type: "savings.move", amountCents: -cents })}
        >
          Withdraw
        </button>
        <button
          className="btn small danger"
          title="Hidden from taxes and courts, but moving money offshore is fraud if it comes out."
          onClick={() => act({ type: "offshore.move", amountCents: cents })}
        >
          Move offshore
        </button>
        <button
          className="btn small"
          onClick={() => act({ type: "offshore.move", amountCents: -cents })}
        >
          Bring home
        </button>
      </div>
    </section>
  );
}

/** The player's country first, then the world's biggest economies. */
function marketCountries(game: Game): string[] {
  const home = countryOf(game, game.state.player.cityId).id;
  const big = Object.values(game.state.world.countries)
    .filter((c) => c.population > 0 && c.id !== home)
    .sort((a, b) => b.gdpPerCapita * b.population - a.gdpPerCapita * a.population)
    .slice(0, 9)
    .map((c) => c.id);
  return [home, ...big];
}

function MarketsCard() {
  const { game, act } = useGameUi();
  const [kind, setKind] = useState<HoldingKind>("stocks");
  const [amount, setAmount] = useState("1000");
  const cents = toCents(amount);
  const holdings = game.state.wealth.holdings;
  const targets: string[] = kind === "commodity" ? COMMODITIES : marketCountries(game);
  return (
    <section className="card">
      <h4 className="no-margin">Markets</h4>
      <div className="row wrap">
        {(["stocks", "bonds", "commodity"] as HoldingKind[]).map((k) => (
          <button
            key={k}
            className={kind === k ? "chip active" : "chip"}
            onClick={() => setKind(k)}
          >
            {k === "stocks" ? "Stocks" : k === "bonds" ? "Government bonds" : "Commodities"}
          </button>
        ))}
        <input
          className="input small-input"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          aria-label="Amount to invest"
        />
      </div>
      <ul className="offer-list">
        {targets.map((t) => (
          <li key={t}>
            <div>
              <strong>
                {kind === "commodity" ? RESOURCE_LABELS[t as Resource] : countryName(game, t)}
              </strong>
              <div className="muted small">
                {kind === "stocks" && (
                  <>
                    Index {stockIndex(game, t).toFixed(1)} · {change(game, t)} last month
                  </>
                )}
                {kind === "bonds" && (
                  <>Yield {formatPercent(bondYield(game.state.world.countries[t]!), 1)} a year</>
                )}
                {kind === "commodity" && (
                  <>
                    {formatMoney(unitPrice(game, "commodity", t), true)}/unit · {change(game, t)} ·{" "}
                    {Math.round(commodityPrice(game, t as Resource) * 100)}% of normal
                  </>
                )}
              </div>
            </div>
            <button
              className="btn small"
              onClick={() => act({ type: "invest.buy", kind, target: t, amountCents: cents })}
            >
              Buy
            </button>
          </li>
        ))}
      </ul>
      {holdings.length > 0 && (
        <>
          <h4>Your holdings</h4>
          <ul className="offer-list">
            {holdings.map((h) => {
              const value = holdingValue(game, h);
              const gain = value - h.costCents;
              return (
                <li key={h.id}>
                  <div>
                    <strong>{investmentLabel(game, h.kind, h.target)}</strong>
                    <div className="small">
                      {formatMoney(value, true)}{" "}
                      <span className={gain >= 0 ? "good-text" : "warn-text"}>
                        ({gain >= 0 ? "+" : ""}
                        {formatMoney(gain, true)})
                      </span>
                    </div>
                  </div>
                  <div className="row">
                    <button
                      className="btn small"
                      onClick={() => act({ type: "invest.sell", holdingId: h.id, fraction: 0.5 })}
                    >
                      Sell half
                    </button>
                    <button
                      className="btn small"
                      onClick={() => act({ type: "invest.sell", holdingId: h.id, fraction: 1 })}
                    >
                      Sell all
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="muted small">
            Gains are taxed at {formatPercent(capitalGainsRate(game), 0)} when you sell.
          </p>
        </>
      )}
    </section>
  );
}

function PropertyCard() {
  const { game, act } = useGameUi();
  const [mortgage, setMortgage] = useState(true);
  const p = game.state.player;
  const city = game.geography.cities[p.cityId]!;
  const props = game.state.wealth.properties;
  return (
    <section className="card">
      <h4 className="no-margin">Real estate</h4>
      <p className="muted small">
        For sale in {city.name}. Mortgages need 20% down and income of 2.5× the payment (
        {formatPercent(mortgageRate(game), 1)} a year).
      </p>
      <label className="row small">
        <input type="checkbox" checked={mortgage} onChange={(e) => setMortgage(e.target.checked)} />
        Buy with a mortgage
      </label>
      <ul className="offer-list">
        {PROPERTY_KINDS.map((kind) => (
          <li key={kind}>
            <div>
              <strong>{propertyLabel(kind)}</strong>
              <div className="muted small">
                {formatMoney(propertyPrice(game, p.cityId, kind), true)}
              </div>
            </div>
            <button
              className="btn small"
              onClick={() => act({ type: "property.buy", cityId: p.cityId, kind, mortgage })}
            >
              Buy
            </button>
          </li>
        ))}
      </ul>
      {props.length > 0 && (
        <>
          <h4>Your properties</h4>
          <ul className="offer-list">
            {props.map((x) => {
              const home = p.housing.kind === "owned" && p.housing.propertyId === x.id;
              return (
                <li key={x.id}>
                  <div>
                    <strong>
                      {propertyLabel(x.kind)} in {game.geography.cities[x.cityId]?.name}
                    </strong>
                    <div className="muted small">
                      Worth {formatMoney(propertyValue(game, x), true)}
                      {x.mortgage && ` · owes ${formatMoney(x.mortgage.balanceCents, true)}`}
                      {home
                        ? " · your home"
                        : x.rentedOut
                          ? x.vacant
                            ? " · empty this month"
                            : ` · rent ${formatMoney(propertyRent(game, x), true)}/mo`
                          : " · empty"}
                    </div>
                  </div>
                  <div className="row wrap">
                    {!home && x.kind !== "commercial" && x.cityId === p.cityId && (
                      <button
                        className="btn small"
                        onClick={() => act({ type: "property.moveIn", propertyId: x.id })}
                      >
                        Move in
                      </button>
                    )}
                    {!home && (
                      <button
                        className="btn small"
                        onClick={() =>
                          act({ type: "property.rentOut", propertyId: x.id, rentOut: !x.rentedOut })
                        }
                      >
                        {x.rentedOut ? "Stop renting" : "Rent out"}
                      </button>
                    )}
                    {!x.renovated && (
                      <button
                        className="btn small"
                        onClick={() => act({ type: "property.renovate", propertyId: x.id })}
                      >
                        Renovate
                      </button>
                    )}
                    <button
                      className="btn small"
                      onClick={() => act({ type: "property.sell", propertyId: x.id })}
                    >
                      Sell
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

function InfluenceCard() {
  const { game, act } = useGameUi();
  const country = countryOf(game, game.state.player.cityId);
  const parties = country.parties;
  const [partyId, setPartyId] = useState(parties[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const policies = policiesForLevel("national");
  const [policyId, setPolicyId] = useState(policies[0]?.id ?? "");
  const scope = `national:${country.id}`;
  const media = game.state.wealth.media;
  return (
    <section className="card">
      <h4 className="no-margin">Influence</h4>
      {parties.length > 0 && (
        <>
          <p className="muted small">
            Donate to a party (from {formatMoney(donationMinimum(game), true)}): it lifts their
            support and your standing with them.
          </p>
          <div className="row wrap">
            <select className="input" value={partyId} onChange={(e) => setPartyId(e.target.value)}>
              {parties.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
            <input
              className="input small-input"
              placeholder="$"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-label="Donation"
            />
            <button
              className="btn small"
              onClick={() =>
                act({ type: "influence.donate", partyId, amountCents: toCents(amount) })
              }
            >
              Donate
            </button>
          </div>
        </>
      )}
      <p className="muted small">
        Hire lobbyists ({formatMoney(lobbyingCost(game), true)}) to get a bill put to a vote in the
        national legislature. They can't guarantee it passes.
      </p>
      <div className="row wrap">
        <select className="input" value={policyId} onChange={(e) => setPolicyId(e.target.value)}>
          {policies.map((x) => (
            <option key={x.id} value={x.id}>
              {x.label}: {x.format(x.get(game, scope))}
            </option>
          ))}
        </select>
        <button
          className="btn small"
          onClick={() => act({ type: "influence.lobby", policyId, direction: 1 })}
        >
          Raise
        </button>
        <button
          className="btn small"
          onClick={() => act({ type: "influence.lobby", policyId, direction: -1 })}
        >
          Lower
        </button>
      </div>
      <h4>Media</h4>
      {media.map((m) => (
        <div key={m.id} className="row wrap">
          <strong>{m.name}</strong>
          <select
            className="input"
            value={m.partyId ?? ""}
            onChange={(e) =>
              act({ type: "media.line", outletId: m.id, partyId: e.target.value || null })
            }
            aria-label="Editorial line"
          >
            <option value="">Neutral coverage</option>
            {(game.state.world.countries[m.countryId]?.parties ?? []).map((x) => (
              <option key={x.id} value={x.id}>
                Backs the {x.name}
              </option>
            ))}
          </select>
          <button className="btn small" onClick={() => act({ type: "media.sell", outletId: m.id })}>
            Sell
          </button>
        </div>
      ))}
      <button className="btn small" onClick={() => act({ type: "media.buy" })}>
        Buy a media outlet ({formatMoney(mediaPrice(game), true)})
      </button>
    </section>
  );
}

export function WealthPanel() {
  return (
    <div className="panel-stack">
      <NetWorthCard />
      <AccountsCard />
      <MarketsCard />
      <PropertyCard />
      <InfluenceCard />
    </div>
  );
}
