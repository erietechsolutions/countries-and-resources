import { addDays, toDateParts, type GameTime } from "../core/calendar";
import type { GameContext } from "../core/game";
import type { System } from "../core/systems";
import { cityCosts, countryOf } from "../economy/costs";
import { CREDENTIAL_LABELS } from "../education/courses";
import { recordPenalty } from "../crime/crime";
import { transact } from "../finance/finance";
import type { JobOffer } from "../life/types";
import { formatMoney } from "../world/format";
import type { Company } from "../world/types";
import { companiesIn } from "./companies";
import { ALTERNATE_QUALIFICATIONS, occupationById, type OccupationDef } from "./occupations";
import { SKILLS, skillLevel } from "./skills";

const DAY = 24;
export const OFFER_DAYS = 3;
export const MISSED_SHIFT_LIMIT = 3;
/** Employers reached in one day of job hunting. */
export const APPLICATIONS_PER_SEARCH = 3;

/** Why the player can't do this job (missing credential or skill), or null if qualified. */
export function qualificationGap(ctx: GameContext, occ: OccupationDef): string | null {
  const p = ctx.state.player;
  const alt = ALTERNATE_QUALIFICATIONS[occ.id];
  if (alt && p.credentials.includes(alt)) return null;
  for (const c of occ.credentials) {
    if (!p.credentials.includes(c)) return `Requires: ${CREDENTIAL_LABELS[c]}`;
  }
  for (const [skill, level] of Object.entries(occ.skills)) {
    if (skillLevel(p.skills[skill as keyof typeof p.skills]) < (level ?? 0)) {
      const label = SKILLS.find((s) => s.id === skill)?.label ?? skill;
      return `Requires ${label} level ${level}`;
    }
  }
  return null;
}

/** Whether the player currently has a usable mailing address. */
export function hasAddress(ctx: GameContext): boolean {
  const p = ctx.state.player;
  if (p.housing.kind !== "homeless") return true;
  // Shelters let recent guests use their address for applications.
  return (p.cooldowns.shelterAddress ?? 0) > ctx.state.time;
}

export function offeredWage(ctx: GameContext, occ: OccupationDef, company: Company): number {
  const costs = cityCosts(ctx, company.cityId);
  return Math.max(
    costs.minimumWageCents,
    Math.round(costs.medianWageCents * occ.wageFactor * company.wageFactor),
  );
}

/** Probability that an application for this job turns into an offer. */
export function hireChance(ctx: GameContext, occ: OccupationDef): number {
  const p = ctx.state.player;
  const country = countryOf(ctx, p.cityId);
  let chance = 0.22 * (1 - Math.min(0.6, country.unemployment * 1.6));
  if (p.needs.hygiene < occ.minHygiene) chance *= 0.12;
  if (p.housing.kind === "homeless") chance *= 0.4;
  if (!p.inventory.items.includes("phone")) chance *= 0.6;
  if (p.inventory.items.includes("interviewClothes")) chance *= 1.25;
  chance *= 0.7 + p.needs.happiness / 330;
  if (p.needs.energy < 20) chance *= 0.7;
  // Newcomers without citizenship face language and paperwork hurdles.
  if (!p.citizenship.includes(country.id)) chance *= 0.8;
  // A good name with employers and fellow workers helps; a criminal reputation hurts.
  chance *=
    1 +
    (p.reputation.business + p.reputation.workers) / 400 -
    Math.max(0, p.reputation.underworld) / 300;
  // A criminal record makes employers wary.
  chance *= recordPenalty(ctx);
  return Math.max(0, Math.min(0.9, chance));
}

/**
 * Applies to openings around the city. Returns the new offers (also stored on the player).
 * The jobs the player isn't qualified for are skipped.
 */
export function searchForJobs(ctx: GameContext): JobOffer[] {
  const p = ctx.state.player;
  const now = ctx.state.time;
  const offers: JobOffer[] = [];
  const address = hasAddress(ctx);
  const applications: { company: Company; occ: OccupationDef }[] = [];
  for (const company of companiesIn(ctx, p.cityId)) {
    for (const [occId, count] of Object.entries(company.openings)) {
      if (count <= 0) continue;
      const occ = occupationById(occId);
      if (qualificationGap(ctx, occ)) continue;
      if (occ.needsAddress && !address) continue;
      if (p.job?.companyId === company.id && p.job.occupationId === occId) continue;
      applications.push({ company, occ });
    }
  }
  // A few hours of searching reaches a handful of employers, not the whole city.
  ctx.rng.shuffle(applications);
  for (const { company, occ } of applications.slice(0, APPLICATIONS_PER_SEARCH)) {
    if (!ctx.rng.chance(hireChance(ctx, occ))) continue;
    offers.push({
      id: `o${now}-${offers.length}`,
      companyId: company.id,
      occupationId: occ.id,
      wageCents: offeredWage(ctx, occ, company),
      expiresAt: addDays(now, OFFER_DAYS),
    });
  }
  p.jobOffers = [...p.jobOffers.filter((o) => o.expiresAt > now), ...offers];
  return offers;
}

