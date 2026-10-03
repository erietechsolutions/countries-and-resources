import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createNewGame, generateWorld, validateConfig, type WorldGeography } from "../../packages/sim/src";

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data/geography/real-world.json");
const geo = JSON.parse(fs.readFileSync(file, "utf8")) as WorldGeography;

describe("real-world geography", () => {
  it("has consistent ids and references", () => {
    geo.provinces.forEach((p, i) => {
      expect(p.id).toBe(i);
      for (const n of p.neighbors) expect(geo.provinces[n]).toBeDefined();
    });
    geo.cities.forEach((c, i) => {
      expect(c.id).toBe(i);
      expect(geo.provinces[c.provinceId]!.countryId).toBe(c.countryId);
    });
    for (const country of geo.countries) {
      if (country.habitable) expect(country.capitalCityId).not.toBeNull();
    }
  });

  it("generates a full world quickly and deterministically", () => {
    const started = performance.now();
    const world = generateWorld(geo, 2026);
    expect(performance.now() - started).toBeLessThan(3000);
    expect(world.provinces).toHaveLength(geo.provinces.length);
    expect(world.cities).toHaveLength(geo.cities.length);
    const total = Object.values(world.countries).reduce((s, c) => s + c.population, 0);
    expect(total).toBeGreaterThan(1e9);
    expect(total).toBeLessThan(5e10);
    expect(generateWorld(geo, 2026).countries.FRA).toEqual(world.countries.FRA);
  });

  it("starts a Hard Economic game in a real city", () => {
    const city = geo.cities.find((c) => c.name === "Chicago")!;
    const config = {
      mode: "hardEconomic" as const,
      mapType: "real" as const,
      geographyId: geo.id,
      worldSeed: 5,
      startTime: Date.UTC(2026, 9, 3) / 3_600_000,
      startingCashCents: 0,
      startingHousing: "homeless" as const,
      startCityId: city.id,
    };
    expect(validateConfig(config, geo)).toEqual([]);
    const game = createNewGame(
      {
        config,
        character: {
          firstName: "Jo",
          lastName: "Doe",
          gender: "female",
          appearance: { skinTone: "Light", hairColor: "Brown", hairStyle: "Long", eyeColor: "Blue", build: "Slim" },
        },
      },
      geo,
    );
    expect(game.state.log[0]!.message).toContain("Chicago, United States of America");
  });
});
