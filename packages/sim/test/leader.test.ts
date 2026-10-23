import { describe, expect, it } from "vitest";
import {
  addDays,
  ageInYears,
  createNewGame,
  createSaveFile,
  Game,
  parseSave,
  playerRuledCountry,
  serializeSave,
  transferProvince,
  validateConfig,
} from "../src";
import { economicConfig, testCharacter, tinyGeography } from "./fixtures";

const geo = tinyGeography();
const DAY = 24;

function leaderGame(startCityId = 1): Game {
  return createNewGame(
    {
      config: economicConfig({
        mode: "leader",
        startingCashCents: 0,
        startingHousing: "parents",
        startCityId,
      }),
      character: testCharacter,
    },
    geo,
  );
}

describe("leader mode", () => {
  it("is a valid mode with its own fixed starting conditions", () => {
    expect(validateConfig(economicConfig({ mode: "leader", startingCashCents: 0 }), geo)).toEqual(
      [],
    );
    expect(validateConfig(economicConfig({ mode: "leader" }), geo)).not.toEqual([]);
  });

  it("starts the player as head of government, in the capital, with no family", () => {
    const game = leaderGame(1);
    expect(playerRuledCountry(game)).toBe("AAA");
    expect(game.state.player.cityId).toBe(0);
    expect(game.state.config.startCityId).toBe(0);
    expect(ageInYears(game.state.player.birthTime, game.state.time)).toBe(50);
    expect(game.state.family).toEqual([]);
    expect(game.state.reign?.countryId).toBe("AAA");
    expect(game.state.reign?.start.population).toBeGreaterThan(0);
  });

  it("leaves daily life out: needs don't change", () => {
    const game = leaderGame();
    const before = { ...game.state.player.needs };
    game.tick(5 * DAY);
    expect(game.state.player.needs.food).toBe(before.food);
    expect(game.state.player.needs.hygiene).toBe(before.hygiene);
    expect(game.dispatch({ type: "military.spending", level: 0.75 }).ok).toBe(true);
  });

  it("approval follows how the country is doing", () => {
    const run = (wellbeing: number) => {
      const game = leaderGame();
      const country = game.state.world.countries.AAA!;
      country.stability = wellbeing;
      for (const pop of country.pops) pop.satisfaction = wellbeing;
      game.state.player.politics.approval = 50;
      game.tick(70 * DAY);
      return game.state.player.politics.approval;
    };
    expect(run(100)).toBeGreaterThan(run(10) + 20);
  });

  it("a sitting president is put on the ballot", () => {
    const game = leaderGame();
    const country = game.state.world.countries.AAA!;
    country.government = "democracy";
    country.headOfStateTitle = "President";
    const head = game.state.politics.offices.find((o) => o.kind === "headOfGovernment")!;
    head.nextElection = addDays(game.state.time, 30);
    game.tick(3 * DAY);
    const election = game.state.politics.elections.find((e) => e.officeId === head.id);
    expect(election).toBeDefined();
    expect(game.state.player.politics.candidacy?.electionId).toBe(election!.id);
  });

  it("losing the country ends the rule", () => {
    const game = leaderGame();
    transferProvince(game, 0, "BBB");
    transferProvince(game, 1, "BBB");
    game.state.world.countries.AAA!.population = 0;
    const head = game.state.politics.offices.find(
      (o) => o.kind === "headOfGovernment" && o.countryId === "AAA",
    );
    if (head) head.holders = ["someone-else"];
    game.tick(2 * DAY);
    expect(game.state.reign?.endedAt).not.toBeNull();
    expect(game.state.reign?.endReason).toMatch(/conquered/);
  });

  it("resumes from a save still without daily life", () => {
    const game = leaderGame();
    const loaded = new Game(
      parseSave(serializeSave(createSaveFile(game.state, game.geography, "now"))).state,
      geo,
    );
    const food = loaded.state.player.needs.food;
    loaded.tick(2 * DAY);
    expect(loaded.state.player.needs.food).toBe(food);
    expect(playerRuledCountry(loaded)).toBe("AAA");
  });
});
