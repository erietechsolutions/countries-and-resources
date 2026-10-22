import { describe, expect, it } from "vitest";
import {
  attackTargets,
  createNewGame,
  createSaveFile,
  foundInsurgentCountry,
  Game,
  militaryOf,
  militiaBlocker,
  militiaIndependenceRequirements,
  parseSave,
  playerRuledCountry,
  relation,
  serializeSave,
  startWar,
  transferProvince,
  warsOf,
  type Command,
} from "../src";
import { economicConfig, testCharacter, tinyGeography } from "./fixtures";

const geo = tinyGeography();
const DAY = 24;

function setup(): Game {
  const game = createNewGame({ config: economicConfig(), character: testCharacter }, geo);
  game.state.player.cashCents = 1_000_000_000;
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
    n.health = Math.max(n.health, 80);
    game.tick();
  }
}

/** A militia strong enough to win any fight on the tiny map. */
function strongMilitia(game: Game) {
  game.state.player.reputation.activists = 40;
  run(game, { type: "militia.found", name: "Northern Guard" });
  const m = game.state.conflict.militia!;
  m.fighters = 200_000;
  m.equipment = 100;
  m.training = 100;
  m.morale = 100;
  return m;
}

function makeRuler(game: Game, countryId = "AAA") {
  const head = game.state.politics.offices.find(
    (o) => o.kind === "headOfGovernment" && o.countryId === countryId,
  )!;
  head.holders = ["player"];
}

describe("territory", () => {
  it("moves provinces between countries without touching the shared map", () => {
    const game = setup();
    transferProvince(game, 1, "BBB");
    expect(game.geography.provinces[1]!.countryId).toBe("BBB");
    expect(game.geography.cities[1]!.countryId).toBe("BBB");
    expect(game.geography.countries.find((c) => c.id === "BBB")!.provinceIds).toContain(1);
    // The cached map other games load stays as it was.
    expect(geo.provinces[1]!.countryId).toBe("AAA");
  });

  it("borders and capitals survive a save and reload", () => {
    const game = setup();
    transferProvince(game, 0, "BBB");
    const capital = game.geography.countries.find((c) => c.id === "AAA")!.capitalCityId;
    expect(capital).toBe(1);
    const loaded = parseSave(serializeSave(createSaveFile(game.state, game.geography, "now")));
    const again = new Game(loaded.state, geo);
    expect(again.geography.provinces[0]!.countryId).toBe("BBB");
    expect(again.geography.countries.find((c) => c.id === "AAA")!.capitalCityId).toBe(capital);
  });

  it("the player's legal status follows when their home changes hands", () => {
    const game = setup();
    transferProvince(game, 0, "BBB");
    expect(game.state.player.residency.countryId).toBe("BBB");
    expect(game.state.player.residency.status).toBe("permanent");
  });
});

describe("militias", () => {
  it("needs a following and money to start", () => {
    const game = setup();
    expect(militiaBlocker(game)).toMatch(/reputation/);
    game.state.player.reputation.underworld = 35;
    expect(militiaBlocker(game)).toBeNull();
  });

  it("can seize its home region, and then declare a new country", () => {
    const game = setup();
    strongMilitia(game);
    expect(attackTargets(game)).toEqual([0]);
    run(game, { type: "militia.attack", provinceId: 0, lead: false });
    tickSafely(game, 4 * DAY);
    const m = game.state.conflict.militia!;
    expect(m.held.map((h) => h.provinceId)).toEqual([0]);
    expect(attackTargets(game)).toEqual([1]);

    expect(militiaIndependenceRequirements(game).every((r) => r.met)).toBe(false);
    m.held[0]!.since -= 40 * DAY;
    expect(militiaIndependenceRequirements(game).every((r) => r.met)).toBe(true);
    run(game, { type: "nation.declare", name: "Nordland", government: "democracy" });

    const id = playerRuledCountry(game)!;
    expect(game.geography.countries.find((c) => c.id === id)!.name).toBe("Nordland");
    expect(game.geography.provinces[0]!.countryId).toBe(id);
    expect(game.state.player.citizenship).toContain(id);
    expect(game.state.conflict.militia).toBeNull();
    expect(game.state.world.countries[id]!.population).toBeGreaterThan(0);
    // The old country keeps going from its other region, with a new capital.
    expect(game.geography.countries.find((c) => c.id === "AAA")!.capitalCityId).toBe(1);
  });

  it("refuses to declare independence before holding territory", () => {
    const game = setup();
    strongMilitia(game);
    expect(
      game.dispatch({ type: "nation.declare", name: "Nope", government: "democracy" }).ok,
    ).toBe(false);
  });
});

describe("war and diplomacy", () => {
  it("only heads of government conduct diplomacy", () => {
    const game = setup();
    expect(game.dispatch({ type: "war.declare", countryId: "BBB" }).ok).toBe(false);
    makeRuler(game);
    run(game, { type: "diplomacy.improve", countryId: "BBB" });
    expect(game.dispatch({ type: "diplomacy.improve", countryId: "BBB" }).ok).toBe(false);
  });

  it("a much stronger army conquers its neighbor", () => {
    const game = setup();
    makeRuler(game);
    game.state.player.politics.approval = 80;
    run(game, { type: "war.declare", countryId: "BBB" });
    const war = warsOf(game, "AAA")[0]!;
    expect(war.claims).toEqual([2]);
    expect(relation(game, "AAA", "BBB")).toBeLessThan(0);
    const army = militaryOf(game.state.world.countries.AAA!);
    army.troops = 10_000_000;
    army.quality = 1;
    militaryOf(game.state.world.countries.BBB!).troops = 10;
    tickSafely(game, 30 * DAY);
    expect(war.status).toBe("ended");
    expect(game.geography.provinces[2]!.countryId).toBe("AAA");
    expect(game.state.world.countries.BBB!.population).toBe(0);
  });

  it("peace ends a war, and the loser keeps unclaimed land", () => {
    const game = setup();
    makeRuler(game);
    game.state.player.politics.approval = 80;
    run(game, { type: "war.declare", countryId: "BBB" });
    const war = warsOf(game, "AAA")[0]!;
    militaryOf(game.state.world.countries.BBB!).exhaustion = 90;
    run(game, { type: "war.peace", warId: war.id });
    expect(war.status).toBe("ended");
    expect(game.geography.provinces[2]!.countryId).toBe("BBB");
  });

  it("democracies won't go to war behind an unpopular leader", () => {
    const game = setup();
    makeRuler(game);
    game.state.world.countries.AAA!.government = "democracy";
    game.state.player.politics.approval = 20;
    const result = game.dispatch({ type: "war.declare", countryId: "BBB" });
    expect(result.ok).toBe(false);
  });

  it("allies join defensive wars", () => {
    const game = setup();
    game.state.conflict.alliances.push("AAA|ICE");
    const war = startWar(game, "BBB", "AAA", "conquest", [1]);
    // Iceshelf has no people, but alliances are still honored often.
    expect(war.defenders[0]).toBe("AAA");
    expect(war.attackers).toEqual(["BBB"]);
  });
});

describe("uprisings", () => {
  it("a rebel movement can become a country", () => {
    const game = setup();
    foundInsurgentCountry(game, {
      id: "i1",
      name: "South A Liberation Front",
      countryId: "AAA",
      fighters: 800,
      quality: 0.5,
      held: [1],
      since: game.state.time,
    });
    const founded = game.state.world.foundedCountries!;
    expect(founded).toHaveLength(1);
    expect(game.geography.provinces[1]!.countryId).toBe(founded[0]!.id);
  });
});
