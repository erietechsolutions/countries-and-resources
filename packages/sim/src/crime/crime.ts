import { addDays, type GameTime } from "../core/calendar";
import type { GameContext } from "../core/game";
import type { System } from "../core/systems";
import { cityCosts, countryOf } from "../economy/costs";
import { transact } from "../finance/finance";
import { playerOffices } from "../politics/government";
import { localPolicy, ruleOfLaw } from "../politics/policies";
import { adjustReputation } from "../social/social";
import { formatMoney } from "../world/format";
import { leaveJob } from "../work/jobs";

export type CrimeId =
  | "shoplifting"
  | "pickpocketing"
  | "burglary"
  | "drugDealing"
  | "gangJob"
  | "embezzlement"
  | "bribery"
  | "fraud"
  | "publicDisorder";

export const CRIME_LABELS: Record<CrimeId, string> = {
  shoplifting: "Shoplifting",
  pickpocketing: "Theft",
  burglary: "Burglary",
  drugDealing: "Drug dealing",
  gangJob: "Organized crime",
  embezzlement: "Embezzlement",
  bribery: "Bribery",
  fraud: "Fraud",
  publicDisorder: "Public disorder",
};

/** Seriousness 1–5: drives sentences and scandal damage. */
export const CRIME_SEVERITY: Record<CrimeId, number> = {
  shoplifting: 1,
  pickpocketing: 2,
  burglary: 3,
  drugDealing: 3,
  gangJob: 4,
  embezzlement: 4,
  bribery: 3,
  fraud: 3,
  publicDisorder: 1,
};

export interface Conviction {
  crime: CrimeId;
  time: GameTime;
  sentence: string;
}

/** A misdeed that hasn't come out yet. Fame and nosy journalists make it more likely to surface. */
export interface Secret {
  crime: CrimeId;
  time: GameTime;
  severity: number;
}

export interface PendingCase {
  crime: CrimeId;
  arrestedAt: GameTime;
  trialAt: GameTime;
  bribeCents: number;
  lawyerCents: number;
}

export interface LegalState {
  record: Conviction[];
  /** 0–100: how closely police are watching you. Fades over time. */
  heat: number;
  secrets: Secret[];
  pendingCase: PendingCase | null;
  prisonUntil: GameTime | null;
  probationUntil: GameTime | null;
  /** 0 = not in a gang; 1–4 = gang rank. */
  gangRank: number;
}

export function emptyLegal(): LegalState {
  return {
    record: [],
    heat: 0,
    secrets: [],
    pendingCase: null,
    prisonUntil: null,
    probationUntil: null,
    gangRank: 0,
  };
}

/** Base chance of arrest for each crime activity, before policing and attention. */
export const CRIME_RISK = {
  shoplift: 0.14,
  pickpocket: 0.16,
  burglary: 0.22,
  dealDrugs: 0.12,
  gangJob: 0.1,
} as const;

export const GANG_RANKS = ["", "Associate", "Soldier", "Lieutenant", "Boss"];

/** Chance that a crime of this kind gets you caught right now. */
export function detectionChance(ctx: GameContext, base: number): number {
  const p = ctx.state.player;
  const country = countryOf(ctx, p.cityId);
  const policing = 0.4 + ruleOfLaw(country) * 0.9 + localPolicy(ctx, p.cityId, "policing") * 0.4;
  const careful = 1 - Math.min(0.35, Math.max(0, p.reputation.underworld) / 200);
  const probation = (p.legal.probationUntil ?? 0) > ctx.state.time ? 1.3 : 1;
  return Math.max(
    0.01,
    Math.min(0.85, base * policing * (1 + p.legal.heat / 100) * careful * probation),
  );
}

