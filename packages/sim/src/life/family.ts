import { randomName } from "../character/names";
import type { GameContext } from "../core/game";
import { isWorking } from "../finance/income";
import type { Rng } from "../core/rng";
import type { System } from "../core/systems";
import type { CityId } from "../world/geography";
import type { FamilyMember, Personality } from "./types";

const PERSONALITY_LABELS: Record<Personality, string> = {
  supportive: "Supportive",
  easygoing: "Easygoing",
  strict: "Strict",
};

export function personalityLabel(p: Personality): string {
  return PERSONALITY_LABELS[p];
}

/**
 * Generates the player's parents. Players who start homeless are estranged from them: the
 * relationship starts low and has to be rebuilt before moving back home is possible.
 */
export function generateFamily(
  lastName: string,
  cityId: CityId,
  estranged: boolean,
  rng: Rng,
): FamilyMember[] {
  const wealth = Math.max(0.35, Math.min(2.6, Math.exp(rng.normal(0, 0.4))));
  const members: FamilyMember[] = [];
  const count = rng.chance(0.3) ? 1 : 2;
  const relations: FamilyMember["relation"][] =
    count === 1 ? [rng.pick(["mother", "father"])] : ["mother", "father"];
  relations.forEach((relation, i) => {
    const gender = relation === "mother" ? "female" : "male";
    const personality = rng.weighted<Personality>([
      ["supportive", 4],
      ["easygoing", 3],
      ["strict", 3],
    ]);
    const base = estranged ? rng.int(5, 25) : rng.int(55, 80);
    members.push({
      id: `parent${i + 1}`,
      firstName: randomName(gender, rng).firstName,
      lastName,
      relation,
      personality,
      relationship: base,
      wealth: Math.round(wealth * 100) / 100,
      cityId,
    });
  });
  return members;
}

export function averageRelationship(family: FamilyMember[]): number {
  if (family.length === 0) return 0;
  return family.reduce((s, m) => s + m.relationship, 0) / family.length;
}

export function changeRelationship(ctx: GameContext, delta: number): void {
  for (const m of ctx.state.family) {
    const scale =
      delta < 0 && m.personality === "strict"
        ? 1.4
        : delta < 0 && m.personality === "supportive"
          ? 0.6
          : 1;
    m.relationship = Math.max(0, Math.min(100, m.relationship + delta * scale));
  }
}

/** Relationship needed to move back in with your parents. */
export const MOVE_BACK_RELATIONSHIP = 45;

/**
 * Parents expect an adult child living at home to work or study. Idle days wear down their
 * patience; working, studying and helping around the house build it back up.
 */
export const familySystem: System = {
  id: "family",
  onDay(ctx) {
    const p = ctx.state.player;
    if (p.housing.kind !== "parents" || ctx.state.family.length === 0) return;
    const busy = isWorking(ctx) || p.education !== null;
    if (busy) {
      changeRelationship(ctx, 0.4);
      return;
    }
    // A short grace period after starting before expectations kick in.
    if (ctx.state.time - ctx.state.config.startTime < 21 * 24) return;
    changeRelationship(ctx, -0.9);
    const rel = averageRelationship(ctx.state.family);
    if (rel <= 0.5) {
      p.housing = { kind: "homeless" };
      p.shelterBedUntil = null;
      ctx.alert(
        "bad",
        "Your parents have had enough. They've kicked you out. You are now homeless.",
      );
    } else if (rel < 15 && ctx.rng.chance(0.25)) {
      ctx.alert(
        "bad",
        "Your parents are losing patience. Find a job, enroll in school, or help out at home.",
      );
    }
  },
};
