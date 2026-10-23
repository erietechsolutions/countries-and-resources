import type { GameContext } from "../core/game";
import type { System } from "../core/systems";
import { transact } from "../finance/finance";

/**
 * Living standards replace day-to-day survival: food, clothes, transport and comforts are one
 * daily cost, set by how well the player chooses (and can afford) to live.
 */
export type Lifestyle = "frugal" | "modest" | "comfortable" | "luxury";

export interface LifestyleDef {
  id: Lifestyle;
  label: string;
  description: string;
  /** Monthly cost as a multiple of the city's basic living costs. */
  costFactor: number;
  /** Health the player settles at (before age and housing). */
  health: number;
  /** How presentable the player is to employers and voters. */
  presentation: number;
  happiness: number;
}

export const LIFESTYLES: LifestyleDef[] = [
  {
    id: "frugal",
    label: "Frugal",
    description: "Cheap food, secondhand clothes, no extras. Saves money, wears you down.",
    costFactor: 0.6,
    health: 75,
    presentation: 50,
    happiness: -6,
  },
  {
    id: "modest",
    label: "Modest",
    description: "A normal life: decent food, clean clothes, the odd night out.",
    costFactor: 1,
    health: 88,
    presentation: 72,
    happiness: 0,
  },
  {
    id: "comfortable",
    label: "Comfortable",
    description: "Good food, a gym membership, nice clothes and holidays.",
    costFactor: 1.8,
    health: 95,
    presentation: 86,
    happiness: 6,
  },
  {
    id: "luxury",
    label: "Luxury",
    description: "Private chefs, tailored suits, the best of everything.",
    costFactor: 4,
    health: 100,
    presentation: 100,
    happiness: 12,
  },
];

export function lifestyleDef(id: Lifestyle): LifestyleDef {
  return LIFESTYLES.find((l) => l.id === id) ?? LIFESTYLES[1]!;
}

/** Daily cost of a lifestyle where the player lives. People without a home spend less. */
export function lifestyleDailyCost(ctx: GameContext, id: Lifestyle): number {
  const p = ctx.state.player;
  const city = ctx.state.world.cities[p.cityId];
  const monthly = (city?.livingCostCents ?? 0) * lifestyleDef(id).costFactor;
  const homeless = p.housing.kind === "homeless" ? 0.6 : 1;
  // Living with parents: they cover part of the basics.
  const parents = p.housing.kind === "parents" ? 0.6 : 1;
  return Math.round((monthly / 30) * homeless * parents);
}

export function setLifestyle(ctx: GameContext, id: Lifestyle): string | null {
  if (!LIFESTYLES.some((l) => l.id === id)) return "Unknown lifestyle.";
  ctx.state.player.lifestyle = id;
  ctx.log("life", `You switched to a ${lifestyleDef(id).label.toLowerCase()} lifestyle.`);
  return null;
}

/** Pays for the day. If the money runs out, the player has to live more cheaply. */
export const lifestyleSystem: System = {
  id: "lifestyle",
  onDay(ctx) {
    const p = ctx.state.player;
    if (!p.alive) return;
    p.daily.wentWithout = false;
    let style = p.lifestyle;
    let cost = lifestyleDailyCost(ctx, style);
    while (cost > p.cashCents && style !== "frugal") {
      style = LIFESTYLES[LIFESTYLES.findIndex((l) => l.id === style) - 1]!.id;
      cost = lifestyleDailyCost(ctx, style);
    }
    if (style !== p.lifestyle) {
      p.lifestyle = style;
      ctx.alert(
        "bad",
        `You can't afford your lifestyle. You're living ${lifestyleDef(style).label.toLowerCase()} now.`,
        "money",
      );
    }
    if (cost > p.cashCents) {
      // Not even the basics: food banks, skipped meals, the same clothes every day.
      p.daily.wentWithout = true;
      if (p.cashCents > 0) transact(ctx, -p.cashCents, "food", "Getting by");
      return;
    }
    if (cost > 0)
      transact(ctx, -cost, "food", `Living costs (${lifestyleDef(style).label.toLowerCase()})`);
  },
};