/** Called when a crime is committed: either an arrest, or it stays a secret. Returns true if caught. */
export function commitCrime(
  ctx: GameContext,
  crime: CrimeId,
  base: number,
  keepSecret = false,
): boolean {
  const p = ctx.state.player;
  const legal = p.legal;
  legal.heat = Math.min(100, legal.heat + CRIME_SEVERITY[crime] * 3);
  adjustReputation(ctx, "underworld", CRIME_SEVERITY[crime] * 0.8);
  if (ctx.rng.chance(detectionChance(ctx, base))) {
    arrest(ctx, crime);
    return true;
  }
  if (keepSecret || CRIME_SEVERITY[crime] >= 3)
    legal.secrets.push({ crime, time: ctx.state.time, severity: CRIME_SEVERITY[crime] });
  if (legal.secrets.length > 20) legal.secrets.shift();
  return false;
}

export function arrest(ctx: GameContext, crime: CrimeId): void {
  const p = ctx.state.player;
  const wage = cityCosts(ctx, p.cityId).medianWageCents;
  const sev = CRIME_SEVERITY[crime];
  p.legal.pendingCase = {
    crime,
    arrestedAt: ctx.state.time,
    trialAt: ctx.state.time + 48,
    bribeCents: wage * 30 * sev,
    lawyerCents: wage * 40 * sev,
  };
  p.legal.heat = Math.min(100, p.legal.heat + 15);
  if (p.activity) {
    ctx.events.emit({ type: "activityEnded", activityId: p.activity.id, reason: "interrupted" });
  }
  p.activity = { id: "custody", startedAt: ctx.state.time, endsAt: ctx.state.time + 48 };
  adjustReputation(ctx, "community", -2 * sev);
  ctx.alert(
    "bad",
    `You were arrested for ${CRIME_LABELS[crime].toLowerCase()}. Decide how to handle the case in the Law tab before your hearing in 2 days.`,
    "life",
  );
}

function sentence(ctx: GameContext, crime: CrimeId, leniency: number): void {
  const p = ctx.state.player;
  const sev = CRIME_SEVERITY[crime];
  const priors = p.legal.record.length;
  const wage = cityCosts(ctx, p.cityId).medianWageCents;
  const weight = (sev + priors * 0.8) * leniency;
  let text: string;
  if (weight < 2) {
    const fine = Math.round(wage * 20 * sev);
    transact(
      ctx,
      -Math.min(fine, Math.max(0, p.cashCents)),
      "other",
      `Court fine: ${CRIME_LABELS[crime].toLowerCase()}`,
    );
    p.legal.probationUntil = addDays(ctx.state.time, 180);
    text = `a ${formatMoney(fine, true)} fine and 6 months' probation`;
  } else {
    const days = Math.round(Math.min(720, 4 * weight ** 2.2));
    p.legal.prisonUntil = addDays(ctx.state.time, days);
    p.activity = { id: "prison", startedAt: ctx.state.time, endsAt: p.legal.prisonUntil };
    if (p.job && days > 3) leaveJob(ctx, "You lost your job while in prison.", "bad");
    for (const o of playerOffices(ctx)) removeFromOffice(ctx, o.id);
    text = `${days} days in prison`;
  }
  p.legal.record.push({ crime, time: ctx.state.time, sentence: text });
  adjustReputation(ctx, "establishment", -3 * sev);
  adjustReputation(ctx, "business", -1.5 * sev);
  ctx.alert("bad", `Convicted of ${CRIME_LABELS[crime].toLowerCase()}: ${text}.`, "life");
}

export function removeFromOffice(ctx: GameContext, officeId: string): void {
  const office = ctx.state.politics.offices.find((o) => o.id === officeId);
  if (!office) return;
  const i = office.holders.indexOf("player");
  if (i < 0) return;
  office.holders.splice(i, 1);
  office.holderParties.splice(i, 1);
  ctx.alert("bad", `You lost your position: ${office.title}.`, "politics");
}

export type CaseChoice = "plead" | "fight" | "bribe";

