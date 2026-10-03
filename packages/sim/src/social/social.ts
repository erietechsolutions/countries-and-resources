import type { Character } from "../character/character";
import { addDays, startOfDay } from "../core/calendar";
import type { GameContext } from "../core/game";
import type { System } from "../core/systems";
import { cityCosts } from "../economy/costs";
import { transact } from "../finance/finance";
import { formatMoney } from "../world/format";
import { occupationById } from "../work/occupations";
import { createPerson, personAge, personById, personName } from "./people";
import type { Person, RelationshipKind, Relationship, RepGroup } from "./types";

const DAY = 24;
const ROMANTIC: RelationshipKind[] = ["dating", "engaged", "spouse"];

export function relationshipWith(player: Character, personId: string): Relationship | undefined {
  return player.relationships.find((r) => r.personId === personId);
}

export function isRomantic(r: Relationship): boolean {
  return ROMANTIC.includes(r.kind);
}

export function spouseOf(ctx: GameContext): Person | undefined {
  const r = ctx.state.player.relationships.find((x) => x.kind === "spouse");
  return r && personById(ctx, r.personId);
}

/** Changes standing with a group (-100..100). */
export function adjustReputation(ctx: GameContext, group: RepGroup | "fame", delta: number): void {
  const rep = ctx.state.player.reputation;
  const lo = group === "fame" ? 0 : -100;
  rep[group] = Math.max(lo, Math.min(100, Math.round((rep[group] + delta) * 10) / 10));
}

/** Upgrades or downgrades friendships as affection changes. */
function updateKind(ctx: GameContext, r: Relationship): void {
  const person = personById(ctx, r.personId);
  if (r.kind === "acquaintance" && r.affection >= 50) {
    r.kind = "friend";
    if (person) ctx.log("life", `You and ${personName(person)} are friends now.`);
  } else if (r.kind === "friend" && r.affection >= 85) {
    r.kind = "bestFriend";
    if (person) ctx.alert("good", `${personName(person)} is now your best friend.`);
  } else if (r.kind === "bestFriend" && r.affection < 60) {
    r.kind = "friend";
  } else if (r.kind === "friend" && r.affection < 20) {
    r.kind = "acquaintance";
  }
}

export function changeAffection(
  ctx: GameContext,
  r: Relationship,
  affection: number,
  romance = 0,
): void {
  r.affection = Math.max(0, Math.min(100, r.affection + affection));
  r.romance = Math.max(0, Math.min(100, r.romance + romance));
  updateKind(ctx, r);
}

/** Meets someone new in the player's city. */
export function meetPerson(ctx: GameContext, context: string): Person {
  const p = ctx.state.player;
  const person = createPerson(ctx, { cityId: p.cityId, minAge: 18, maxAge: 45 });
  const rng = ctx.rng;
  p.relationships.push({
    personId: person.id,
    kind: "acquaintance",
    affection: rng.int(20, 40),
    romance: rng.chance(0.45) ? rng.int(15, 55) : rng.int(0, 10),
    metAt: ctx.state.time,
    lastContact: ctx.state.time,
    context,
  });
  return person;
}

// ---------------------------------------------------------------------------------------------
// Instant actions (commands)

export type SocialAction =
  "askOut" | "propose" | "marry" | "breakUp" | "divorce" | "tryForBaby" | "endFriendship";

export const SOCIAL_ACTION_LABELS: Record<SocialAction, string> = {
  askOut: "Ask out",
  propose: "Propose",
  marry: "Get married",
  breakUp: "Break up",
  divorce: "Divorce",
  tryForBaby: "Try for a baby",
  endFriendship: "End friendship",
};

export function socialActionCost(ctx: GameContext, action: SocialAction): number {
  const wage = cityCosts(ctx, ctx.state.player.cityId).medianWageCents;
  if (action === "propose") return wage * 40;
  if (action === "marry") return wage * 50;
  if (action === "divorce") return wage * 80;
  return 0;
}

