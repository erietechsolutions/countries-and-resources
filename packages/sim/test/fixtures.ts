import type { CharacterInput, GameConfig, WorldGeography } from "../src";

const square = (x: number, y: number, s = 10) => [[[x, y, x + s, y, x + s, y + s, x, y + s]]];

/** A tiny three-country map for fast, readable tests. */
export function tinyGeography(): WorldGeography {
  return {
    id: "tiny",
    name: "Tiny",
    width: 40,
    height: 20,
    countries: [
      { id: "AAA", name: "Aland", provinceIds: [0, 1], capitalCityId: 0, habitable: true },
      { id: "BBB", name: "Bland", provinceIds: [2], capitalCityId: 2, habitable: true },
      { id: "ICE", name: "Iceshelf", provinceIds: [3], capitalCityId: null, habitable: false },
    ],
    provinces: [
      { id: 0, name: "North A", countryId: "AAA", lat: 45, lon: 0, areaKm2: 50_000, coastal: true, neighbors: [1], label: [5, 5], bbox: [0, 0, 10, 10], polygons: square(0, 0) },
      { id: 1, name: "South A", countryId: "AAA", lat: 40, lon: 0, areaKm2: 30_000, coastal: false, neighbors: [0, 2], label: [15, 5], bbox: [10, 0, 20, 10], polygons: square(10, 0) },
      { id: 2, name: "Bland", countryId: "BBB", lat: 20, lon: 10, areaKm2: 80_000, coastal: true, neighbors: [1], label: [25, 5], bbox: [20, 0, 30, 10], polygons: square(20, 0) },
      { id: 3, name: "Ice", countryId: "ICE", lat: -80, lon: 0, areaKm2: 900_000, coastal: true, neighbors: [], label: [5, 15], bbox: [0, 10, 10, 20], polygons: square(0, 10) },
    ],
    cities: [
      { id: 0, name: "Acity", provinceId: 0, countryId: "AAA", x: 5, y: 5, capital: 2, importance: 6 },
      { id: 1, name: "Atown", provinceId: 1, countryId: "AAA", x: 15, y: 5, capital: 0, importance: 4 },
      { id: 2, name: "Bcity", provinceId: 2, countryId: "BBB", x: 25, y: 5, capital: 2, importance: 5.5 },
    ],
    borders: { country: [], province: [], coast: [] },
  };
}

export function economicConfig(overrides: Partial<GameConfig> = {}): GameConfig {
  return {
    mode: "economic",
    mapType: "real",
    geographyId: "tiny",
    worldSeed: 12345,
    startTime: Date.UTC(2026, 9, 3) / 3_600_000,
    startingCashCents: 200_000,
    startingHousing: "parents",
    startCityId: 0,
    ...overrides,
  };
}

export const testCharacter: CharacterInput = {
  firstName: "Sam",
  lastName: "Rivera",
  gender: "nonbinary",
  appearance: {
    skinTone: "Medium",
    hairColor: "Black",
    hairStyle: "Short",
    eyeColor: "Brown",
    build: "Average",
  },
};
