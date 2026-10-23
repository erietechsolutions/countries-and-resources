import { useState } from "react";
import {
  activityBlocker,
  activityById,
  personAge,
  personById,
  RELATIONSHIP_LABELS,
  REP_GROUPS,
  SOCIAL_ACTION_LABELS,
  socialActionBlocker,
  socialActionCost,
  formatMoney,
  investigateCost,
  reconcileCost,
  RIVAL_LABELS,
  TRAIT_LABELS,
  DATING_APP,
  formatPercent,
  matchChance,
  premiumCost,
  SEEKING_LABELS,
  type Gender,
  type Seeking,
  type Relationship,
  type RelationshipKind,
  type SocialAction,
  ageInYears,
  formatDate,
  healthCap,
  parentAge,
} from "@cr/sim";
import { Meter } from "../components/Meter";
import { useGameUi } from "../game/GameContext";

const ORDER: RelationshipKind[] = [
  "spouse",
  "engaged",
  "dating",
  "child",
  "bestFriend",
  "friend",
  "acquaintance",
  "rival",
  "ex",
];
const TARGETED = ["hangOut", "date", "call"] as const;

/** Which instant actions make sense to show for a relationship. */
function actionsFor(r: Relationship): SocialAction[] {
  switch (r.kind) {
    case "acquaintance":
    case "friend":
    case "bestFriend":
      return ["askOut", "endFriendship"];
    case "dating":
      return ["propose", "breakUp"];
    case "engaged":
      return ["marry", "breakUp"];
    case "spouse":
      return ["tryForBaby", "divorce"];
    default:
      return [];
  }
}

/** "Man", "Woman", "Boy" or "Girl": shown next to every name so it's clear who's who. */
export function genderLabel(gender: Gender, age: number): string {
  if (age < 18) return gender === "male" ? "Boy" : "Girl";
  return gender === "male" ? "Man" : "Woman";
}

function PersonCard({ r }: { r: Relationship }) {
  const { game, act } = useGameUi();
  const person = personById(game, r.personId);
  if (!person) return null;
  const romantic = r.kind === "dating" || r.kind === "engaged" || r.kind === "spouse";
  const rival = game.state.rivals.find((x) => x.personId === r.personId);
  if (rival) {
    return (
      <li className="person-card rival">
        <div>
          <strong>
            {person.firstName} {person.lastName}
          </strong>{" "}
          <span className="muted small">
            {genderLabel(person.gender, personAge(game, person))}, {personAge(game, person)}
          </span>{" "}
          <span className="tag danger-tag">{RIVAL_LABELS[rival.kind]}</span>
          <div className="muted small">
            {person.occupation} · {person.traits.map((t) => TRAIT_LABELS[t]).join(", ")}
          </div>
        </div>
        <Meter label="Hostility" value={rival.hostility} compact tone="neutral" />
        {rival.lastAction && <p className="small warn-text">Last move: {rival.lastAction}</p>}
        <div className="row wrap">
          <button
            className="btn small"
            onClick={() => act({ type: "rival.reconcile", personId: r.personId })}
          >
            Make peace ({formatMoney(reconcileCost(game), true)})
          </button>
          <button
            className="btn small danger"
            onClick={() => act({ type: "rival.investigate", personId: r.personId })}
          >
            Dig up dirt ({formatMoney(investigateCost(game), true)})
          </button>
        </div>
      </li>
    );
  }
  return (
    <li className="person-card">
      <div className="row between">
        <div>
          <strong>
            {person.firstName} {person.lastName}
          </strong>{" "}
          <span className="muted small">
            {genderLabel(person.gender, personAge(game, person))}, {personAge(game, person)}
          </span>{" "}
          <span className="tag">{RELATIONSHIP_LABELS[r.kind]}</span>
          <div className="muted small">
            {person.occupation} · {person.traits.map((t) => TRAIT_LABELS[t]).join(", ")} · met{" "}
            {r.context}
          </div>
        </div>
      </div>
      {r.kind !== "child" && (
        <div className="two-col">
          <Meter label="Affection" value={r.affection} compact />
          {(romantic || r.romance >= 20) && (
            <Meter label="Romance" value={r.romance} compact tone="accent" />
          )}
        </div>
      )}
      <div className="row wrap">
        {TARGETED.map((id) => {
          const def = activityById(id)!;
          const blocked = activityBlocker(game, def, undefined, r.personId);
          if (blocked && id === "date" && !romantic && r.romance < 30) return null;
          return (
            <button
              key={id}
              className="btn small"
              disabled={!!blocked}
              title={blocked ?? def.description}
              onClick={() => act({ type: "activity.start", activityId: id, targetId: r.personId })}
            >
              {def.label} ({def.hours(game)}h)
            </button>
          );
        })}
        {actionsFor(r).map((a) => {
          const blocked = socialActionBlocker(game, r.personId, a);
          const cost = socialActionCost(game, a);
          return (
            <button
              key={a}
              className={
                a === "breakUp" || a === "divorce" || a === "endFriendship"
                  ? "btn small danger"
                  : "btn small"
              }
              disabled={!!blocked}
              title={blocked ?? undefined}
              onClick={() => act({ type: "social.action", personId: r.personId, action: a })}
            >
              {SOCIAL_ACTION_LABELS[a]}
              {cost > 0 && ` (${formatMoney(cost, true)})`}
            </button>
          );
        })}
      </div>
    </li>
  );
}

