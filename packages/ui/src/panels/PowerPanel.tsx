import { useState } from "react";
import {
  activeWars,
  allied,
  attackCost,
  attackTargets,
  counterforcePower,
  countryName,
  equipmentGain,
  fighterUpkeep,
  formatCompact,
  formatDate,
  formatMoney,
  formatPercent,
  FOUNDABLE_GOVERNMENTS,
  GOVERNMENT_LABELS,
  landNeighbors,
  militaryOf,
  militiaBlocker,
  militiaFoundingCost,
  militiaIndependenceRequirements,
  militiaPower,
  ORDER_DESCRIPTIONS,
  ORDER_LABELS,
  playerOffices,
  playerRuledCountry,
  recruitCost,
  referendumBlocker,
  referendumSupport,
  relation,
  sideOf,
  warBetween,
  warsOf,
  winChance,
  type CountryId,
  type GovernmentType,
  type MilitiaOrders,
  type War,
  borderProvinces,
  hasPact,
  hasTradeDeal,
  militaryRank,
  sanctions,
  SPY_OPS,
  spyOdds,
  spyOpCost,
  WAR_GOAL_LABELS,
  type GovernmentAction,
  type SpyOp,
  type WarGoal,
  type WarStance,
} from "@cr/sim";
import { Meter } from "../components/Meter";
import { useGameUi } from "../game/GameContext";
import { ForcesCard } from "./StatecraftCards";

const toCents = (t: string) => Math.round(Number(t.replace(/[^0-9.]/g, "")) * 100) || 0;

