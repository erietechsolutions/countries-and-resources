import { useState } from "react";
import {
  ACTIVITIES,
  activityBlocker,
  activityById,
  CATEGORY_LABELS,
  formatMoney,
  formatTime,
  mealCapacity,
  NEED_LABELS,
  restingPlace,
  type ActivityCategory,
  type ActivityDef,
  type NeedId,
} from "@cr/sim";
import { Meter } from "../components/Meter";
import { useGameUi } from "../game/GameContext";

const NEED_ORDER: NeedId[] = ["food", "energy", "hygiene", "health", "happiness"];
const CATEGORY_ORDER: ActivityCategory[] = [
  "food",
  "rest",
  "hygiene",
  "work",
  "money",
  "social",
  "home",
  "growth",
];

const PLACE_LABELS = {
  home: "at home",
  shelter: "at the shelter",
  street: "on the street",
} as const;

export function NeedsCard() {
  const { game } = useGameUi();
  const n = game.state.player.needs;
  return (
    <section className="card needs">
      {NEED_ORDER.map((id) => (
        <Meter key={id} label={NEED_LABELS[id]} value={n[id]} compact />
      ))}
    </section>
  );
}

export function CurrentActivity() {
  const { game, act } = useGameUi();
  const a = game.state.player.activity;
  if (!a) {
    return (
      <section className="card activity idle">
        <strong>Idle</strong>
        <span className="muted small">
          Choose something to do below. Time keeps passing while you stand around.
        </span>
      </section>
    );
  }
  const def = activityById(a.id);
  const total = a.endsAt - a.startedAt;
  const done = game.time - a.startedAt;
  const left = a.endsAt - game.time;
  return (
    <section className="card activity">
      <div className="row between">
        <strong>{def?.label ?? a.id}</strong>
        <span className="muted small">
          {left}h left · until {formatTime(a.endsAt)}
        </span>
      </div>
      <div className="bar">
        <i style={{ width: `${(done / total) * 100}%`, background: "var(--accent)" }} />
      </div>
      {def?.interruptible && (
        <button className="btn small" onClick={() => act({ type: "activity.cancel" })}>
          Stop
        </button>
      )}
    </section>
  );
}

function ActionRow({ def }: { def: ActivityDef }) {
  const { game, act } = useGameUi();
  const opt = def.amount;
  const [amount, setAmount] = useState<number | null>(null);
  const max = opt ? opt.max(game) : 0;
  const value = opt ? Math.max(opt.min, Math.min(max, amount ?? opt.default(game))) : undefined;
  const blocked = activityBlocker(game, def, value);
  const cost = def.cost?.(game, value) ?? 0;
  const hours = def.hours(game, value);
  return (
    <li className={blocked ? "action blocked" : "action"} title={def.description}>
      <div className="action-main">
        <span className="action-name">{def.label}</span>
        <span className="muted small">
          {hours}h{cost > 0 && ` · ${formatMoney(cost)}`}
          {blocked && ` · ${blocked}`}
        </span>
      </div>
      {opt && value !== undefined && (
        <div className="stepper-input" aria-label={opt.label}>
          <button
            className="icon-btn small"
            onClick={() => setAmount(Math.max(opt.min, value - 1))}
            aria-label={`Fewer ${opt.label}`}
          >
            −
          </button>
          <span className="mono">{value}</span>
          <button
            className="icon-btn small"
            onClick={() => setAmount(Math.min(max, value + 1))}
            aria-label={`More ${opt.label}`}
          >
            +
          </button>
        </div>
      )}
      <button
        className="btn small primary"
        disabled={!!blocked}
        onClick={() => act({ type: "activity.start", activityId: def.id, amount: value })}
      >
        Go
      </button>
    </li>
  );
}

export function LifePanel() {
  const { game } = useGameUi();
  const p = game.state.player;
  const [showBlocked, setShowBlocked] = useState(true);
  // Activities done with a specific person live in the People tab.
  const visible = ACTIVITIES.filter((a) => !a.system && !a.target && !a.businessTarget);
  return (
    <div className="panel-stack">
      <CurrentActivity />
      <NeedsCard />
      <section className="card">
        <div className="row between">
          <h4 className="no-margin">Things to do</h4>
          <label className="small muted check">
            <input
              type="checkbox"
              checked={showBlocked}
              onChange={(e) => setShowBlocked(e.target.checked)}
            />{" "}
            Show unavailable
          </label>
        </div>
        <p className="muted small">
          You'd sleep {PLACE_LABELS[restingPlace(game)]} · Food stored: {p.inventory.meals}/
          {mealCapacity(game)} meals
          {p.housing.kind === "parents" && " (family meals are free)"}
        </p>
        {CATEGORY_ORDER.map((cat) => {
          const defs = visible.filter(
            (d) =>
              d.category === cat &&
              (showBlocked || !activityBlocker(game, d, d.amount?.default(game))),
          );
          if (defs.length === 0) return null;
          return (
            <div key={cat} className="action-group">
              <h5>{CATEGORY_LABELS[cat]}</h5>
              <ul className="action-list">
                {defs.map((d) => (
                  <ActionRow key={d.id} def={d} />
                ))}
              </ul>
            </div>
          );
        })}
      </section>
    </div>
  );
}