export function PeoplePanel() {
  const { game, act } = useGameUi();
  const p = game.state.player;
  const rels = [...p.relationships].sort(
    (a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || b.affection - a.affection,
  );
  return (
    <div className="panel-stack">
      <section className="card">
        <h4 className="no-margin">Reputation</h4>
        <div className="skill-grid">
          {REP_GROUPS.map((g) => (
            <div key={g.id} title={g.description}>
              <Meter
                label={g.label}
                value={p.reputation[g.id] + 100}
                max={200}
                display={`${p.reputation[g.id] > 0 ? "+" : ""}${Math.round(p.reputation[g.id])}`}
                tone={p.reputation[g.id] >= 0 ? "accent" : "neutral"}
                compact
              />
            </div>
          ))}
        </div>
        <p className="muted small">
          Fame: {Math.round(p.reputation.fame)}/100. Reputation matters for jobs now and for
          elections later.
        </p>
      </section>

      <section className="card">
        <div className="row between">
          <h4 className="no-margin">People you know</h4>
          <div className="row">
            {(["goOut", "volunteer"] as const).map((id) => {
              const def = activityById(id)!;
              const blocked = activityBlocker(game, def);
              return (
                <button
                  key={id}
                  className="btn small"
                  disabled={!!blocked}
                  title={blocked ?? def.description}
                  onClick={() => act({ type: "activity.start", activityId: id })}
                >
                  {id === "goOut" ? "Go out" : "Volunteer"}
                </button>
              );
            })}
          </div>
        </div>
        {rels.length === 0 ? (
          <p className="muted small">
            You don't know anyone yet. Go out in the evening, volunteer, or get a job to meet
            people.
          </p>
        ) : (
          <ul className="person-list">
            {rels.map((r) => (
              <PersonCard key={r.personId} r={r} />
            ))}
          </ul>
        )}
      </section>
      <DatingCard />
      <FamilyLineCard />
    </div>
  );
}

/** Aging, parents and the generations played so far. */
function FamilyLineCard() {
  const { game } = useGameUi();
  const p = game.state.player;
  const { generation, ancestors } = game.state.dynasty;
  const age = ageInYears(p.birthTime, game.time);
  return (
    <section className="card">
      <h4 className="no-margin">
        The {p.lastName} family{generation > 1 && ` · generation ${generation}`}
      </h4>
      <p className="muted small">
        {age >= 45
          ? `At ${age}, your health can reach at most ${healthCap(age)}. Look after yourself.`
          : "You're young: your body recovers fully from almost anything."}{" "}
        When you die, an adult child or your spouse can carry on.
      </p>
      {game.state.family.length > 0 && (
        <ul className="gov-list">
          {game.state.family.map((m) => (
            <li key={m.id}>
              <span>
                {m.firstName} <span className="muted small">your {m.relation}</span>
              </span>
              <span className="small">{parentAge(game, m)}</span>
            </li>
          ))}
        </ul>
      )}
      {ancestors.length > 0 && (
        <ul className="gov-list">
          {ancestors.map((a) => (
            <li key={a.died}>
              <span>
                {a.name} <span className="muted small">gen. {a.generation}</span>
              </span>
              <span className="muted small">
                {formatDate(a.born)} – {formatDate(a.died)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Spark, the dating app: like or pass on today's profiles; matches show up as people above. */
function DatingCard() {
  const { game, act } = useGameUi();
  const d = game.state.dating;
  const [seeking, setSeeking] = useState<Seeking>(d.seeking);
  const premium = (d.premiumUntil ?? 0) > game.time;
  if (!d.active) {
    const hasPhone = game.state.player.inventory.items.includes("phone");
    return (
      <section className="card">
        <h4 className="no-margin">{DATING_APP}</h4>
        <p className="muted small">
          The dating app everyone's on. New profiles every morning; match and ask them out.
          {!hasPhone && " You'll need a phone first (Home tab)."}
        </p>
        <div className="row wrap">
          <span className="small">Looking for</span>
          {(Object.keys(SEEKING_LABELS) as Seeking[]).map((x) => (
            <button
              key={x}
              className={seeking === x ? "chip active" : "chip"}
              onClick={() => setSeeking(x)}
            >
              {SEEKING_LABELS[x]}
            </button>
          ))}
          <button
            className="btn small"
            disabled={!hasPhone}
            onClick={() => act({ type: "dating.join", seeking })}
          >
            Make a profile
          </button>
        </div>
      </section>
    );
  }
  return (
    <section className="card">
      <div className="row between">
        <h4 className="no-margin">
          {DATING_APP}
          {premium && <span className="tag">Premium</span>}
        </h4>
        <span className="muted small">
          Looking for {SEEKING_LABELS[d.seeking].toLowerCase()} · {d.matches} match
          {d.matches === 1 ? "" : "es"}
        </span>
      </div>
      {d.profiles.length === 0 ? (
        <p className="muted small">That's everyone for today. New profiles tomorrow.</p>
      ) : (
        <ul className="person-list">
          {d.profiles.map((x) => (
            <li key={x.id} className="person-card">
              <div className="row between">
                <div>
                  <strong>{x.firstName}</strong>{" "}
                  <span className="muted small">
                    {genderLabel(x.gender, x.age)}, {x.age}
                  </span>
                  <div className="muted small">
                    {x.occupation} · {x.traits.map((t) => TRAIT_LABELS[t]).join(", ")}
                  </div>
                  <div className="small">"{x.bio}"</div>
                </div>
                <div className="row">
                  <button
                    className="btn small"
                    onClick={() => act({ type: "dating.swipe", profileId: x.id, like: false })}
                  >
                    Pass
                  </button>
                  <button
                    className="btn small primary"
                    title={`About a ${formatPercent(matchChance(game, x), 0)} chance they like you back`}
                    onClick={() => act({ type: "dating.swipe", profileId: x.id, like: true })}
                  >
                    Like
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="row wrap">
        {!premium && (
          <button className="btn small" onClick={() => act({ type: "dating.premium" })}>
            Get Premium ({formatMoney(premiumCost(game), true)}/month)
          </button>
        )}
        <button className="btn small" onClick={() => act({ type: "dating.leave" })}>
          Delete profile
        </button>
      </div>
      <p className="muted small">
        Looking good, being happy and doing well all help. Matches appear in your list above.
      </p>
    </section>
  );
}