function MilitiaCard() {
  const { game, act } = useGameUi();
  const m = game.state.conflict.militia;
  const [name, setName] = useState("");
  const [count, setCount] = useState("10");
  const [arms, setArms] = useState("");
  const [lead, setLead] = useState(false);

  if (!m) {
    const blocker = militiaBlocker(game);
    return (
      <section className="card">
        <h4 className="no-margin">Militia</h4>
        <p className="muted small">
          Take up arms against the government: recruit fighters, seize regions, and hold them long
          enough to declare a country of your own. Insurrection is the most serious crime there is.
        </p>
        {blocker && <p className="warn-text small">{blocker}</p>}
        <div className="row">
          <input
            className="input"
            placeholder="Militia name"
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            className="btn small danger"
            disabled={!!blocker}
            onClick={() => act({ type: "militia.found", name })}
          >
            Raise ({formatMoney(militiaFoundingCost(game), true)})
          </button>
        </div>
      </section>
    );
  }

  const targets = attackTargets(game);
  const geo = game.geography;
  const gain = equipmentGain(game, m, toCents(arms));
  return (
    <section className="card">
      <div className="row between">
        <h4 className="no-margin">{m.name}</h4>
        <span className="tag">{formatCompact(m.fighters)} fighters</span>
      </div>
      <Meter label="Equipment" value={m.equipment} compact tone="accent" />
      <Meter label="Training" value={m.training} compact tone="accent" />
      <Meter label="Morale" value={m.morale} compact />
      <Meter label="Government crackdown" value={m.crackdown} compact tone="inverse" />
      <p className="muted small">
        Pay: {formatMoney(fighterUpkeep(game) * m.fighters, true)}/month. Fighting strength{" "}
        {formatCompact(Math.round(militiaPower(m)))}.
      </p>

      <h4>Holding</h4>
      {m.held.length === 0 ? (
        <p className="muted small">
          No territory yet. Start with {geo.provinces[m.baseProvinceId]!.name}.
        </p>
      ) : (
        <ul className="gov-list">
          {m.held.map((h) => (
            <li key={h.provinceId}>
              <span>{geo.provinces[h.provinceId]!.name}</span>
              <span className="muted small">since {formatDate(h.since)}</span>
            </li>
          ))}
        </ul>
      )}

      <h4>Orders</h4>
      <div className="row wrap">
        {(Object.keys(ORDER_LABELS) as MilitiaOrders[]).map((o) => (
          <button
            key={o}
            className={m.orders === o ? "chip active" : "chip"}
            title={ORDER_DESCRIPTIONS[o]}
            onClick={() => act({ type: "militia.orders", orders: o })}
          >
            {ORDER_LABELS[o]}
          </button>
        ))}
      </div>
      <p className="muted small">{ORDER_DESCRIPTIONS[m.orders]}</p>

      <h4>Strength</h4>
      <div className="row">
        <input
          className="input small-input"
          value={count}
          onChange={(e) => setCount(e.target.value)}
          aria-label="Recruits"
        />
        <button
          className="btn small"
          disabled={m.recruitsLeft <= 0}
          onClick={() => act({ type: "militia.recruit", count: Number(count) || 0 })}
        >
          Recruit ({formatMoney(recruitCost(game), true)} each)
        </button>
        <span className="muted small">{m.recruitsLeft} willing this month</span>
      </div>
      <div className="row">
        <input
          className="input small-input"
          placeholder="$"
          value={arms}
          onChange={(e) => setArms(e.target.value)}
          aria-label="Weapons budget"
        />
        <button
          className="btn small"
          onClick={() => act({ type: "militia.arm", amountCents: toCents(arms) })}
        >
          Buy weapons
        </button>
        {gain > 0 && <span className="muted small">+{gain} equipment</span>}
      </div>

      <h4>Attack</h4>
      {m.operation ? (
        <p className="small">
          Moving on {geo.provinces[m.operation.provinceId]!.name}
          {m.operation.lead && ", with you at the front"}. Decided on{" "}
          {formatDate(m.operation.resolveAt)}.
        </p>
      ) : targets.length === 0 ? (
        <p className="muted small">No regions within reach.</p>
      ) : (
        <>
          <label className="row small">
            <input type="checkbox" checked={lead} onChange={(e) => setLead(e.target.checked)} />
            Lead from the front (stronger attack, but you could be wounded or killed)
          </label>
          <ul className="offer-list">
            {targets.map((id) => {
              const odds = winChance(militiaPower(m, lead), counterforcePower(game, m, id));
              return (
                <li key={id}>
                  <div>
                    <strong>{geo.provinces[id]!.name}</strong>
                    <div className="muted small">
                      {formatPercent(odds, 0)} chance of success · supplies{" "}
                      {formatMoney(attackCost(game), true)}
                    </div>
                  </div>
                  <button
                    className="btn small danger"
                    onClick={() => act({ type: "militia.attack", provinceId: id, lead })}
                  >
                    Attack
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <button className="btn small" onClick={() => act({ type: "militia.disband" })}>
        Disband
      </button>
    </section>
  );
}

function GovernmentPicker({
  value,
  onChange,
}: {
  value: GovernmentType;
  onChange(g: GovernmentType): void;
}) {
  return (
    <select
      className="input"
      value={value}
      onChange={(e) => onChange(e.target.value as GovernmentType)}
      aria-label="Form of government"
    >
      {FOUNDABLE_GOVERNMENTS.map((g) => (
        <option key={g} value={g}>
          {GOVERNMENT_LABELS[g]}
        </option>
      ))}
    </select>
  );
}

function IndependenceCard() {
  const { game, act } = useGameUi();
  const conflict = game.state.conflict;
  const m = conflict.militia;
  const ref = conflict.referendum;
  const [name, setName] = useState("");
  const [government, setGovernment] = useState<GovernmentType>("democracy");
  const governor = playerOffices(game).find((o) => o.kind === "governor");
  const refBlocker = referendumBlocker(game);
  const canActOnVote = !!ref?.rejected && (ref.expiresAt ?? 0) > game.time;

  if (!m && !governor && !ref) {
    return (
      <section className="card">
        <h4 className="no-margin">A country of your own</h4>
        <p className="muted small">
          There are two roads. Raise a militia, seize territory and hold it. Or become a regional
          governor, win the people over, and call an independence referendum.
        </p>
      </section>
    );
  }

  const requirements = m ? militiaIndependenceRequirements(game) : [];
  const ready = (m && requirements.every((r) => r.met)) || canActOnVote;
  return (
    <section className="card">
      <h4 className="no-margin">A country of your own</h4>
      {ref && !ref.rejected && (
        <p className="small">
          Referendum on independence for {game.geography.provinces[ref.provinceId]!.name} as{" "}
          <strong>{ref.name}</strong>: the vote is on {formatDate(ref.voteAt)}.
        </p>
      )}
      {canActOnVote && (
        <p className="warn-text small">
          {formatPercent(ref!.yesShare ?? 0, 0)} voted for independence, but the government refuses
          to accept it. You can declare independence anyway until {formatDate(ref!.expiresAt!)}.
          Expect them to send the army.
        </p>
      )}
      {m && (
        <ul className="gov-list">
          {requirements.map((r) => (
            <li key={r.label}>
              <span>{r.label}</span>
              <span className={r.met ? "small" : "muted small"}>{r.met ? "✓" : "—"}</span>
            </li>
          ))}
        </ul>
      )}
      {governor && !ref && (
        <p className="muted small">
          As governor of {game.geography.provinces[governor.provinceId!]!.name}, you could put
          independence to a vote. Likely support:{" "}
          {formatPercent(referendumSupport(game, governor.provinceId!, governor.countryId), 0)}.
          {refBlocker && ` ${refBlocker}`}
        </p>
      )}
      {(ready || (governor && !ref)) && (
        <>
          <div className="row">
            <input
              className="input"
              placeholder="Name of the new country"
              value={name}
              maxLength={40}
              onChange={(e) => setName(e.target.value)}
            />
            <GovernmentPicker value={government} onChange={setGovernment} />
          </div>
          <div className="row">
            {ready && (
              <button
                className="btn small danger"
                onClick={() => act({ type: "nation.declare", name, government })}
              >
                Declare independence
              </button>
            )}
            {governor && !ref && (
              <button
                className="btn small"
                disabled={!!refBlocker}
                onClick={() => act({ type: "nation.referendum", name, government })}
              >
                Call a referendum
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function RulerCard({ countryId }: { countryId: CountryId }) {
  const { game, act } = useGameUi();
  const country = game.state.world.countries[countryId]!;
  const army = militaryOf(country);
  const [selected, setSelected] = useState<CountryId | null>(null);
  const [goal, setGoal] = useState<WarGoal>("border");
  const [op, setOp] = useState<SpyOp>("sabotage");
  const [aid, setAid] = useState("");
  const others = new Set<CountryId>([
    ...landNeighbors(game.geography, countryId),
    ...warsOf(game, countryId).flatMap((w) => [...w.attackers, ...w.defenders]),
    ...game.state.conflict.alliances.flatMap((k) => k.split("|")),
    ...(game.state.conflict.tradeDeals ?? []).flatMap((k) => k.split("|")),
    ...(game.state.conflict.pacts ?? []).flatMap((k) => k.split("|")),
  ]);
  others.delete(countryId);
  const list = [...others]
    .filter((id) => (game.state.world.countries[id]?.population ?? 0) > 0)
    .sort((a, b) => relation(game, countryId, b) - relation(game, countryId, a));
  const gov = (action: GovernmentAction) => act({ type: "gov.action", action });

  return (
    <section className="card">
      <h4 className="no-margin">Leading {countryName(game, countryId)}</h4>
      <p className="muted small">
        Military strength: #{militaryRank(game, countryId)} in the world.
      </p>
      <Meter label="Mobilization" value={army.mobilization * 100} compact tone="neutral" />
      <Meter label="War exhaustion" value={army.exhaustion} compact tone="inverse" />

      <h4>Foreign relations</h4>
      {list.length === 0 ? (
        <p className="muted small">No neighbors by land.</p>
      ) : (
        <ul className="offer-list">
          {list.map((id) => {
            const rel = relation(game, countryId, id);
            const war = warBetween(game, countryId, id);
            const ally = allied(game, countryId, id);
            const pact = hasPact(game, countryId, id);
            const trade = hasTradeDeal(game, countryId, id);
            const sanctioned = sanctions(game, countryId, id);
            return (
              <li key={id}>
                <div>
                  <button className="link" onClick={() => setSelected(selected === id ? null : id)}>
                    <strong>{countryName(game, id)}</strong>
                  </button>{" "}
                  {war && <span className="tag danger-tag">At war</span>}
                  {ally && <span className="tag">Ally</span>}
                  {pact && <span className="tag">Pact</span>}
                  {trade && <span className="tag">Trade</span>}
                  {sanctioned && <span className="tag danger-tag">Sanctioned</span>}
                  <div className="muted small">Relations {Math.round(rel)}</div>
                </div>
                <div className="row wrap">
                  {!war && (
                    <button
                      className="btn small"
                      onClick={() => act({ type: "diplomacy.improve", countryId: id })}
                    >
                      Improve
                    </button>
                  )}
                  {!war && (ally || rel >= 50) && (
                    <button
                      className="btn small"
                      onClick={() =>
                        act({
                          type: ally ? "diplomacy.breakAlliance" : "diplomacy.ally",
                          countryId: id,
                        })
                      }
                    >
                      {ally ? "End alliance" : "Ally"}
                    </button>
                  )}
                  {!war && (pact || rel >= 20) && (
                    <button
                      className="btn small"
                      onClick={() => gov({ kind: "pact", countryId: id })}
                    >
                      {pact ? "End pact" : "Pact"}
                    </button>
                  )}
                  {!war && (trade || rel >= 30) && (
                    <button
                      className="btn small"
                      onClick={() => gov({ kind: "trade", countryId: id })}
                    >
                      {trade ? "End trade deal" : "Trade deal"}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {selected && (
        <div className="card">
          <h4 className="no-margin">{countryName(game, selected)}</h4>
          <div className="row wrap">
            <button
              className="btn small"
              onClick={() =>
                gov({
                  kind: "sanction",
                  countryId: selected,
                  on: !sanctions(game, countryId, selected),
                })
              }
            >
              {sanctions(game, countryId, selected) ? "Lift sanctions" : "Impose sanctions"}
            </button>
            <input
              className="input small-input"
              placeholder="Aid $"
              value={aid}
              onChange={(e) => setAid(e.target.value)}
              aria-label="Foreign aid"
            />
            <button
              className="btn small"
              onClick={() =>
                gov({
                  kind: "aid",
                  countryId: selected,
                  amountCents: Math.round(Number(aid.replace(/[^0-9.]/g, "")) * 100) || 0,
                })
              }
            >
              Send aid
            </button>
          </div>
          <div className="row wrap">
            <select className="input" value={op} onChange={(e) => setOp(e.target.value as SpyOp)}>
              {(Object.keys(SPY_OPS) as SpyOp[]).map((k) => (
                <option key={k} value={k}>
                  {SPY_OPS[k].label}
                </option>
              ))}
            </select>
            <button
              className="btn small danger"
              onClick={() => gov({ kind: "spy", countryId: selected, op })}
            >
              Run operation ({formatPercent(spyOdds(game, countryId, selected, op), 0)},{" "}
              {formatMoney(spyOpCost(country), true)})
            </button>
          </div>
          <p className="muted small">{SPY_OPS[op].description}</p>
          {!warBetween(game, countryId, selected) && (
            <div className="row wrap">
              <select
                className="input"
                value={goal}
                onChange={(e) => setGoal(e.target.value as WarGoal)}
              >
                {(Object.keys(WAR_GOAL_LABELS) as WarGoal[]).map((g) => (
                  <option key={g} value={g}>
                    {WAR_GOAL_LABELS[g]}
                  </option>
                ))}
              </select>
              <button
                className="btn small danger"
                onClick={() => act({ type: "war.declare", countryId: selected, goal })}
              >
                Declare war
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function WarCard({ war, leader }: { war: War; leader: CountryId | null }) {
  const { game, act } = useGameUi();
  const names = (ids: CountryId[]) => ids.map((id) => countryName(game, id)).join(", ");
  const side = leader ? sideOf(war, leader) : null;
  const leads = !!leader && (war.attackers[0] === leader || war.defenders[0] === leader);
  const ours = side === "defenders" ? -war.score : war.score;
  return (
    <section className="card highlight">
      <h4 className="no-margin">{war.name}</h4>
      <p className="small">
        {names(war.attackers)} <span className="muted">vs</span> {names(war.defenders)} · since{" "}
        {formatDate(war.startedAt)}
      </p>
      <Meter
        label={
          side
            ? "How the war is going for you"
            : `${countryName(game, war.attackers[0]!)} advantage`
        }
        value={(ours + 100) / 2}
        display={`${ours > 0 ? "+" : ""}${ours}`}
        compact
      />
      {war.battles.length > 0 && (
        <ul className="gov-list">
          {war.battles
            .slice(-4)
            .reverse()
            .map((b, i) => (
              <li key={i}>
                <span>
                  {game.geography.provinces[b.provinceId]!.name}{" "}
                  <span className="muted small">{formatDate(b.time)}</span>
                </span>
                <span className="small">{countryName(game, b.winner)}</span>
              </li>
            ))}
        </ul>
      )}
      {war.goal && <p className="muted small">Goal: {WAR_GOAL_LABELS[war.goal]}.</p>}
      {(war.ceasefireUntil ?? 0) > game.time && (
        <p className="small">Ceasefire until {formatDate(war.ceasefireUntil!)}.</p>
      )}
      {leads && leader && <WarPlan war={war} self={leader} />}
      {leads && (
        <div className="row">
          <button className="btn small" onClick={() => act({ type: "war.peace", warId: war.id })}>
            Offer peace
          </button>
          <button
            className="btn small"
            onClick={() => act({ type: "war.ceasefire", warId: war.id })}
          >
            Propose ceasefire
          </button>
        </div>
      )}
    </section>
  );
}

/** How the player's side fights: stance and the region to push for. */
function WarPlan({ war, self }: { war: War; self: CountryId }) {
  const { game, act } = useGameUi();
  const stance = war.stances?.[self] ?? "balanced";
  const objective = war.objectives?.[self] ?? null;
  const enemies = war.attackers.includes(self) ? war.defenders : war.attackers;
  const targets = enemies.flatMap((id) => borderProvinces(game.geography, self, id)).slice(0, 40);
  return (
    <div className="row wrap">
      {(["offensive", "balanced", "defensive"] as WarStance[]).map((s) => (
        <button
          key={s}
          className={stance === s ? "chip active" : "chip"}
          onClick={() => act({ type: "war.plan", warId: war.id, stance: s, objective })}
        >
          {s === "offensive" ? "Offensive" : s === "balanced" ? "Balanced" : "Dig in"}
        </button>
      ))}
      <select
        className="input"
        value={objective ?? ""}
        onChange={(e) =>
          act({
            type: "war.plan",
            warId: war.id,
            stance,
            objective: e.target.value === "" ? null : Number(e.target.value),
          })
        }
        aria-label="Objective"
      >
        <option value="">Objective: wherever the front allows</option>
        {targets.map((id) => (
          <option key={id} value={id}>
            Take {game.geography.provinces[id]!.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function WorldConflicts() {
  const { game } = useGameUi();
  const conflict = game.state.conflict;
  const wars = activeWars(game);
  const ended = conflict.wars
    .filter((w) => w.status === "ended")
    .slice(-5)
    .reverse();
  if (wars.length === 0 && conflict.insurgencies.length === 0 && ended.length === 0) {
    return (
      <section className="card">
        <h4 className="no-margin">The world</h4>
        <p className="muted small">The world is at peace, for now.</p>
      </section>
    );
  }
  return (
    <section className="card">
      <h4 className="no-margin">The world</h4>
      <ul className="gov-list">
        {wars.map((w) => (
          <li key={w.id}>
            <span>{w.name}</span>
            <span className="small">score {w.score}</span>
          </li>
        ))}
        {conflict.insurgencies.map((i) => (
          <li key={i.id}>
            <span>
              {i.name} <span className="muted small">{countryName(game, i.countryId)}</span>
            </span>
            <span className="small">
              {i.held.length} region{i.held.length === 1 ? "" : "s"}
            </span>
          </li>
        ))}
      </ul>
      {ended.length > 0 && (
        <>
          <h4>Recent history</h4>
          <ul className="gov-list">
            {ended.map((w) => (
              <li key={w.id}>
                <span>{w.name}</span>
                <span className="muted small">{w.outcome}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export function PowerPanel() {
  const { game } = useGameUi();
  const ruled = playerRuledCountry(game);
  // Militias and breakaway states are life-mode paths to power.
  const lifeMode = game.state.config.mode !== "leader";
  const home = game.geography.cities[game.state.player.cityId]!.countryId;
  const mine = new Set([home, ruled].filter((x): x is CountryId => !!x));
  const ourWars = activeWars(game).filter((w) =>
    [...w.attackers, ...w.defenders].some((id) => mine.has(id)),
  );
  return (
    <div className="panel-stack">
      {ourWars.map((w) => (
        <WarCard key={w.id} war={w} leader={ruled} />
      ))}
      {ruled && <RulerCard countryId={ruled} />}
      {ruled && <ForcesCard countryId={ruled} />}
      {lifeMode && <MilitiaCard />}
      {lifeMode && <IndependenceCard />}
      <WorldConflicts />
    </div>
  );
}
