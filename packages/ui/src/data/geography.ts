import { REAL_WORLD_GEOGRAPHY_ID, type MapType, type WorldGeography } from "@cr/sim";

const cache = new Map<string, Promise<WorldGeography>>();

/** Loads a static geography file from the data folder (served next to the game). */
export function loadGeography(id: string): Promise<WorldGeography> {
  let pending = cache.get(id);
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

export function geographyIdFor(mapType: MapType): string {
  if (mapType === "random") throw new Error("Random world maps are not available yet.");
  return REAL_WORLD_GEOGRAPHY_ID;
}
