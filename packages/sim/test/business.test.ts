import { describe, expect, it } from "vitest";
import {
  createNewGame,
  foundingCost,
  runBusinessMonth,
  valuation,
  type Command,
  type Game,
} from "../src";
import { economicConfig, testCharacter, tinyGeography } from "./fixtures";

const geo = tinyGeography();

function setup(): Game {
  const game = createNewGame({ config: economicConfig(), character: testCharacter }, geo);
  game.state.player.cashCents = 50_000_000;
  return game;
}

function run(game: Game, command: Command) {
  const result = game.dispatch(command);
  if (!result.ok) throw new Error(`${command.type} refused: ${result.reason}`);
}

describe("player businesses", () => {
  it("founding needs a name and enough capital, and moves money into the business", () => {
    const game = setup();
    const { fee, minCapital } = foundingCost(game);
    expect(
      game.dispatch({
        type: "business.found",
        name: "",
        sector: "retail",
        capitalCents: minCapital,
      }).ok,
    ).toBe(false);
    expect(
      game.dispatch({
        type: "business.found",
        name: "Shop",
        sector: "retail",
        capitalCents: minCapital - 1,
      }).ok,
    ).toBe(false);
    const before = game.state.player.cashCents;
    run(game, {
      type: "business.found",
      name: "Corner Shop",
      sector: "retail",
      capitalCents: minCapital,
    });
    expect(game.state.player.cashCents).toBe(before - fee - minCapital);
    expect(game.state.businesses[0]!.cashCents).toBe(minCapital);
  });

  it("staff are limited by location size, and locations can be expanded", () => {
    const game = setup();
    run(game, {
      type: "business.found",
      name: "Diner",
      sector: "hospitality",
      capitalCents: 5_000_000,
    });
    const b = game.state.businesses[0]!;
    expect(game.dispatch({ type: "business.staff", businessId: b.id, employees: 9 }).ok).toBe(
      false,
    );
    run(game, { type: "business.staff", businessId: b.id, employees: 8 });
    run(game, { type: "business.upgrade", businessId: b.id, locationIndex: 0 });
    run(game, { type: "business.staff", businessId: b.id, employees: 12 });
    expect(b.employees).toBe(12);
  });

  it("runs monthly, earning revenue and building a brand", () => {
    const game = setup();
    run(game, { type: "business.found", name: "Tech Co", sector: "tech", capitalCents: 5_000_000 });
    const b = game.state.businesses[0]!;
    run(game, { type: "business.staff", businessId: b.id, employees: 3 });
    run(game, { type: "business.policy", businessId: b.id, marketingCents: 50_000 });
    for (let m = 0; m < 6; m++) runBusinessMonth(game, b, true);
    expect(b.history).toHaveLength(6);
    expect(b.history.at(-1)!.revenueCents).toBeGreaterThan(0);
    expect(b.brand).toBeGreaterThan(5);
  });

  it("goes bankrupt after two months without cash", () => {
    const game = setup();
    run(game, {
      type: "business.found",
      name: "Money Pit",
      sector: "retail",
      capitalCents: foundingCost(game).minCapital,
    });
    const b = game.state.businesses[0]!;
    b.employees = 8;
    b.marketingCents = 10_000_000;
    game.tick(24 * 70);
    expect(b.status).toBe("bankrupt");
  });

  it("can raise money from investors and be sold", () => {
    const game = setup();
    run(game, {
      type: "business.found",
      name: "Consultancy",
      sector: "office",
      capitalCents: 5_000_000,
    });
    const b = game.state.businesses[0]!;
    run(game, { type: "business.staff", businessId: b.id, employees: 3 });
    for (let m = 0; m < 4; m++) runBusinessMonth(game, b, true);
    expect(valuation(b)).toBeGreaterThan(0);
    const cash = b.cashCents;
    run(game, { type: "business.raise", businessId: b.id, sharePercent: 20 });
    expect(b.playerShare).toBeCloseTo(0.8);
    expect(b.cashCents).toBeGreaterThan(cash);
    expect(game.dispatch({ type: "business.raise", businessId: b.id, sharePercent: 30 }).ok).toBe(
      false,
    ); // would lose control
    const personal = game.state.player.cashCents;
    run(game, { type: "business.sell", businessId: b.id });
    expect(b.status).toBe("closed");
    expect(game.state.player.cashCents).toBeGreaterThan(personal);
  });

  it("working on the business counts owner hours", () => {
    const game = setup();
    run(game, { type: "business.found", name: "Solo", sector: "office", capitalCents: 5_000_000 });
    const b = game.state.businesses[0]!;
    while (new Date(game.time * 3.6e6).getUTCHours() !== 9) game.tick();
    run(game, { type: "activity.start", activityId: "manageBusiness", targetId: b.id });
    game.tick(4);
    expect(b.ownerHours).toBe(4);
    expect(game.state.player.skills.management).toBeGreaterThan(0);
  });
});
