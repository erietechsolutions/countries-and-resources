import { pendingEvent } from "@cr/sim";
import { useGameUi } from "../game/GameContext";

/** Shows the current story event and its choices. The game stays paused until the player decides. */
export function StoryEventModal() {
  const { game, act, notify } = useGameUi();
  const pending = pendingEvent(game);
  if (!pending) return null;
  const { def, event } = pending;
  return (
    <div className="modal-backdrop">
      <div className="modal story-modal" role="dialog" aria-modal aria-labelledby="story-title">
        <h3 id="story-title">{def.title}</h3>
        <p>{def.text(game, event.data)}</p>
        <div className="menu-buttons">
          {def.choices.map((choice, i) => {
            const blocked = choice.blocked?.(game, event.data) ?? null;
            const detail = choice.detail?.(game, event.data);
            return (
              <button
                key={i}
                className={i === 0 ? "btn primary large" : "btn large"}
                disabled={!!blocked}
                onClick={() => {
                  if (act({ type: "event.choose", index: i })) {
                    const result = game.state.story.history.at(-1)?.result;
                    if (result) notify("info", result);
                  }
                }}
              >
                {choice.label}
                {(detail || blocked) && <span className="btn-sub">{blocked ?? detail}</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
