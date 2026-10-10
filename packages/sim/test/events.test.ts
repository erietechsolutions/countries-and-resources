import { describe, expect, it } from "vitest";
import {
  createNewGame,
  ensurePolitics,
  meetPerson,
  officesFor,
  pendingEvent,
  relationshipWith,
  STORY_EVENTS,
  type Game,
} from "../src";
import { economicConfig, testCharacter, tinyGeography } from "./fixtures";

const geo = tinyGeography();

/** A game where the player has a bit of everything, so every event is possible. */
function richGame(): Game {
  const game = createNewGame({ config: economicConfig(), character: testCharacter }, geo);
  const p = game.state.player;
  p.cashCents = 500_000_000;
  p.inventory.items.push("phone");
  const friend = meetPerson(game, "test");
  relationshipWith(p, friend.id)!.kind = "friend";
  game.dispatch({
    type: "business.found",
    name: "Test Co",
    sector: "retail",
    capitalCents: 10_000_000,
  });
  ensurePolitics(game);
  officesFor(game, p.cityId).find((o) => o.kind === "councilor")!.holders[0] = "player";
  return game;
}

function tickSafely(game: Game, hours: number) {
  for (let h = 0; h < hours; h++) {
    const n = game.state.player.needs;
    n.food = Math.max(n.food, 60);
    n.energy = Math.max(n.energy, 60);
    n.hygiene = Math.max(n.hygiene, 60);
    game.tick();
  }
}

describe("story events", () => {
  it("every event and every choice works without errors", () => {
    for (const def of STORY_EVENTS) {
      for (let i = 0; i < def.choices.length; i++) {
        const game = richGame();
        const data = def.setup ? def.setup(game) : {};
        if (!data) continue;
        game.state.story.pending = {
          id: def.id,
          data,
          createdAt: game.time,
          expiresAt: game.time + 72,
        };
        expect(def.text(game, data).length, def.id).toBeGreaterThan(5);
        const result = game.dispatch({ type: "event.choose", index: i });
        if (result.ok) expect(game.state.story.pending, `${def.id} #${i}`).toBeNull();
      }
    }
  });

  it("events come up now and then, and expire to a default choice", () => {
    const game = richGame();
    let raised = 0;
    game.events.on("storyEvent", () => raised++);
    tickSafely(game, 24 * 120);
    expect(raised).toBeGreaterThan(2);
    expect(game.state.story.history.length).toBeGreaterThan(0);
  });

  it("choices can be refused when not possible", () => {
    const game = richGame();
    const def = STORY_EVENTS.find((e) => e.id === "lottery")!;
    game.state.player.cashCents = 0;
    game.state.story.pending = {
      id: def.id,
      data: def.setup!(game)!,
      createdAt: game.time,
      expiresAt: game.time + 72,
    };
    expect(game.dispatch({ type: "event.choose", index: 0 }).ok).toBe(false);
    expect(pendingEvent(game)).not.toBeNull();
  });

  it("lending to a friend can lead to being repaid later", () => {
    const game = richGame();
    const def = STORY_EVENTS.find((e) => e.id === "friendLoan")!;
    let scheduled = false;
    for (let i = 0; i < 20 && !scheduled; i++) {
      game.state.story.pending = {
        id: def.id,
        data: def.setup!(game)!,
        createdAt: game.time,
        expiresAt: game.time + 72,
      };
      game.dispatch({ type: "event.choose", index: 0 });
      scheduled = game.state.story.scheduled.some((s) => s.id === "friendRepays");
    }
    expect(scheduled).toBe(true);
  });
});