/** Why an action isn't possible right now, or null. */
export function socialActionBlocker(
  ctx: GameContext,
  personId: string,
  action: SocialAction,
): string | null {
  const p = ctx.state.player;
  const r = relationshipWith(p, personId);
  if (!r) return "You don't know this person.";
  const cost = socialActionCost(ctx, action);
  if (cost > p.cashCents) return `Costs ${formatMoney(cost, true)}.`;
  const partner = p.relationships.find((x) => isRomantic(x) && x.personId !== personId);
  switch (action) {
    case "askOut":
      if (isRomantic(r) || r.kind === "child") return "Not possible.";
      if (partner) return "You're already in a relationship.";
      return r.affection >= 40 ? null : "Get to know them better first (affection 40+).";
    case "propose":
      if (r.kind !== "dating") return "You need to be dating first.";
      if (ctx.state.time - r.metAt < 60 * DAY)
        return "It's a bit soon. Date for at least two months.";
      return r.affection >= 70 && r.romance >= 65
        ? null
        : "They aren't ready (affection 70+ and romance 65+).";
    case "marry":
      return r.kind === "engaged" ? null : "You need to be engaged first.";
    case "breakUp":
      return r.kind === "dating" || r.kind === "engaged" ? null : "You're not dating.";
    case "divorce":
      return r.kind === "spouse" ? null : "You're not married.";
    case "tryForBaby":
      if (r.kind !== "spouse") return "Only with your spouse.";
      if (p.pregnancy) return "Your family is already expecting.";
      return r.affection >= 55 ? null : "Your relationship needs work first.";
    case "endFriendship":
      return r.kind === "friend" || r.kind === "bestFriend" || r.kind === "acquaintance"
        ? null
        : "Not possible.";
  }
}