export function caseOptions(
  ctx: GameContext,
): { choice: CaseChoice; label: string; costCents: number; note: string }[] {
  const c = ctx.state.player.legal.pendingCase;
  if (!c) return [];
  const rol = ruleOfLaw(countryOf(ctx, ctx.state.player.cityId));
  return [
    {
      choice: "plead",
      label: "Plead guilty",
      costCents: 0,
      note: "A lighter sentence, but a conviction for sure.",
    },
    {
      choice: "fight",
      label: "Hire a lawyer and fight it",
      costCents: c.lawyerCents,
      note: `About a ${Math.round(45 - rol * 20)}% chance of walking free.`,
    },
    {
      choice: "bribe",
      label: "Bribe the officer",
      costCents: c.bribeCents,
      note:
        rol > 0.7
          ? "Very risky here: police are clean."
          : `Works more often where policing is corrupt (${Math.round((1 - rol) * 80)}% chance).`,
    },
  ];
}

export function resolveCase(ctx: GameContext, choice: CaseChoice): string | null {
  const p = ctx.state.player;
  const c = p.legal.pendingCase;
  if (!c) return "You have no open case.";
  const option = caseOptions(ctx).find((o) => o.choice === choice)!;
  if (option.costCents > p.cashCents) return `You need ${formatMoney(option.costCents, true)}.`;
  if (option.costCents > 0)
    transact(
      ctx,
      -option.costCents,
      "other",
      choice === "bribe" ? "Cash to a police officer" : "Defense lawyer",
    );
  p.legal.pendingCase = null;
  if (p.activity?.id === "custody") p.activity = null;
  const rol = ruleOfLaw(countryOf(ctx, p.cityId));
  if (choice === "plead") {
    sentence(ctx, c.crime, 0.7);
  } else if (choice === "fight") {
    if (ctx.rng.chance(0.45 - rol * 0.2))
      ctx.alert("good", "Case dismissed! Your lawyer got you off.", "life");
    else sentence(ctx, c.crime, 1);
  } else if (ctx.rng.chance((1 - rol) * 0.8)) {
    p.legal.heat = Math.max(0, p.legal.heat - 20);
    p.legal.secrets.push({
      crime: "bribery",
      time: ctx.state.time,
      severity: CRIME_SEVERITY.bribery,
    });
    ctx.alert("good", "The officer took the money. The paperwork disappeared.", "life");
  } else {
    ctx.alert("bad", "The officer reported your bribe attempt. That's another charge.", "life");
    sentence(ctx, c.crime, 1.5);
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Organized crime and corruption

export function joinGang(ctx: GameContext): string | null {
  const p = ctx.state.player;
  if (p.legal.gangRank > 0) return "You're already in a gang.";
  if (p.reputation.underworld < 15)
    return "Nobody in the underworld trusts you yet (underworld reputation 15+).";
  p.legal.gangRank = 1;
  adjustReputation(ctx, "underworld", 5);
  adjustReputation(ctx, "community", -3);
  ctx.alert("info", "You've been brought into a local gang as an associate.", "life");
  return null;
}

export function leaveGang(ctx: GameContext): string | null {
  const p = ctx.state.player;
  if (p.legal.gangRank === 0) return "You're not in a gang.";
  p.legal.gangRank = 0;
  // Gangs don't let people walk away for free.
  if (ctx.rng.chance(0.4)) {
    p.needs.health = Math.max(5, p.needs.health - 35);
    ctx.alert("bad", "You left the gang. They made sure you'd remember it.", "life");
  } else {
    ctx.alert("info", "You left the gang behind.", "life");
  }
  return null;
}

/** Public officials can skim from the budget. Big sums, big risk. */
export function embezzlementCap(ctx: GameContext): number {
  const offices = playerOffices(ctx);
  if (offices.length === 0) return 0;
  return offices.reduce(
    (s, o) => s + o.salaryCents * (o.level === "national" ? 6 : o.level === "region" ? 4 : 3),
    0,
  );
}

export function embezzle(ctx: GameContext, amountCents: number): string | null {
  const cap = embezzlementCap(ctx);
  if (cap === 0) return "You need to hold public office.";
  const p = ctx.state.player;
  if ((p.cooldowns.embezzle ?? 0) > ctx.state.time)
    return "Lie low for a while before trying that again.";
  if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > cap)
    return `You can quietly move up to ${formatMoney(cap, true)}.`;
  p.cooldowns.embezzle = addDays(ctx.state.time, 30);
  transact(ctx, amountCents, "other", "Off-the-books payment");
  const base = 0.05 + (amountCents / cap) * 0.15;
  commitCrime(ctx, "embezzlement", base, true);
  return null;
}

// ---------------------------------------------------------------------------------------------
// Upkeep: heat fades, prison ends, and secrets can come out as scandals.

export const crimeSystem: System = {
  id: "crime",
  onDay(ctx) {
    const p = ctx.state.player;
    const legal = p.legal;
    legal.heat = Math.max(0, legal.heat - 1);
    const c = legal.pendingCase;
    if (c && ctx.state.time >= c.trialAt) {
      // No decision made: a public defender fights the case.
      legal.pendingCase = null;
      if (p.activity?.id === "custody") p.activity = null;
      if (ctx.rng.chance(0.2))
        ctx.alert("good", "Your public defender got the case dismissed.", "life");
      else sentence(ctx, c.crime, 1);
    }
    if (legal.prisonUntil !== null && ctx.state.time >= legal.prisonUntil) {
      legal.prisonUntil = null;
      legal.probationUntil = addDays(ctx.state.time, 365);
      if (p.housing.kind === "renting" && p.housing.missedPayments >= 2)
        p.housing = { kind: "homeless" };
      ctx.alert(
        "info",
        "You've been released from prison. You're on probation for a year.",
        "life",
      );
    }
  },
  onMonth(ctx) {
    const p = ctx.state.player;
    const legal = p.legal;
    if (legal.gangRank > 0) {
      // Gang standing grows with reputation in the underworld.
      const next = legal.gangRank + 1;
      if (next <= 4 && p.reputation.underworld >= next * 20 && ctx.rng.chance(0.3)) {
        legal.gangRank = next;
        ctx.alert("info", `You've risen to ${GANG_RANKS[next]} in the gang.`, "life");
      }
    }
    if (legal.secrets.length === 0) return;
    const country = countryOf(ctx, p.cityId);
    const scrutiny = 0.01 + p.reputation.fame / 600 + (playerOffices(ctx).length > 0 ? 0.04 : 0);
    const odds = Math.min(0.4, scrutiny * (0.5 + ruleOfLaw(country)) * legal.secrets.length);
    if (!ctx.rng.chance(odds)) return;
    const secret = legal.secrets.splice(ctx.rng.int(0, legal.secrets.length - 1), 1)[0]!;
    exposeScandal(ctx, secret);
  },
};

export function exposeScandal(ctx: GameContext, secret: Secret): void {
  const p = ctx.state.player;
  const sev = secret.severity;
  adjustReputation(ctx, "community", -4 * sev);
  adjustReputation(ctx, "establishment", -3 * sev);
  adjustReputation(ctx, "fame", 3);
  p.politics.approval = Math.max(0, p.politics.approval - 8 * sev);
  ctx.alert(
    "bad",
    `Scandal! A story about your past ${CRIME_LABELS[secret.crime].toLowerCase()} has come out.`,
    "politics",
  );
  // Serious scandals can bring a prosecution, or force an official to resign.
  if (sev >= 3 && ctx.rng.chance(0.25 * ruleOfLaw(countryOf(ctx, p.cityId)) + 0.1)) {
    arrest(ctx, secret.crime);
  } else if (sev >= 3 && p.politics.approval < 25) {
    for (const o of playerOffices(ctx)) removeFromOffice(ctx, o.id);
    ctx.alert("bad", "Under public pressure, you resigned from office.", "politics");
  }
}

/** Convictions make employers, voters and immigration officers wary. */
export function recordPenalty(ctx: GameContext): number {
  return Math.max(0.35, 1 - ctx.state.player.legal.record.length * 0.18);
}
