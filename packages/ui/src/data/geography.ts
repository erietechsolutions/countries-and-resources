import {
  generateRandomGeography,
  isRandomGeographyId,
  randomGeographyId,
  REAL_WORLD_GEOGRAPHY_ID,
  seedOfRandomGeography,
  type MapType,
  type WorldGeography,
} from "@cr/sim";

const cache = new Map<string, Promise<WorldGeography>>();

/** Loads a static geography file from the data folder (served next to the game). */
export function loadGeography(id: string): Promise<WorldGeography> {
  let pending = cache.get(id);
  if (!pending && isRandomGeographyId(id)) {
    // Generated maps are rebuilt from their seed (deterministic), never downloaded or saved.
    pending = new Promise((resolve) => setTimeout(() => resolve(generateRandomGeography(seedOfRandomGeography(id))), 0));
    // Keep only the most recent generated map in memory.
    for (const key of cache.keys()) if (isRandomGeographyId(key)) cache.delete(key);
    cache.set(id, pending);
  }
  if (!pending) {
    pending = fetch(`./geography/${id}.json`).then(async (res) => {
      if (!res.ok) throw new Error(`Could not load map "${id}" (${res.status}).`);
      return (await res.json()) as WorldGeography;
    });
    pending.catch(() => cache.delete(id));
    cache.set(id, pending);
  }
  return pending;
}

export function geographyIdFor(mapType: MapType, seed: number): string {
  return mapType === "random" ? randomGeographyId(seed) : REAL_WORLD_GEOGRAPHY_ID;
}