export function performSocialAction(
  ctx: GameContext,
  personId: string,
  action: SocialAction,
): string | null {
  const blocked = socialActionBlocker(ctx, personId, action);
  if (blocked) return blocked;
  const p = ctx.state.player;
  const r = relationshipWith(p, personId)!;
  const person = personById(ctx, personId)!;
  const name = personName(person);
  const cost = socialActionCost(ctx, action);
  const rng = ctx.rng;
  switch (action) {
    case "askOut":
      if (rng.chance(Math.min(0.9, r.romance / 80))) {
        r.kind = "dating";
        changeAffection(ctx, r, 5, 8);
        ctx.alert("good", `${name} said yes! You're dating now.`);
      } else {
        changeAffection(ctx, r, -5, -10);
        p.needs.happiness = Math.max(0, p.needs.happiness - 8);
        ctx.alert("bad", `${name} turned you down.`);
      }
      break;
    case "propose":
      transact(ctx, -cost, "shopping", "Engagement ring");
      if (rng.chance(Math.min(0.95, (r.affection + r.romance) / 170))) {
        r.kind = "engaged";
        ctx.alert("good", `${name} said yes! You're engaged.`);
      } else {
        changeAffection(ctx, r, -10, -10);
        ctx.alert("bad", `${name} wasn't ready to say yes.`);
      }
      break;
    case "marry":
      transact(ctx, -cost, "shopping", "Wedding");
      r.kind = "spouse";
      person.cityId = p.cityId;
      changeAffection(ctx, r, 10, 10);
      adjustReputation(ctx, "community", 2);
      ctx.alert("good", `You married ${name}!`);
      break;
    case "breakUp":
      r.kind = "ex";
      r.affection = Math.max(0, r.affection - 30);
      p.needs.happiness = Math.max(0, p.needs.happiness - 10);
      ctx.alert("info", `You broke up with ${name}.`);
      break;
    case "divorce": {
      transact(ctx, -cost, "other", "Divorce lawyer");
      const split = Math.round(Math.max(0, p.cashCents) * 0.3);
      if (split > 0) transact(ctx, -split, "other", "Divorce settlement");
      r.kind = "ex";
      r.affection = Math.max(0, r.affection - 40);
      p.needs.happiness = Math.max(0, p.needs.happiness - 15);
      ctx.alert("bad", `You and ${name} are divorced.`);
      break;
    }
    case "tryForBaby":
      if (rng.chance(0.3)) {
        p.pregnancy = { partnerId: personId, dueAt: addDays(ctx.state.time, 270) };
        ctx.alert("good", `Great news: you and ${name} are expecting a baby!`);
      } else {
        ctx.alert("info", "No luck this time. You can try again.");
      }
      break;
    case "endFriendship":
      p.relationships = p.relationships.filter((x) => x !== r);
      ctx.log("life", `You stopped seeing ${name}.`);
      break;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Daily and monthly upkeep

export function socialHappiness(player: Character): number {
  let bonus = 0;
  const kinds = player.relationships.map((r) => r.kind);
  if (kinds.includes("spouse")) bonus += 6;
  else if (kinds.includes("engaged") || kinds.includes("dating")) bonus += 3;
  bonus += Math.min(2, kinds.filter((k) => k === "bestFriend").length) * 2;
  if (kinds.includes("child")) bonus += 3;
  const friends = kinds.filter(
    (k) => k === "friend" || k === "bestFriend" || ROMANTIC.includes(k),
  ).length;
  if (friends === 0) bonus -= 4;
  return bonus;
}

export const socialSystem: System = {
  id: "social",
  onHour(ctx) {
    // Coworkers become acquaintances now and then.
    const p = ctx.state.player;
    if (p.activity?.id === "work" && p.job && ctx.rng.chance(0.006)) {
      const person = meetPerson(ctx, "at work");
      person.occupation = occupationById(p.job.occupationId).title;
      ctx.log("life", `You got to know a coworker, ${personName(person)}.`);
    }
  },
  onDay(ctx) {
    const p = ctx.state.player;
    const now = ctx.state.time;
    for (const r of [...p.relationships]) {
      if (r.kind === "child" || r.kind === "ex" || r.kind === "rival") continue;
      const quiet = now - r.lastContact > 7 * DAY;
      if (!quiet) continue;
      changeAffection(ctx, r, isRomantic(r) ? (r.kind === "spouse" ? -0.3 : -0.6) : -0.25);
      if ((r.kind === "dating" || r.kind === "engaged") && r.affection < 20) {
        const person = personById(ctx, r.personId);
        r.kind = "ex";
        ctx.alert(
          "bad",
          `${person ? personName(person) : "Your partner"} broke up with you. You hadn't spent time together in a while.`,
        );
      }
    }
    if (p.pregnancy && now >= p.pregnancy.dueAt) {
      const child = createPerson(ctx, {
        cityId: p.cityId,
        minAge: 0,
        maxAge: 0,
        lastName: p.lastName,
        occupation: "Child",
      });
      child.birthTime = startOfDay(now);
      child.incomeCents = 0;
      p.relationships.push({
        personId: child.id,
        kind: "child",
        affection: 90,
        romance: 0,
        metAt: now,
        lastContact: now,
        context: "your child",
      });
      p.pregnancy = null;
      ctx.alert("good", `Your baby ${child.firstName} was born!`);
    }
  },
  onMonth(ctx) {
    const p = ctx.state.player;
    const costs = cityCosts(ctx, p.cityId);
    const spouse = spouseOf(ctx);
    if (spouse && spouse.incomeCents > 0) {
      transact(
        ctx,
        Math.round(spouse.incomeCents * 0.3),
        "gift",
        `Household share from ${spouse.firstName}`,
      );
    }
    for (const r of p.relationships) {
      if (r.kind !== "child") continue;
      const child = personById(ctx, r.personId);
      if (child && personAge(ctx, child) < 18) {
        transact(
          ctx,
          -Math.round(costs.medianWageCents * 25),
          "other",
          `Childcare for ${child.firstName}`,
        );
      }
    }
    // Reputation from steady work, and a slow fade back toward neutral.
    if (p.job && p.job.performance > 60) {
      adjustReputation(ctx, "workers", 1);
      if (occupationById(p.job.occupationId).tier >= 1) adjustReputation(ctx, "business", 0.5);
    }
    for (const g of [
      "community",
      "workers",
      "business",
      "establishment",
      "activists",
      "underworld",
    ] as const) {
      p.reputation[g] = Math.round(p.reputation[g] * 0.98 * 10) / 10;
    }
  },
};
