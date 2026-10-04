import type { GameState } from "../core/state";
import { courseById, type CredentialId } from "../education/courses";
import { itemById, type ItemId } from "../life/items";
import type { UnitType } from "../life/types";
import type { CityId, WorldGeography } from "../world/geography";
import type { CountryState } from "../world/types";

export const UNIT_TYPES: {
  id: UnitType;
  label: string;
  rentFactor: number;
  /** Energy restored per hour of sleep. */
  sleep: number;
  /** Happiness bonus from living here. */
  happiness: number;
}[] = [
  { id: "room", label: "Room in a shared apartment", rentFactor: 0.55, sleep: 11, happiness: 4 },
  { id: "studio", label: "Studio apartment", rentFactor: 0.82, sleep: 12, happiness: 8 },
  { id: "oneBed", label: "One-bedroom apartment", rentFactor: 1, sleep: 12.5, happiness: 11 },
  { id: "twoBed", label: "Two-bedroom apartment", rentFactor: 1.45, sleep: 12.5, happiness: 14 },
];

export function unitType(id: UnitType) {
  return UNIT_TYPES.find((u) => u.id === id)!;
}

/** The minimum of game state needed to look up places and prices. */
export interface WorldView {
  readonly state: GameState;
  readonly geography: WorldGeography;
}

export function countryOf(view: WorldView, cityId: CityId): CountryState {
  const geoCity = view.geography.cities[cityId];
  const country = geoCity && view.state.world.countries[geoCity.countryId];
  if (!country) throw new Error(`No country for city ${cityId}`);
  return country;
}

export interface CityCosts {
  /** Groceries for one home-cooked meal. */
  mealCents: number;
  fastFoodCents: number;
  /** Gym or public shower day pass. */
  showerCents: number;
  medianWageCents: number;
  minimumWageCents: number;
  rentCents(unit: UnitType): number;
  itemCents(item: ItemId): number;
  tuitionCents(course: CredentialId): number;
}

/** Everyday prices in a city, derived from its (continually updated) cost of living and wages. */
export function cityCosts(view: WorldView, cityId: CityId): CityCosts {
  const city = view.state.world.cities[cityId];
  if (!city) throw new Error(`Unknown city ${cityId}`);
  const meal = Math.max(10, Math.round((city.livingCostCents * 0.33) / 90));
  const wage = Math.max(10, city.medianWageCents);
  return {
    mealCents: meal,
    fastFoodCents: Math.round(meal * 3.2),
    showerCents: Math.round(meal * 3),
    medianWageCents: wage,
    // A local minimum wage (set by city or regional government) can exceed the national one.
    minimumWageCents: Math.max(
      countryOf(view, cityId).minimumWageCents,
      Math.round(wage * localMinimumWage(view, cityId)),
    ),
    rentCents: (unit) =>
      Math.max(100, Math.round((city.rentCents * unitType(unit).rentFactor) / 100) * 100),
    itemCents: (item) => Math.round(wage * itemById(item).priceWageMultiple),
    tuitionCents: (course) => Math.round(wage * (courseById(course)?.tuitionWageMultiple ?? 0)),
  };
}

function localMinimumWage(view: WorldView, cityId: CityId): number {
  const all = view.state.politics?.localPolicies;
  if (!all) return 0;
  const province = view.geography.cities[cityId]?.provinceId;
  return Math.max(
    all[`city:${cityId}`]?.localMinimumWage ?? 0,
    all[`region:${province}`]?.localMinimumWage ?? 0,
  );
}
