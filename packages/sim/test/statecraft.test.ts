import { describe, expect, it } from "vitest";
import {
  armyPower,
  coupRisk,
  createNewGame,
  creditRating,
  ensureGenerals,
  militaryOf,
  playerRuledCountry,
  readStatecraft,
  runBudget,
  warsOf,
  type Command,
  type Game,
  type GovernmentAction,
} from "../src";
import { economicConfig, testCharacter, tinyGeography } from "./fixtures";

const geo = tinyGeography();
const DAY = 24;

function ruler(): Game {
  const game = createNewGame(
    {
      config: economicConfig({ mode: "leader", startingCashCents: 0, startingHousing: "parents" }),
      character: testCharacter,
    },
    geo,
  );
  game.state.player.politics.approval = 80;
  return game;
}

function gov(game: Game, action: GovernmentAction) {
  run(game, { type: "gov.action", action });
}

function run(game: Game, command: Command) {
  const result = game.dispatch(command);
  if (!result.ok) throw new Error(`${command.type} refused: ${result.reason}`);
}

describe("the budget", () => {
  it("spending priorities cost money and change the country", () => {
    const game = ruler();
    const c = game.state.world.countries.AAA!;
    runBudget(c);
    const before = c.budget!.spendingCents;
    gov(game, { kind: "budget", area: "welfare", level: 1 });
    gov(game, { kind: "budget", area: "education", level: 1 });
    runBudget(c);
    expect(c.budget!.spendingCents).toBeGreaterThan(before);
    const dev = c.development;
    game.tick(70 * DAY);
    expect(c.development).toBeGreaterThan(dev);
  });

  it("only the head of government can set it", () => {
    const game = createNewGame({ config: economicConfig(), character: testCharacter }, geo);
    expect(playerRuledCountry(game)).toBeNull();
    const result = game.dispatch({
      type: "gov.action",
      action: { kind: "budget", area: "welfare", level: 1 },
    });
    expect(result.ok).toBe(false);
    // Looking at a country's settings never creates them.
    readStatecraft(game.state.world.countries.BBB!);
    expect(game.state.world.countries.BBB!.statecraft).toBeUndefined();
  });

  it("heavy debt hurts the credit rating", () => {
    const game = ruler();
    const c = game.state.world.countries.AAA!;
    runBudget(c);
    const good = creditRating(c);
    c.budget!.debtCents = c.gdpPerCapita * 100 * c.population * 3;
    expect(creditRating(c)).not.toBe(good);
  });
});

describe("projects and policy", () => {
  it("big projects finish and pay off", () => {
    const game = ruler();
    gov(game, { kind: "project", project: "fortress", provinceId: 0 });
    expect(
      game.dispatch({
        type: "gov.action",
        action: { kind: "project", project: "port", provinceId: 1 },
      }).ok,
    ).toBe(false); // South A has no coast
    game.tick(400 * DAY);
    expect(readStatecraft(game.state.world.countries.AAA!).forts).toContain(0);
  });

  it("nationalizing and tariffs change the economy", () => {
    const game = ruler();
    const s = () => readStatecraft(game.state.world.countries.AAA!);
    const owned = s().stateOwnership;
    gov(game, { kind: "ownership", direction: 1 });
    expect(s().stateOwnership).toBe(owned + 0.25);
    gov(game, { kind: "tariff", level: 0.3 });
    expect(s().tariff).toBe(0.3);
  });
});

describe("the military", () => {
  it("buying heavy forces and research make the army stronger", () => {
    const game = ruler();
    const c = game.state.world.countries.AAA!;
    const before = armyPower(c);
    gov(game, { kind: "procure", branch: "armor", count: 50 });
    gov(game, { kind: "research", level: 1 });
    expect(armyPower(c)).toBeGreaterThan(before);
    const tech = militaryOf(c).tech!;
    game.tick(70 * DAY);
    expect(militaryOf(c).tech!).toBeGreaterThan(tech);
  });

  it("disloyal generals in an unstable country stage coups", () => {
    const game = ruler();
    const c = game.state.world.countries.AAA!;
    const generals = ensureGenerals(game, c);
    expect(coupRisk(game, c)).toBe(0);
    for (const g of generals) g.loyalty = 0;
    c.stability = 5;
    expect(coupRisk(game, c)).toBeGreaterThan(0.1);
    gov(game, { kind: "general", index: 0, action: "reward" });
    expect(generals[0]!.loyalty).toBe(20);
  });
});

describe("war plans and diplomacy", () => {
  it("leaders set a stance and can agree a ceasefire", () => {
    const game = ruler();
    run(game, { type: "war.declare", countryId: "BBB", goal: "punitive" });
    const war = warsOf(game, "AAA")[0]!;
    expect(war.goal).toBe("punitive");
    expect(war.claims).toEqual([]);
    run(game, { type: "war.plan", warId: war.id, stance: "defensive", objective: null });
    expect(war.stances?.AAA).toBe("defensive");
    militaryOf(game.state.world.countries.BBB!).exhaustion = 60;
    run(game, { type: "war.ceasefire", warId: war.id });
    const occupied = { ...war.occupied };
    game.tick(30 * DAY);
    expect(war.occupied).toEqual(occupied);
  });

  it("non-aggression pacts stop wars; sanctions hurt the target", () => {
    const game = ruler();
    game.state.conflict.relations["AAA|BBB"] = 90;
    gov(game, { kind: "pact", countryId: "BBB" });
    expect(game.state.conflict.pacts).toContain("AAA|BBB");
    expect(game.dispatch({ type: "war.declare", countryId: "BBB" }).ok).toBe(false);
    const b = game.state.world.countries.BBB!;
    gov(game, { kind: "sanction", countryId: "BBB", on: true });
    const gdp = b.gdpPerCapita;
    game.tick(40 * DAY);
    expect(b.gdpPerCapita).toBeLessThan(gdp * 1.02);
    expect(game.state.conflict.sanctions).toContain("AAA>BBB");
  });

  it("spy operations need time between them in the same country", () => {
    const game = ruler();
    const b = game.state.world.countries.BBB!;
    b.stability = 20;
    // Make the operation a sure thing.
    game.state.world.countries.AAA!.development = 1;
    b.ruleOfLaw = 0;
    const before = game.state.conflict.insurgencies.length;
    gov(game, { kind: "spy", countryId: "BBB", op: "sabotage" });
    expect(
      game.dispatch({
        type: "gov.action",
        action: { kind: "spy", countryId: "BBB", op: "sabotage" },
      }).ok,
    ).toBe(false); // agents lie low between operations
    expect(game.state.conflict.insurgencies.length).toBe(before);
  });
});
