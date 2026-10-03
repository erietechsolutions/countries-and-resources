import { describe, expect, it } from "vitest";
import {
  createNewGame,
  generateRandomGeography,
  isRandomGeographyId,
  randomGeographyId,
  seedOfRandomGeography,
  validateConfig,
} from "../src";
import { economicConfig, testCharacter } from "./fixtures";

describe("random world maps", () => {
  const geo = generateRandomGeography(123);

  it("are deterministic and identified by their seed", () => {
    expect(generateRandomGeography(123)).toEqual(geo);
    expect(generateRandomGeography(124).countries[0]!.name).not.toBe(geo.countries[0]!.name);
    expect(geo.id).toBe(randomGeographyId(123));
    expect(isRandomGeographyId(geo.id)).toBe(true);
    expect(seedOfRandomGeography(geo.id)).toBe(123);
  });

  it("have consistent countries, provinces and cities", () => {
    expect(geo.countries.length).toBeGreaterThan(30);
    expect(geo.provinces.length).toBeGreaterThan(1000);
    const countryIds = new Set(geo.countries.map((c) => c.id));
    expect(countryIds.size).toBe(geo.countries.length);
    geo.provinces.forEach((p, i) => {
      expect(p.id).toBe(i);
      expect(countryIds.has(p.countryId)).toBe(true);
      for (const n of p.neighbors) expect(geo.provinces[n]!.neighbors).toContain(i);
    });
    for (const c of geo.countries) {
      expect(c.capitalCityId).not.toBeNull();
      expect(geo.cities[c.capitalCityId!]!.countryId).toBe(c.id);
    }
    geo.cities.forEach((c, i) => {
      expect(c.id).toBe(i);
      expect(geo.provinces[c.provinceId]!.countryId).toBe(c.countryId);
    });
    expect(new Set(geo.cities.map((c) => c.name)).size).toBe(geo.cities.length);
  });

  it("can host a new game", () => {
    const config = economicConfig({
      mapType: "random",
      geographyId: geo.id,
      worldSeed: 123,
      startCityId: 0,
    });
    expect(validateConfig(config, geo)).toEqual([]);
    const game = createNewGame({ config, character: testCharacter }, geo);
    game.tick(24 * 40);
    expect(game.state.world.companies.length).toBeGreaterThan(0);
  });
});
