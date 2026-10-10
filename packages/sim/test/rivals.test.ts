import { describe, expect, it } from "vitest";
import { createNewGame, rivalOfKind, type Game } from "../src";
import { economicConfig, testCharacter, tinyGeography } from "./fixtures";

const geo = tinyGeography();

function setup(): Game {
  const game = createNewGame({ config: economicConfig(), character: testCharacter }, geo);
  game.state.player.cashCents = 500_000_000;
  return game;
}

function tickSafely(game: Game, hours: number) {
  for (let h = 0; h < hours; h++) {
    const n = game.state.player.needs;
    n.food = Math.max(n.food, 60);
    n.energy = Math.max(n.energy, 60);
    n.hygiene = Math.max(n.hygiene, 60);
    n.health = Math.max(n.health, 60);
    game.state.story.pending = null;
    game.tick();
  }
}

describe("AI rivals", () => {
  it("a successful business attracts a rival CEO who fights back", () => {
    const game = setup();
    game.dispatch({
      type: "business.found",
      name: "Big Shop",
      sector: "retail",
      capitalCents: 50_000_000,
    });
    const b = game.state.businesses[0]!;
    b.brand = 60;
    b.employees = 6;
    tickSafely(game, 24 * 35);
    const rival = rivalOfKind(game, "business");
    expect(rival).toBeDefined();
    expect(game.state.player.relationships.find((r) => r.personId === rival!.personId)?.kind).toBe(
      "rival",
    );
    rival!.hostility = 100;
    rival!.nextActionAt = game.time;
    const before = b.brand + b.employees;
    tickSafely(game, 48);
    expect(b.brand + b.employees).toBeLessThan(before + 5);
    expect(rival!.lastAction.length).toBeGreaterThan(0);
  });

  it("deep underworld involvement brings a crime boss", () => {
    const game = setup();
    game.state.player.reputation.underworld = 50;
    tickSafely(game, 24 * 35);
    expect(rivalOfKind(game, "criminal")).toBeDefined();
  });

  it("rivals can be reconciled with or investigated", () => {
    const game = setup();
    game.state.player.reputation.underworld = 50;
    tickSafely(game, 24 * 35);
    const rival = rivalOfKind(game, "criminal")!;
    for (let i = 0; i < 10 && game.state.rivals.length > 0; i++) {
      game.state.player.cooldowns[`investigate:${rival.personId}`] = 0;
      game.dispatch({ type: "rival.investigate", personId: rival.personId });
    }
    expect(game.state.rivals).toHaveLength(0);
  });

  it("AI governments change policy over the years", () => {
    const game = setup();
    const other = game.state.world.countries.BBB!;
    const party = other.parties[0];
    if (!party) return;
    other.rulingPartyId = party.id;
    party.ideology = { economic: -1, social: -1, authority: 0, nationalism: -1 };
    const before = JSON.stringify([
      other.taxes,
      other.socialServices,
      other.minimumWageCents,
      other.healthcare,
      other.immigrationOpenness,
    ]);
    tickSafely(game, 24 * 365 * 3);
    const after = JSON.stringify([
      other.taxes,
      other.socialServices,
      other.minimumWageCents,
      other.healthcare,
      other.immigrationOpenness,
    ]);
    expect(after).not.toBe(before);
  });
});