export function acceptOffer(ctx: GameContext, offerId: string): string | null {
  const p = ctx.state.player;
  const offer = p.jobOffers.find((o) => o.id === offerId);
  if (!offer || offer.expiresAt <= ctx.state.time) return "That offer has expired.";
  const company = ctx.state.world.companies.find((c) => c.id === offer.companyId);
  if (!company) return "That company has closed.";
  if (p.job) leaveJob(ctx, `You left your job to start a new one.`);
  p.job = {
    companyId: company.id,
    occupationId: offer.occupationId,
    wageCents: offer.wageCents,
    startedAt: ctx.state.time,
    performance: 60,
    missedShifts: [],
    unpaidHours: 0,
    lastPromotionAt: ctx.state.time,
  };
  const openings = company.openings[offer.occupationId] ?? 0;
  if (openings > 0) company.openings[offer.occupationId] = openings - 1;
  company.employees++;
  p.jobOffers = [];
  const occ = occupationById(offer.occupationId);
  ctx.alert(
    "good",
    `You're hired! ${occ.title} at ${company.name}, ${formatMoney(offer.wageCents)}/hr.`,
    "work",
  );
  return null;
}

/** Ends the current job, paying out hours worked so far. */
export function leaveJob(ctx: GameContext, message: string, level: "bad" | "info" = "info"): void {
  const p = ctx.state.player;
  if (!p.job) return;
  payWages(ctx);
  const company = ctx.state.world.companies.find((c) => c.id === p.job!.companyId);
  if (company) company.employees = Math.max(0, company.employees - 1);
  if (p.activity?.id === "work") {
    p.activity = null;
    ctx.events.emit({ type: "activityEnded", activityId: "work", reason: "interrupted" });
  }
  p.job = null;
  ctx.alert(level, message, "work");
}

export function companyOfJob(ctx: GameContext): Company | undefined {
  const job = ctx.state.player.job;
  return job ? ctx.state.world.companies.find((c) => c.id === job.companyId) : undefined;
}

/** Pays out unpaid hours, minus income tax. */
export function payWages(ctx: GameContext): void {
  const p = ctx.state.player;
  const job = p.job;
  if (!job || job.unpaidHours <= 0) return;
  const gross = Math.round(job.unpaidHours * job.wageCents);
  const tax = Math.round(gross * countryOf(ctx, p.cityId).taxes.income);
  job.unpaidHours = 0;
  const company = companyOfJob(ctx);
  transact(
    ctx,
    gross - tax,
    "wages",
    `Paycheck${company ? ` from ${company.name}` : ""} (${formatMoney(tax)} tax withheld)`,
  );
  ctx.alert(
    "good",
    `Payday: ${formatMoney(gross - tax)} after ${formatMoney(tax)} in taxes.`,
    "money",
  );
}

/** Whether a shift starts at this moment. */
export function shiftStartsNow(occ: OccupationDef, time: GameTime): boolean {
  const d = toDateParts(time);
  return d.hour === occ.shift.start && occ.shift.days.includes(d.weekday);
}

export function recordMissedShift(ctx: GameContext): void {
  const job = ctx.state.player.job;
  if (!job) return;
  const now = ctx.state.time;
  job.missedShifts = [...job.missedShifts.filter((t) => now - t < 30 * DAY), now];
  job.performance = Math.max(0, job.performance - 15);
  if (job.missedShifts.length >= MISSED_SHIFT_LIMIT) {
    leaveJob(ctx, "You were fired for missing too many shifts.", "bad");
  } else {
    ctx.alert(
      "bad",
      `You missed a shift. Warning ${job.missedShifts.length} of ${MISSED_SHIFT_LIMIT - 1}: one more and you'll be fired.`,
      "work",
    );
  }
}

export const jobsSystem: System = {
  id: "jobs",
  onHour(ctx) {
    const p = ctx.state.player;
    const d = toDateParts(ctx.state.time);
    // Friday paydays at 5 PM.
    if (d.weekday === 5 && d.hour === 17) payWages(ctx);
    if (p.jobOffers.some((o) => o.expiresAt <= ctx.state.time)) {
      p.jobOffers = p.jobOffers.filter((o) => o.expiresAt > ctx.state.time);
    }
  },
  onMonth(ctx) {
    const p = ctx.state.player;
    const job = p.job;
    if (!job) return;
    const occ = occupationById(job.occupationId);
    if (job.performance < 15) {
      leaveJob(ctx, "You were fired for poor performance.", "bad");
      return;
    }
    const months = (ctx.state.time - job.lastPromotionAt) / (30 * DAY);
    if (!occ.promotesTo || job.performance < 75 || months < 3) return;
    const next = occupationById(occ.promotesTo);
    if (qualificationGap(ctx, next)) return;
    const company = companyOfJob(ctx);
    if (!company || company.sector !== next.sector) return;
    job.occupationId = next.id;
    job.wageCents = Math.max(job.wageCents + 1, offeredWage(ctx, next, company));
    job.lastPromotionAt = ctx.state.time;
    job.performance = 60;
    ctx.alert(
      "good",
      `Promotion! You're now ${next.title}, earning ${formatMoney(job.wageCents)}/hr.`,
      "work",
    );
  },
};
