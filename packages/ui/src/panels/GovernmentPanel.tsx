import {
  budgetOf,
  countryName,
  formatCompact,
  formatDate,
  formatMoney,
  formatPercent,
  GOVERNMENT_LABELS,
  isDemocratic,
  isPresidential,
  snapshot,
  type CountrySnapshot,
  type Game,
} from "@cr/sim";
import { Meter } from "../components/Meter";
import { useGameUi } from "../game/GameContext";

const YEAR = 365 * 24;

interface Stat {
  label: string;
  now: string;
  change: string;
  /** +1 if the change is good news, -1 if bad, 0 if neutral. */
  tone: number;
}

function signed(n: number, format: (v: number) => string): string {
  return `${n > 0 ? "+" : n < 0 ? "−" : "±"}${format(Math.abs(n))}`;
}

/** The country now, compared with the day the player took office. */
export function recordStats(start: CountrySnapshot, now: CountrySnapshot): Stat[] {
  const pct = (v: number) => formatPercent(v, 1);
  const pts = (v: number) => `${v.toFixed(1)} pts`;
  const gdp = start.gdpPerCapita > 0 ? now.gdpPerCapita / start.gdpPerCapita - 1 : 0;
  return [
    {
      label: "GDP per person",
      now: formatMoney(now.gdpPerCapita * 100, true),
      change: signed(gdp, pct),
      tone: Math.sign(gdp),
    },
    {
      label: "Population",
      now: formatCompact(now.population),
      change: signed(now.population - start.population, formatCompact),
      tone: 0,
    },
    {
      label: "Unemployment",
      now: formatPercent(now.unemployment, 1),
      change: signed((now.unemployment - start.unemployment) * 100, pts),
      tone: -Math.sign(now.unemployment - start.unemployment),
    },
    {
      label: "Inflation",
      now: formatPercent(now.inflation, 1),
      change: signed((now.inflation - start.inflation) * 100, pts),
      tone: -Math.sign(now.inflation - start.inflation),
    },
    {
      label: "Stability",
      now: String(Math.round(now.stability)),
      change: signed(Math.round(now.stability - start.stability), String),
      tone: Math.sign(now.stability - start.stability),
    },
    {
      label: "Public debt",
      now: formatMoney(now.debtCents, true),
      change: signed(now.debtCents - start.debtCents, (v) => formatMoney(v, true)),
      tone: -Math.sign(now.debtCents - start.debtCents),
    },
    {
      label: "Regions",
      now: String(now.provinces),
      change: signed(now.provinces - start.provinces, String),
      tone: Math.sign(now.provinces - start.provinces),
    },
  ];
}

export function RecordTable({ stats }: { stats: Stat[] }) {
  return (
    <ul className="gov-list">
      {stats.map((s) => (
        <li key={s.label}>
          <span>{s.label}</span>
          <span className="small">
            <strong>{s.now}</strong>{" "}
            <span className={s.tone > 0 ? "good-text" : s.tone < 0 ? "warn-text" : "muted"}>
              {s.change}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** How the player's hold on power is tested in this kind of state. */
function threats(game: Game, countryId: string): string {
  const country = game.state.world.countries[countryId]!;
  const offices = game.state.politics.offices;
  if (!isDemocratic(country.government)) {
    return "There are no real elections here. Keep the country stable: unrest breeds uprisings, and an uprising that takes the country ends your rule.";
  }
  if (isPresidential(country)) {
    const head = offices.find((o) => o.kind === "headOfGovernment" && o.countryId === countryId);
    return head?.nextElection
      ? `You face the voters on ${formatDate(head.nextElection)}. Your approval decides it.`
      : "You face the voters at the next presidential election.";
  }
  const legislature = offices.find((o) => o.kind === "legislator" && o.countryId === countryId);
  return `You govern as long as your party leads the legislature${legislature?.nextElection ? `; the next election is on ${formatDate(legislature.nextElection)}` : ""}. Your approval lifts or sinks your party.`;
}

export function GovernmentPanel() {
  const { game } = useGameUi();
  const reign = game.state.reign;
  if (!reign) return null;
  const s = game.state;
  const countryId = reign.countryId;
  const country = s.world.countries[countryId];
  const head = s.politics.offices.find(
    (o) => o.kind === "headOfGovernment" && o.countryId === countryId,
  );
  const party = country?.parties.find((p) => p.id === s.player.politics.partyId);
  const years = ((reign.endedAt ?? s.time) - reign.startedAt) / YEAR;
  const budget = country ? budgetOf(country) : null;
  const balance = budget ? budget.revenueCents - budget.spendingCents : 0;
  const annualGdp = country ? country.gdpPerCapita * 100 * country.population : 0;

  return (
    <div className="panel-stack">
      <section className="card highlight">
        <h4 className="no-margin">{head?.title ?? `Leader of ${countryName(game, countryId)}`}</h4>
        <p className="muted small">
          {country && GOVERNMENT_LABELS[country.government]}
          {party && ` · ${party.name} (${formatPercent(party.popularity, 0)} support)`} · in office{" "}
          {years < 1
            ? `${Math.max(0, Math.floor(years * 12))} months`
            : `${years.toFixed(1)} years`}
        </p>
        <Meter label="Public approval" value={s.player.politics.approval} />
        <p className="small">{threats(game, countryId)}</p>
      </section>

      {country && (
        <section className="card">
          <h4 className="no-margin">The country since you took office</h4>
          <RecordTable stats={recordStats(reign.start, snapshot(game, countryId))} />
        </section>
      )}

      {budget && (
        <section className="card">
          <h4 className="no-margin">Public finances (monthly)</h4>
          <ul className="gov-list">
            <li>
              <span>Revenue</span>
              <span className="small">{formatMoney(budget.revenueCents, true)}</span>
            </li>
            <li>
              <span>Spending</span>
              <span className="small">{formatMoney(budget.spendingCents, true)}</span>
            </li>
            <li>
              <span>{balance >= 0 ? "Surplus" : "Deficit"}</span>
              <span className={balance >= 0 ? "small good-text" : "small warn-text"}>
                {formatMoney(Math.abs(balance), true)}
              </span>
            </li>
            <li>
              <span>Debt</span>
              <span className="small">
                {formatMoney(budget.debtCents, true)}
                {annualGdp > 0 && ` (${formatPercent(budget.debtCents / annualGdp, 0)} of GDP)`}
              </span>
            </li>
          </ul>
          <p className="muted small">
            Change taxes and spending through laws in the Politics tab. Defense spending, diplomacy
            and war are in the Military tab.
          </p>
        </section>
      )}
    </div>
  );
}
