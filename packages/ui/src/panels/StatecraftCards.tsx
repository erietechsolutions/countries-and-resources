import { useState } from "react";
import {
  BUDGET_AREAS,
  BUDGET_LEVELS,
  coupRisk,
  creditRating,
  formatCompact,
  formatDate,
  formatMoney,
  formatPercent,
  interestRate,
  militaryOf,
  PROJECTS,
  projectCost,
  readStatecraft,
  unitCost,
  type Branch,
  type CountryId,
  type GovernmentAction,
  type ProjectKind,
} from "@cr/sim";
import { Meter } from "../components/Meter";
import { useGameUi } from "../game/GameContext";

function useGov() {
  const { game, act } = useGameUi();
  return { game, gov: (action: GovernmentAction) => act({ type: "gov.action", action }) };
}

export function BudgetCard({ countryId }: { countryId: CountryId }) {
  const { game, gov } = useGov();
  const c = game.state.world.countries[countryId]!;
  const s = readStatecraft(c);
  return (
    <section className="card">
      <h4 className="no-margin">Budget priorities</h4>
      <p className="muted small">
        Credit rating <strong>{creditRating(c)}</strong> · borrowing at{" "}
        {formatPercent(c.statecraft ? interestRate(c) : 0.03, 1)} a year. Spending above normal adds
        to the deficit.
      </p>
      {BUDGET_AREAS.map((area) => (
        <div key={area.id} className="budget-row" title={area.description}>
          <span className="small">{area.label}</span>
          <div className="row wrap">
            {BUDGET_LEVELS.map((level) => (
              <button
                key={level}
                className={s.budget[area.id] === level ? "chip active" : "chip"}
                onClick={() => gov({ kind: "budget", area: area.id, level })}
              >
                {Math.round(level * 200)}%
              </button>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

export function ProjectsCard({ countryId }: { countryId: CountryId }) {
  const { game, gov } = useGov();
  const c = game.state.world.countries[countryId]!;
  const s = readStatecraft(c);
  const regions = (game.geography.countries.find((x) => x.id === countryId)?.provinceIds ?? [])
    .map((id) => game.geography.provinces[id]!)
    .sort(
      (a, b) =>
        (game.state.world.provinces[b.id]?.population ?? 0) -
        (game.state.world.provinces[a.id]?.population ?? 0),
    );
  const [kind, setKind] = useState<ProjectKind>("railway");
  const [provinceId, setProvinceId] = useState(regions[0]?.id ?? 0);
  return (
    <section className="card">
      <h4 className="no-margin">Big projects</h4>
      {s.projects.length > 0 && (
        <ul className="gov-list">
          {s.projects.map((p) => {
            const done = (game.time - p.startedAt) / Math.max(1, p.doneAt - p.startedAt);
            return (
              <li key={p.id}>
                <span>
                  {PROJECTS[p.kind].label}{" "}
                  <span className="muted small">
                    {game.geography.provinces[p.provinceId]?.name}
                  </span>
                </span>
                <span className="small">
                  {Math.round(Math.min(1, done) * 100)}% · {formatDate(p.doneAt)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <div className="row wrap">
        <select
          className="input"
          value={kind}
          onChange={(e) => setKind(e.target.value as ProjectKind)}
        >
          {(Object.keys(PROJECTS) as ProjectKind[]).map((k) => (
            <option key={k} value={k}>
              {PROJECTS[k].label}
            </option>
          ))}
        </select>
        <select
          className="input"
          value={provinceId}
          onChange={(e) => setProvinceId(Number(e.target.value))}
          aria-label="Region"
        >
          {regions.slice(0, 60).map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
              {r.coastal ? " (coast)" : ""}
            </option>
          ))}
        </select>
        <button
          className="btn small"
          onClick={() => gov({ kind: "project", project: kind, provinceId })}
        >
          Start ({formatMoney(projectCost(c, kind), true)})
        </button>
      </div>
      <p className="muted small">
        {PROJECTS[kind].description} Takes {PROJECTS[kind].months} months.
      </p>
    </section>
  );
}

export function EconomyPolicyCard({ countryId }: { countryId: CountryId }) {
  const { game, gov } = useGov();
  const s = readStatecraft(game.state.world.countries[countryId]!);
  return (
    <section className="card">
      <h4 className="no-margin">Economic policy</h4>
      <div className="row between">
        <span className="small">
          State ownership of industry: <strong>{Math.round(s.stateOwnership * 100)}%</strong>
        </span>
        <div className="row">
          <button className="btn small" onClick={() => gov({ kind: "ownership", direction: 1 })}>
            Nationalize
          </button>
          <button className="btn small" onClick={() => gov({ kind: "ownership", direction: -1 })}>
            Privatize
          </button>
        </div>
      </div>
      <p className="muted small">
        Nationalizing raises revenue but slows growth and angers the rich; privatizing pays down
        debt and speeds growth, at the cost of the poor.
      </p>
      <div className="row wrap">
        <span className="small">Tariffs</span>
        {[0, 0.1, 0.2, 0.3, 0.4].map((level) => (
          <button
            key={level}
            className={s.tariff === level ? "chip active" : "chip"}
            onClick={() => gov({ kind: "tariff", level })}
          >
            {Math.round(level * 100)}%
          </button>
        ))}
      </div>
      <p className="muted small">
        Tariffs raise money and protect industry, but slow growth and raise prices.
      </p>
    </section>
  );
}

const BRANCHES: { id: Branch; label: string; step: number }[] = [
  { id: "armor", label: "Armored vehicles", step: 25 },
  { id: "air", label: "Combat aircraft", step: 5 },
  { id: "navy", label: "Warships", step: 1 },
];

export function ForcesCard({ countryId }: { countryId: CountryId }) {
  const { game, gov } = useGov();
  const c = game.state.world.countries[countryId]!;
  const m = militaryOf(c);
  const generals = m.generals ?? [];
  const risk = coupRisk(game, c);
  return (
    <section className="card">
      <h4 className="no-margin">Armed forces</h4>
      <ul className="gov-list">
        <li>
          <span>Troops</span>
          <span className="small">
            {formatCompact(m.troops)}
            {m.conscription ? " (conscripts)" : " (volunteers)"}
          </span>
        </li>
        {BRANCHES.map((b) => (
          <li key={b.id}>
            <span>
              {b.label} <strong>{formatCompact(m[b.id] ?? 0)}</strong>
            </span>
            <span className="row">
              <button
                className="btn small"
                title={`${formatMoney(unitCost(c, b.id), true)} each`}
                onClick={() => gov({ kind: "procure", branch: b.id, count: b.step })}
              >
                +{b.step} ({formatMoney(unitCost(c, b.id) * b.step, true)})
              </button>
              <button
                className="btn small"
                onClick={() => gov({ kind: "procure", branch: b.id, count: -b.step })}
              >
                −{b.step}
              </button>
            </span>
          </li>
        ))}
      </ul>
      <Meter label="Military technology" value={(m.tech ?? 0) * 100} compact tone="accent" />
      <div className="row wrap">
        <span className="small">Research</span>
        {[0, 0.25, 0.5, 0.75, 1].map((level) => (
          <button
            key={level}
            className={(m.research ?? 0) === level ? "chip active" : "chip"}
            onClick={() => gov({ kind: "research", level })}
          >
            {Math.round(level * 100)}%
          </button>
        ))}
      </div>
      <div className="row between">
        <span className="small">
          {m.conscription ? "Conscription is in force." : "The army is all volunteers."}
        </span>
        <button
          className="btn small"
          onClick={() => gov({ kind: "conscription", on: !m.conscription })}
        >
          {m.conscription ? "End the draft" : "Introduce conscription"}
        </button>
      </div>
      {generals.length > 0 && (
        <>
          <h4>Generals</h4>
          <ul className="offer-list">
            {generals.map((g, i) => (
              <li key={g.name}>
                <div>
                  <strong>{g.name}</strong>
                  <div className="muted small">
                    Skill {Math.round(g.skill * 100)} · loyalty{" "}
                    <span className={g.loyalty < 35 ? "warn-text" : undefined}>
                      {Math.round(g.loyalty)}
                    </span>
                  </div>
                </div>
                <div className="row">
                  <button
                    className="btn small"
                    onClick={() => gov({ kind: "general", index: i, action: "reward" })}
                  >
                    Reward
                  </button>
                  <button
                    className="btn small"
                    onClick={() => gov({ kind: "general", index: i, action: "dismiss" })}
                  >
                    Dismiss
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {risk > 0 && (
            <p className="warn-text small">
              Coup risk this month: {formatPercent(risk, 0)}. Reward or replace disloyal generals,
              and keep the country stable.
            </p>
          )}
        </>
      )}
    </section>
  );
}
