import type { Character } from "../character/character";
import type { GameContext } from "../core/game";
import { unitType } from "../economy/costs";
import { ageInYears } from "../core/calendar";
import { socialHappiness } from "../social/social";
import { healthCap } from "./aging";
import { lifestyleDef } from "./lifestyle";
import type { NeedId, Needs } from "./types";

/**
 * Daily survival (eating, sleeping, washing) is not part of the game: the player's living
 * standard takes care of it. Food and energy stay topped up, "hygiene" stands for how presentable
 * the player is (it matters to employers), and health drifts toward what their living conditions
 * allow.
 */
export const NEED_LABELS: Record<NeedId, string> = {
  food: "Food",
  energy: "Energy",
  hygiene: "Presentation",
  health: "Health",
  happiness: "Happiness",
};

export type Place = "home" | "shelter" | "street";

/** Where the player sleeps tonight. */
export function restingPlace(ctx: GameContext): Place {
  const p = ctx.state.player;
  if (p.housing.kind !== "homeless") return "home";
  if ((p.shelterBedUntil ?? 0) > ctx.state.time) return "shelter";
  return "street";
}

export interface LivingConditions {
  /** The health the player's body settles at. */
  health: number;
  /** How presentable they are, 0–100. */
  presentation: number;
  /** Happiness bonus or penalty from the standard of living. */
  happiness: number;
}

/** What the player's lifestyle and housing add up to. Going without makes everything worse. */
export function livingConditions(ctx: GameContext): LivingConditions {
  const p = ctx.state.player;
  const style = lifestyleDef(p.lifestyle);
  let health = style.health;
  let presentation = style.presentation;
  const place = restingPlace(ctx);
  if (place === "street") {
    health -= p.inventory.items.includes("sleepingBag") ? 12 : 20;
    presentation -= 35;
  } else if (place === "shelter") {
    health -= 6;
    presentation -= 15;
  }
  if (p.inventory.items.includes("interviewClothes")) presentation += 8;
  if (p.daily.wentWithout) {
    health -= 40;
    presentation -= 20;
  }
  const cap = healthCap(ageInYears(p.birthTime, ctx.state.time));
  return {
    health: Math.max(10, Math.min(cap, health)),
    presentation: Math.max(0, Math.min(100, presentation)),
    happiness: style.happiness - (p.daily.wentWithout ? 12 : 0),
  };
}

/** The happiness level the player drifts toward, given their circumstances. */
export function happinessTarget(p: Character, conditions: LivingConditions): number {
  let target = 55 + conditions.happiness;
  if (p.housing.kind === "parents") target += 3;
  else if (p.housing.kind === "renting") target += unitType(p.housing.unit).happiness;
  else target -= 20;
  if (p.job) target += 6;
  if (p.finance.debts.some((d) => d.kind === "collections")) target -= 6;
  if (p.needs.health < 40) target -= 8;
  target += socialHappiness(p);
  return Math.max(5, Math.min(95, target));
}

export function clampNeeds(needs: Needs): void {
  for (const k of Object.keys(needs) as NeedId[]) needs[k] = Math.max(0, Math.min(100, needs[k]));
}

/**
 * One hour of living: the activity's effects on health and happiness, then health and happiness
 * drift toward what the player's circumstances support.
 */
export function applyHourlyNeeds(ctx: GameContext, effects: Partial<Needs>): void {
  const p = ctx.state.player;
  const n = p.needs;
  const conditions = livingConditions(ctx);
  n.food = 80;
  n.energy = 80;
  n.hygiene = conditions.presentation;
  n.health += effects.health ?? 0;
  n.happiness += effects.happiness ?? 0;
  // Health recovers slowly and declines a little faster.
  n.health += Math.max(-0.1, Math.min(0.06, conditions.health - n.health));
  const target = happinessTarget(p, conditions);
  n.happiness += Math.sign(target - n.happiness) * Math.min(1.5, Math.abs(target - n.happiness));
  clampNeeds(n);
}
