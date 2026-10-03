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
  TRAIT_LABELS,
  type Relationship,
  type RelationshipKind,
  type SocialAction,
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

function PersonCard({ r }: { r: Relationship }) {
  const { game, act } = useGameUi();
  const person = personById(game, r.personId);
  if (!person) return null;
  const romantic = r.kind === "dating" || r.kind === "engaged" || r.kind === "spouse";
  return (
    <li className="person-card">
      <div className="row between">
        <div>
          <strong>
            {person.firstName} {person.lastName}
          </strong>{" "}
          <span className="tag">{RELATIONSHIP_LABELS[r.kind]}</span>
          <div className="muted small">
            {personAge(game, person)} · {person.occupation} ·{" "}
            {person.traits.map((t) => TRAIT_LABELS[t]).join(", ")} · met {r.context}
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
    </div>
  );
}
