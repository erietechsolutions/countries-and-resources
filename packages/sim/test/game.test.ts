import { describe, expect, it } from "vitest";
import {
  ageInYears,
  createNewGame,
  createSaveFile,
  Game,
  generateWorld,
  MODES,
  NewGameError,
  parseSave,
  serializeSave,
  SaveError,
  toDateParts,
  validateConfig,
} from "../src";
import { economicConfig, testCharacter, tinyGeography } from "./fixtures";

const geo = tinyGeography();

describe("game modes", () => {
  it("shows Normal mode but keeps it unavailable", () => {
    expect(MODES.normal.available).toBe(false);
    expect(MODES.normal.unavailableLabel).toBe("Coming Soon");
    expect(validateConfig(economicConfig({ mode: "normal" }), geo)).toContain(
      "Normal mode is not available yet.",
    );
  });

  it("accepts every Economic mode combination on the real map", () => {
    for (const cash of [0, 200_000]) {
      for (const housing of ["parents", "homeless"] as const) {
        expect(
          validateConfig(
            economicConfig({ startingCashCents: cash, startingHousing: housing }),
            geo,
          ),
        ).toEqual([]);
      }
    }
  });

  it("locks Hard Economic to $0, homeless and the real map", () => {
    const hard = MODES.hardEconomic;
    expect(hard.startingCash.map((o) => o.value)).toEqual([0]);
    expect(hard.startingHousing.map((o) => o.value)).toEqual(["homeless"]);
    expect(hard.mapTypes.map((o) => o.value)).toEqual(["real"]);

    const valid = economicConfig({
      mode: "hardEconomic",
      startingCashCents: 0,
      startingHousing: "homeless",
    });
    expect(validateConfig(valid, geo)).toEqual([]);
    expect(validateConfig({ ...valid, startingCashCents: 200_000 }, geo)).not.toEqual([]);
    expect(validateConfig({ ...valid, startingHousing: "parents" }, geo)).not.toEqual([]);
    expect(validateConfig({ ...valid, mapType: "random" }, geo)).not.toEqual([]);
  });

  it("offers Random World in Economic mode but marks it Coming Soon for now", () => {
    const random = MODES.economic.mapTypes.find((o) => o.value === "random");
    expect(random?.available).toBe(false);
    expect(validateConfig(economicConfig({ mapType: "random" }), geo)).not.toEqual([]);
  });

  it("rejects uninhabitable or missing start cities", () => {
    expect(validateConfig(economicConfig({ startCityId: 99 }), geo)).toContain(
      "Starting city does not exist.",
    );
  });
});

describe("world generation", () => {
  it("is deterministic for a seed and differs between seeds", () => {
    expect(generateWorld(geo, 1)).toEqual(generateWorld(geo, 1));
    expect(generateWorld(geo, 1)).not.toEqual(generateWorld(geo, 2));
  });

  it("produces sane values", () => {
    const world = generateWorld(geo, 99);
    const a = world.countries.AAA!;
    expect(a.population).toBeGreaterThan(0);
    expect(world.countries.ICE!.population).toBe(0);
    expect(a.parties.reduce((s, p) => s + p.popularity, 0)).toBeCloseTo(a.parties.length ? 1 : 0);
    if (a.rulingPartyId) expect(a.parties.some((p) => p.id === a.rulingPartyId)).toBe(true);
    for (const city of world.cities) {
      expect(city.rentCents).toBeGreaterThan(0);
      expect(city.medianWageCents).toBeGreaterThan(0);
    }
    const provincePop = world.provinces
      .filter((p) => geo.provinces[p.id]!.countryId === "AAA")
      .reduce((s, p) => s + p.population, 0);
    expect(Math.abs(provincePop - a.population)).toBeLessThanOrEqual(2);
  });
});

describe("new game", () => {
  it("creates an 18-year-old with the chosen cash and housing", () => {
    const game = createNewGame(
      {
        config: economicConfig({ startingCashCents: 0, startingHousing: "homeless" }),
        character: testCharacter,
      },
      geo,
    );
    const p = game.state.player;
    expect(ageInYears(p.birthTime, game.time)).toBe(18);
    expect(p.cashCents).toBe(0);
    expect(p.housing).toBe("homeless");
    expect(p.citizenship).toEqual(["AAA"]);
    expect(toDateParts(game.time)).toMatchObject({ year: 2026, month: 10, day: 3, hour: 8 });
    expect(game.state.log.at(-1)?.message).toContain("streets of Acity");
  });

  it("refuses invalid setups with readable problems", () => {
    expect(() =>
      createNewGame(
        {
          config: economicConfig({ mode: "hardEconomic" }),
          character: { ...testCharacter, firstName: " " },
        },
        geo,
      ),
    ).toThrow(NewGameError);
  });
});

describe("game loop", () => {
  it("emits day, month and year boundaries", () => {
    const game = createNewGame(
      {
        config: economicConfig({ startTime: Date.UTC(2026, 11, 31) / 3_600_000 }),
        character: testCharacter,
      },
      geo,
    );
    const seen: string[] = [];
    game.events.on("day", () => seen.push("day"));
    game.events.on("month", () => seen.push("month"));
    game.events.on("year", () => seen.push("year"));
    game.tick(16); // 8 AM Dec 31 → midnight Jan 1
    expect(seen).toEqual(["day", "month", "year"]);
    expect(game.state.log.at(-1)?.message).toBe("Welcome to 2027.");
  });

  it("validates and applies commands", () => {
    const game = createNewGame({ config: economicConfig(), character: testCharacter }, geo);
    expect(game.dispatch({ type: "debug.grantCash", amountCents: 500 })).toEqual({ ok: true });
    expect(game.state.player.cashCents).toBe(200_500);
    expect(game.dispatch({ type: "debug.grantCash", amountCents: 1.5 }).ok).toBe(false);
  });

  it("produces identical results when replayed from a save", () => {
    const game = createNewGame({ config: economicConfig(), character: testCharacter }, geo);
    game.tick(100);
    const save = parseSave(serializeSave(createSaveFile(game.state, geo, "2026-10-03T00:00:00Z")));
    const copy = new Game(save.state, geo);
    game.tick(500);
    copy.tick(500);
    expect(copy.state).toEqual(game.state);
  });
});

describe("saves", () => {
  it("round-trips with a summary", () => {
    const game = createNewGame({ config: economicConfig(), character: testCharacter }, geo);
    const save = parseSave(serializeSave(createSaveFile(game.state, geo, "2026-10-03T00:00:00Z")));
    expect(save.state).toEqual(game.state);
    expect(save.summary).toMatchObject({ characterName: "Sam Rivera", location: "Acity, Aland" });
  });

  it("rejects files that are not saves or are from newer versions", () => {
    expect(() => parseSave("not json")).toThrow(SaveError);
    expect(() => parseSave(JSON.stringify({ format: "other" }))).toThrow(SaveError);
    expect(() =>
      parseSave(
        JSON.stringify({ format: "countries-and-resources-save", version: 999, state: {} }),
      ),
    ).toThrow(/newer version/);
  });

  it("refuses to load a save onto a different map", () => {
    const game = createNewGame({ config: economicConfig(), character: testCharacter }, geo);
    expect(() => new Game(game.state, { ...geo, id: "other" })).toThrow(/map/);
  });
});
