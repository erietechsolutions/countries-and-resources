import type { Character } from "../character/character";
import type { GameContext } from "../core/game";
import { unitType } from "../economy/costs";
import type { NeedId, Needs } from "./types";

export const NEED_LABELS: Record<NeedId, string> = {
  food: "Food",
  energy: "Energy",
  hygiene: "Hygiene",
  health: "Health",
  happiness: "Happiness",
};

/** Hourly loss while awake and idle. Food empties in about a day, hygiene in two. */
export const BASE_DECAY = { food: -3.6, energy: -4.2, hygiene: -1.8 } as const;
export type DecayingNeed = keyof typeof BASE_DECAY;

export type Place = "home" | "shelter" | "street";

/** Where the player would sleep right now. */
export function restingPlace(ctx: GameContext): Place {
  const p = ctx.state.player;
  if (p.housing.kind !== "homeless") return "home";
  if ((p.shelterBedUntil ?? 0) > ctx.state.time) return "shelter";
  return "street";
}

/** Energy restored per hour of sleep. */
export function sleepRate(ctx: GameContext): number {
  const p = ctx.state.player;
  const place = restingPlace(ctx);
  if (place === "shelter") return 9.5;
  if (place === "street") return p.inventory.items.includes("sleepingBag") ? 8 : 6;
  return p.housing.kind === "renting" ? unitType(p.housing.unit).sleep : 11.5;
}

/** The happiness level the player drifts toward, given their circumstances. */
export function happinessTarget(p: Character): number {
  let target = 55;
  if (p.housing.kind === "parents") target += 3;
  else if (p.housing.kind === "renting") target += unitType(p.housing.unit).happiness;
  else target -= 20;
  if (p.job) target += 6;
  if (p.finance.debts.some((d) => d.kind === "collections")) target -= 6;
  for (const n of ["food", "energy", "hygiene"] as const) if (p.needs[n] < 25) target -= 8;
  if (p.needs.health < 40) target -= 8;
  return Math.max(5, Math.min(95, target));
}

export function clampNeeds(needs: Needs): void {
  for (const k of Object.keys(needs) as NeedId[]) needs[k] = Math.max(0, Math.min(100, needs[k]));
}

/**
 * One hour of needs: normal decay (scaled by what the player is doing), the activity's own
 * effects, then the knock-on effects on health and happiness.
 */
export function applyHourlyNeeds(
  ctx: GameContext,
  decayScale: Partial<Record<DecayingNeed, number>>,
  effects: Partial<Needs>,
): void {
  const p = ctx.state.player;
  const n = p.needs;
  for (const k of Object.keys(BASE_DECAY) as DecayingNeed[])
    n[k] += BASE_DECAY[k] * (decayScale[k] ?? 1);
  for (const [k, v] of Object.entries(effects) as [NeedId, number][]) n[k] += v;

  if (n.food <= 0) n.health -= 2.5;
  else if (n.food < 15) n.health -= 0.8;
  if (n.energy < 10) n.health -= 0.3;
  if (n.hygiene < 10) n.health -= 0.15;
  if (n.food > 40 && n.energy > 30 && n.hygiene > 25) n.health += 0.25;

  const target = happinessTarget(p);
  n.happiness += Math.sign(target - n.happiness) * Math.min(1.5, Math.abs(target - n.happiness));
  clampNeeds(n);
}
