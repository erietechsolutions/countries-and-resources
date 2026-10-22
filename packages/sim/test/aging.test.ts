import { describe, expect, it } from "vitest";
import {
  addYears,
  annualMortality,
  createNewGame,
  createPerson,
  DISTANT_RELATIVE,
  healthCap,
  killPlayer,
  type Game,
} from "../src";
import { economicConfig, testCharacter, tinyGeography } from "./fixtures";

const geo = tinyGeography();

function setup(): Game {
  return createNewGame({ config: economicConfig(), character: testCharacter }, geo);
}

describe("aging", () => {
  it("health and survival odds decline with age", () => {
    expect(healthCap(30)).toBe(100);
    expect(healthCap(80)).toBeLessThan(50);
    expect(annualMortality(20, 100, "insurance")).toBeLessThan(0.001);
    expect(annualMortality(85, 100, "insurance")).toBeGreaterThan(0.03);
    expect(annualMortality(70, 20, "insurance")).toBeGreaterThan(
      annualMortality(70, 90, "insurance"),
    );
  });

  it("an old body can't stay at full health", () => {
    const game = setup();
    game.state.player.birthTime = addYears(game.state.time, -80);
    game.tick(24);
    expect(game.state.player.needs.health).toBeLessThanOrEqual(healthCap(80));
  });
});

describe("death and succession", () => {
  it("death stops the clock and blocks actions until an heir takes over", () => {
    const game = setup();
    game.state.player.cashCents = 500_000;
    killPlayer(game, "died suddenly");
    expect(game.state.player.alive).toBe(false);
    const time = game.state.time;
    game.tick(48);
    expect(game.state.time).toBe(time);
    expect(game.dispatch({ type: "activity.start", activityId: "sleep" }).ok).toBe(false);
    expect(game.state.succession!.heirs).toEqual([DISTANT_RELATIVE]);

    expect(game.dispatch({ type: "succession.choose", personId: DISTANT_RELATIVE }).ok).toBe(true);
    expect(game.state.player.alive).toBe(true);
    expect(game.state.player.lastName).toBe(testCharacter.lastName);
    expect(game.state.dynasty.generation).toBe(2);
    expect(game.state.dynasty.ancestors).toHaveLength(1);
    expect(game.state.player.cashCents).toBeLessThanOrEqual(500_000);
    game.tick(2);
    expect(game.state.time).toBe(time + 2);
  });

  it("an adult child inherits first", () => {
    const game = setup();
    const child = createPerson(game, { cityId: 0, minAge: 25, maxAge: 25, lastName: "Rivera" });
    game.state.player.relationships.push({
      personId: child.id,
      kind: "child",
      affection: 90,
      romance: 0,
      metAt: game.state.time,
      lastContact: game.state.time,
      context: "your child",
    });
    killPlayer(game, "died suddenly");
    expect(game.state.succession!.heirs[0]).toBe(child.id);
    expect(game.dispatch({ type: "succession.choose", personId: child.id }).ok).toBe(true);
    expect(game.state.player.firstName).toBe(child.firstName);
    expect(game.state.people.some((p) => p.id === child.id)).toBe(false);
  });

  it("autocrats pass power to their heirs; democrats don't", () => {
    for (const government of ["absoluteMonarchy", "democracy"] as const) {
      const game = setup();
      game.state.world.countries.AAA!.government = government;
      const head = game.state.politics.offices.find(
        (o) => o.kind === "headOfGovernment" && o.countryId === "AAA",
      )!;
      head.holders = ["player"];
      killPlayer(game, "died suddenly");
      game.dispatch({ type: "succession.choose", personId: DISTANT_RELATIVE });
      expect(head.holders.includes("player")).toBe(government === "absoluteMonarchy");
    }
  });
});
