import { describe, expect, it } from "vitest";
import {
  canWorkLegally,
  createNewGame,
  currentResidency,
  naturalizationBlocker,
  planMove,
  rentalListings,
  type Command,
  type Game,
} from "../src";
import { economicConfig, testCharacter, tinyGeography } from "./fixtures";

const geo = tinyGeography();

function setup(): Game {
  const game = createNewGame({ config: economicConfig(), character: testCharacter }, geo);
  game.state.player.cashCents = 100_000_000;
  return game;
}

function run(game: Game, command: Command) {
  const result = game.dispatch(command);
  if (!result.ok) throw new Error(`${command.type} refused: ${result.reason}`);
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

describe("moving and immigration", () => {
  it("moving within the country costs money and time, and leaves home", () => {
    const game = setup();
    const p = game.state.player;
    const before = p.cashCents;
    run(game, { type: "move.to", cityId: 1 });
    expect(p.cityId).toBe(1);
    expect(p.cashCents).toBeLessThan(before);
    expect(p.housing.kind).toBe("homeless");
    expect(p.activity?.id).toBe("traveling");
    expect(game.state.world.companyCities).toContain(1);
  });

  it("living abroad needs a visa or citizenship", () => {
    const game = setup();
    expect(planMove(game, 2).blocker).toMatch(/visa/);
    expect(game.dispatch({ type: "move.to", cityId: 2 }).ok).toBe(false);
  });

  it("an approved work visa allows moving and working legally", () => {
    const game = setup();
    const p = game.state.player;
    game.state.world.countries.BBB!.immigrationOpenness = 1;
    p.credentials.push("itSupport");
    let approved = false;
    for (let i = 0; i < 10 && !approved; i++) {
      run(game, { type: "immigration.apply", countryId: "BBB", visa: "work" });
      tickSafely(game, 24 * 31);
      approved = p.visas.some((v) => v.countryId === "BBB");
    }
    expect(approved).toBe(true);
    run(game, { type: "move.to", cityId: 2 });
    expect(currentResidency(game).status).toBe("work");
    expect(canWorkLegally(game)).toBe(true);
  });

  it("crossing illegally leaves you without the right to work or rent", () => {
    const game = setup();
    const p = game.state.player;
    for (let i = 0; i < 20 && p.cityId !== 2; i++)
      run(game, { type: "move.to", cityId: 2, illegal: true });
    expect(p.cityId).toBe(2);
    expect(currentResidency(game).status).toBe("undocumented");
    expect(canWorkLegally(game)).toBe(false);
    expect(rentalListings(game).every((l) => !l.available)).toBe(true);
    tickSafely(game, 12);
    while (new Date(game.time * 3.6e6).getUTCHours() !== 10) tickSafely(game, 1);
    expect(game.dispatch({ type: "activity.start", activityId: "jobSearch" }).ok).toBe(false);
  });

  it("visas expire and residency can turn into citizenship over time", () => {
    const game = setup();
    const p = game.state.player;
    p.cityId = 2;
    p.residency = {
      countryId: "BBB",
      status: "work",
      since: game.time - 4 * 365 * 24,
      expiresAt: game.time + 24 * 400,
    };
    expect(naturalizationBlocker(game)).toBeNull();
    run(game, { type: "immigration.naturalize" });
    expect(p.residency.status).toBe("permanent");
    expect(naturalizationBlocker(game)).toMatch(/5 years/);
    p.residency.since -= 6 * 365 * 24;
    run(game, { type: "immigration.naturalize" });
    expect(p.citizenship).toContain("BBB");

    const visitor = setup();
    visitor.state.player.cityId = 2;
    visitor.state.player.residency = {
      countryId: "BBB",
      status: "visitor",
      since: visitor.time,
      expiresAt: visitor.time + 48,
    };
    tickSafely(visitor, 72);
    expect(visitor.state.player.residency.status).toBe("undocumented");
  });
});
