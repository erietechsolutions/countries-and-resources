import type { Biome, Resource } from "./types";

/** "$1,234.56" or "$1,234" with wholeDollars. */
export function formatMoney(cents: number, wholeDollars = false): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = wholeDollars ? Math.round(abs / 100) : Math.floor(abs / 100);
  const body = dollars.toLocaleString("en-US");
  return wholeDollars ? `${sign}$${body}` : `${sign}$${body}.${String(abs % 100).padStart(2, "0")}`;
}

/** 1234 → "1.2K", 3400000 → "3.4M" */
export function formatCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e4) return `${Math.round(n / 1e3)}K`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

export function formatPercent(fraction: number, digits = 1): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

export const BIOME_LABELS: Record<Biome, string> = {
  polar: "Polar",
  tundra: "Tundra",
  boreal: "Boreal forest",
  temperate: "Temperate forest",
  grassland: "Grassland",
  mediterranean: "Mediterranean",
  steppe: "Steppe",
  desert: "Desert",
  savanna: "Savanna",
  tropical: "Tropical rainforest",
  mountains: "Mountains",
};

export const RESOURCE_LABELS: Record<Resource, string> = {
  farmland: "Farmland",
  livestock: "Livestock",
  timber: "Timber",
  fish: "Fish",
  oil: "Oil",
  gas: "Natural gas",
  coal: "Coal",
  iron: "Iron",
  copper: "Copper",
  gold: "Gold",
  uranium: "Uranium",
  rareEarths: "Rare earths",
};
