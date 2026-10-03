import { addDays, type GameTime } from "../core/calendar";
import type { GameContext } from "../core/game";
import { hashString } from "../core/rng";
import type { System } from "../core/systems";
import { cityCosts, countryOf } from "../economy/costs";
import { transact } from "../finance/finance";
import { spouseOf } from "../social/social";
import { formatMoney } from "../world/format";
import type { CityId, CountryId } from "../world/geography";
import type { CountryState } from "../world/types";
import { ensureCompanies } from "../work/companies";
import { leaveJob } from "../work/jobs";
import { skillLevel } from "../work/skills";

const DAY = 24;

export type ResidencyStatus =
  "citizen" | "permanent" | "work" | "student" | "visitor" | "undocumented";

export const RESIDENCY_LABELS: Record<ResidencyStatus, string> = {
  citizen: "Citizen",
  permanent: "Permanent resident",
  work: "Work visa",
  student: "Student visa",
  visitor: "Visitor",
  undocumented: "Undocumented",
};

export interface Residency {
  countryId: CountryId;
  status: ResidencyStatus;
  since: GameTime;
  expiresAt: GameTime | null;
}

export type VisaType = "visitor" | "work" | "student" | "investor" | "family" | "asylum";

export const VISA_LABELS: Record<VisaType, string> = {
  visitor: "Visitor visa",
  work: "Work visa",
  student: "Student visa",
  investor: "Investor visa",
  family: "Family visa",
  asylum: "Asylum",
};

export interface VisaApplication {
  countryId: CountryId;
  visa: VisaType;
  decideAt: GameTime;
}

/** A granted right to enter and live in a country, used when moving there. */
export interface VisaGrant {
  countryId: CountryId;
  visa: VisaType;
  validUntil: GameTime;
}

/** How welcoming a country is to immigrants, 0–1 (derived from the country if not stored). */
export function immigrationOpenness(country: CountryState): number {
  if (country.immigrationOpenness !== undefined) return country.immigrationOpenness;
  const democratic =
    country.government === "democracy" || country.government === "constitutionalMonarchy";
  const noise = ((hashString(country.id) % 1000) / 1000 - 0.5) * 0.3;
  return Math.max(
    0.05,
    Math.min(0.95, 0.25 + country.development * 0.4 + (democratic ? 0.1 : 0) + noise),
  );
}

export function currentResidency(ctx: GameContext): Residency {
  const p = ctx.state.player;
  const here = ctx.geography.cities[p.cityId]!.countryId;
  if (p.residency.countryId === here) return p.residency;
  return {
    countryId: here,
    status: p.citizenship.includes(here) ? "citizen" : "undocumented",
    since: ctx.state.time,
    expiresAt: null,
  };
}

/** Whether the player may hold formal jobs and sign leases where they live. */
export function canWorkLegally(ctx: GameContext): boolean {
  const s = currentResidency(ctx).status;
  return s === "citizen" || s === "permanent" || s === "work" || s === "student";
}

export function hasDocuments(ctx: GameContext): boolean {
  return currentResidency(ctx).status !== "undocumented";
}

/** Map distance between cities in kilometers (map units are ~10 km). */
export function distanceKm(ctx: GameContext, a: CityId, b: CityId): number {
  const ca = ctx.geography.cities[a]!;
  const cb = ctx.geography.cities[b]!;
  return Math.round(Math.hypot(ca.x - cb.x, ca.y - cb.y) * 10);
}

export interface MovePlan {
  cityId: CityId;
  international: boolean;
  costCents: number;
  hours: number;
  /** How the player would be allowed to live there, or null if they have no right to. */
  status: ResidencyStatus | null;
  blocker: string | null;
}

export function planMove(ctx: GameContext, cityId: CityId, illegal = false): MovePlan {
  const p = ctx.state.player;
  const dest = ctx.geography.cities[cityId];
  if (!dest)
    return {
      cityId,
      international: false,
      costCents: 0,
      hours: 0,
      status: null,
      blocker: "Unknown city.",
    };
  const fromCountry = ctx.geography.cities[p.cityId]!.countryId;
  const international = dest.countryId !== fromCountry;
  const km = distanceKm(ctx, p.cityId, cityId);
  const wage = cityCosts(ctx, p.cityId).medianWageCents;
  let cost = Math.round(international ? wage * (18 + km / 120) : wage * (5 + km / 80));
  if (illegal) cost += cityCosts(ctx, p.cityId).medianWageCents * 40;
  const hours = international ? 24 : Math.max(3, Math.min(30, Math.round(km / 70)));
  let status: ResidencyStatus | null = null;
  if (p.citizenship.includes(dest.countryId)) status = "citizen";
  else if (p.residency.countryId === dest.countryId && p.residency.status !== "undocumented")
    status = p.residency.status;
  else {
    const grant = p.visas.find(
      (v) => v.countryId === dest.countryId && v.validUntil > ctx.state.time,
    );
    if (grant)
      status =
        grant.visa === "investor" || grant.visa === "family" || grant.visa === "asylum"
          ? "permanent"
          : grant.visa;
  }
  if (illegal && !status) status = "undocumented";
  let blocker: string | null = null;
  if (cityId === p.cityId) blocker = "You already live here.";
  else if (!ctx.state.world.countries[dest.countryId]?.population) blocker = "Nobody lives there.";
  else if (!status) blocker = "You need a visa (or citizenship) to live there.";
  else if (cost > p.cashCents) blocker = `Moving costs ${formatMoney(cost, true)}.`;
  else if (p.activity?.id === "hospital" || p.activity?.id === "traveling")
    blocker = "Not right now.";
  return { cityId, international, costCents: cost, hours, status, blocker };
}

export function moveTo(ctx: GameContext, cityId: CityId, illegal = false): string | null {
  const plan = planMove(ctx, cityId, illegal);
  if (plan.blocker) return plan.blocker;
  const p = ctx.state.player;
  const dest = ctx.geography.cities[cityId]!;
  const destCountry = ctx.geography.countries.find((c) => c.id === dest.countryId)!;
  transact(
    ctx,
    -plan.costCents,
    "other",
    plan.international ? `Travel to ${destCountry.name}` : `Moving to ${dest.name}`,
  );

  if (illegal && plan.status === "undocumented" && !p.citizenship.includes(dest.countryId)) {
    const caught = ctx.rng.chance(0.25 + countryOf(ctx, cityId).development * 0.25);
    if (caught) {
      ctx.alert(
        "bad",
        `You were caught crossing the border into ${destCountry.name} and turned back. The smuggler kept your money.`,
      );
      return null;
    }
  }

  if (p.job) leaveJob(ctx, "You left your job to move.");
  if (p.housing.kind === "renting" && p.housing.missedPayments === 0) {
    transact(ctx, p.housing.rentCents, "deposit", "Security deposit returned");
  }
  if (p.housing.kind !== "homeless")
    ctx.log(
      "life",
      p.housing.kind === "parents"
        ? "You moved out of your parents' house."
        : "You ended your lease.",
    );
  p.housing = { kind: "homeless" };
  p.shelterBedUntil = null;
  p.jobOffers = [];
  p.cityId = cityId;
  const spouse = spouseOf(ctx);
  if (spouse) spouse.cityId = cityId;
  if (plan.status !== "citizen" || p.residency.countryId !== dest.countryId) {
    const grant = p.visas.find((v) => v.countryId === dest.countryId);
    p.residency = {
      countryId: dest.countryId,
      status: plan.status!,
      since: ctx.state.time,
      expiresAt:
        plan.status === "visitor"
          ? addDays(ctx.state.time, 90)
          : plan.status === "work"
            ? addDays(ctx.state.time, 730)
            : plan.status === "student"
              ? addDays(ctx.state.time, 540)
              : null,
    };
    if (grant) p.visas = p.visas.filter((v) => v !== grant);
  }
  ensureCompanies(ctx, cityId);
  const now = ctx.state.time;
  p.activity = { id: "traveling", startedAt: now, endsAt: now + plan.hours };
  ctx.alert(
    "good",
    `You're on your way to ${dest.name}, ${destCountry.name}. You'll need to find a place to stay when you arrive.`,
  );
  return null;
}

// ---------------------------------------------------------------------------------------------
// Visas

export interface VisaOption {
  visa: VisaType;
  feeCents: number;
  chance: number;
  days: number;
  blocker: string | null;
  description: string;
}

/** The best skill level the player has, a rough measure of employability abroad. */
function bestSkill(ctx: GameContext): number {
  return Math.max(...Object.values(ctx.state.player.skills).map(skillLevel));
}

export function visaOptions(ctx: GameContext, countryId: CountryId): VisaOption[] {
  const p = ctx.state.player;
  const country = ctx.state.world.countries[countryId];
  if (!country) return [];
  const open = immigrationOpenness(country);
  const capital =
    ctx.geography.countries.find((c) => c.id === countryId)?.capitalCityId ?? p.cityId;
  const destWage = cityCosts(ctx, capital ?? p.cityId).medianWageCents;
  const homeCountry = ctx.state.world.countries[p.citizenship[0] ?? ""];
  const qualified = p.credentials.length > 1 || bestSkill(ctx) >= 3;
  const spouse = spouseOf(ctx);
  const pending = p.visaApplication ? "You already have an application in progress." : null;
  const already = p.citizenship.includes(countryId) ? "You're a citizen here." : null;
  const base = (b: string | null) => already ?? pending ?? b;
  const investNeed = destWage * 2500;
  return [
    {
      visa: "visitor",
      feeCents: destWage * 6,
      chance: Math.min(0.97, 0.6 + open * 0.4),
      days: 7,
      blocker: base(null),
      description: "Stay up to 90 days. You can't take formal jobs or sign a lease.",
    },
    {
      visa: "work",
      feeCents: destWage * 30,
      chance: open * (qualified ? 0.85 : 0.25),
      days: 30,
      blocker: base(null),
      description:
        "Live and work for 2 years. Much easier with a credential or a skill at level 3+.",
    },
    {
      visa: "student",
      feeCents: destWage * 15,
      chance: Math.min(0.95, 0.45 + open * 0.45),
      days: 21,
      blocker: base(
        p.cashCents < destWage * 300
          ? `Needs proof of funds: ${formatMoney(destWage * 300, true)}.`
          : null,
      ),
      description: "Study (and work part-time) for 18 months.",
    },
    {
      visa: "investor",
      feeCents: Math.round(investNeed * 0.05),
      chance: 0.92,
      days: 45,
      blocker: base(
        p.cashCents < investNeed
          ? `Needs ${formatMoney(investNeed, true)} in cash to invest.`
          : null,
      ),
      description: "Permanent residency for people bringing serious money.",
    },
    {
      visa: "family",
      feeCents: destWage * 20,
      chance: 0.88,
      days: 45,
      blocker: base(
        spouse && ctx.geography.cities[spouse.cityId]?.countryId === countryId
          ? null
          : "Requires a spouse living in that country.",
      ),
      description: "Permanent residency to join your spouse.",
    },
    {
      visa: "asylum",
      feeCents: 0,
      chance: open * 0.7,
      days: 90,
      blocker: base(
        homeCountry && homeCountry.stability < 30
          ? null
          : "Only if your home country is dangerously unstable (stability under 30).",
      ),
      description: "Protection for people fleeing instability. Grants permanent residency.",
    },
  ];
}

export function applyForVisa(
  ctx: GameContext,
  countryId: CountryId,
  visa: VisaType,
): string | null {
  const option = visaOptions(ctx, countryId).find((o) => o.visa === visa);
  if (!option) return "Unknown visa.";
  if (option.blocker) return option.blocker;
  if (option.feeCents > ctx.state.player.cashCents)
    return `The fee is ${formatMoney(option.feeCents, true)}.`;
  if (option.feeCents > 0)
    transact(ctx, -option.feeCents, "other", `${VISA_LABELS[visa]} application`);
  ctx.state.player.visaApplication = {
    countryId,
    visa,
    decideAt: addDays(ctx.state.time, option.days),
  };
  const name = ctx.geography.countries.find((c) => c.id === countryId)?.name ?? countryId;
  ctx.alert(
    "info",
    `You applied for a ${VISA_LABELS[visa].toLowerCase()} for ${name}. A decision is due in about ${option.days} days.`,
  );
  return null;
}

/** Years of legal residence needed for permanent residency and then citizenship. */
export const PERMANENT_AFTER_YEARS = 3;
export const CITIZEN_AFTER_YEARS = 5;

export function naturalizationBlocker(ctx: GameContext): string | null {
  const r = currentResidency(ctx);
  if (r.status === "citizen") return "You're already a citizen here.";
  const years = (ctx.state.time - r.since) / (365 * DAY);
  if (r.status === "permanent") {
    return years >= CITIZEN_AFTER_YEARS
      ? null
      : `Requires ${CITIZEN_AFTER_YEARS} years as a permanent resident (${years.toFixed(1)} so far).`;
  }
  if (r.status === "work" || r.status === "student") {
    return years >= PERMANENT_AFTER_YEARS
      ? null
      : `Requires ${PERMANENT_AFTER_YEARS} years on your visa for permanent residency (${years.toFixed(1)} so far).`;
  }
  return "You need legal status first.";
}

/** Upgrades work/student visa holders to permanent residency, and permanent residents to citizens. */
export function naturalize(ctx: GameContext): string | null {
  const blocked = naturalizationBlocker(ctx);
  if (blocked) return blocked;
  const p = ctx.state.player;
  const fee = cityCosts(ctx, p.cityId).medianWageCents * 40;
  if (fee > p.cashCents) return `The application fee is ${formatMoney(fee, true)}.`;
  transact(ctx, -fee, "other", "Residency application");
  const r = currentResidency(ctx);
  const name = ctx.geography.countries.find((c) => c.id === r.countryId)?.name ?? r.countryId;
  if (r.status === "permanent") {
    p.citizenship.push(r.countryId);
    p.residency = { ...r, status: "citizen", expiresAt: null };
    ctx.alert("good", `Congratulations! You're now a citizen of ${name}.`);
  } else {
    p.residency = { ...r, status: "permanent", since: ctx.state.time, expiresAt: null };
    ctx.alert("good", `You're now a permanent resident of ${name}.`);
  }
  return null;
}

export const immigrationSystem: System = {
  id: "immigration",
  onDay(ctx) {
    const p = ctx.state.player;
    const now = ctx.state.time;
    const app = p.visaApplication;
    if (app && now >= app.decideAt) {
      p.visaApplication = null;
      const option = visaOptions(ctx, app.countryId).find((o) => o.visa === app.visa);
      const name =
        ctx.geography.countries.find((c) => c.id === app.countryId)?.name ?? app.countryId;
      if (option && ctx.rng.chance(option.chance)) {
        p.visas = [
          ...p.visas.filter((v) => v.countryId !== app.countryId),
          { countryId: app.countryId, visa: app.visa, validUntil: addDays(now, 180) },
        ];
        // Already living there? The new status applies right away.
        if (ctx.geography.cities[p.cityId]!.countryId === app.countryId) {
          const status: ResidencyStatus =
            app.visa === "visitor"
              ? "visitor"
              : app.visa === "work"
                ? "work"
                : app.visa === "student"
                  ? "student"
                  : "permanent";
          p.residency = {
            countryId: app.countryId,
            status,
            since: now,
            expiresAt:
              status === "work"
                ? addDays(now, 730)
                : status === "student"
                  ? addDays(now, 540)
                  : status === "visitor"
                    ? addDays(now, 90)
                    : null,
          };
          p.visas = p.visas.filter((v) => v.countryId !== app.countryId);
        }
        ctx.alert("good", `Your ${VISA_LABELS[app.visa].toLowerCase()} for ${name} was approved!`);
      } else {
        ctx.alert(
          "bad",
          `Your ${VISA_LABELS[app.visa].toLowerCase()} application for ${name} was rejected.`,
        );
      }
    }
    const r = p.residency;
    const here = ctx.geography.cities[p.cityId]!.countryId;
    if (
      r.countryId === here &&
      r.expiresAt !== null &&
      now >= r.expiresAt &&
      r.status !== "undocumented"
    ) {
      p.residency = { ...r, status: "undocumented", expiresAt: null };
      ctx.alert(
        "bad",
        "Your visa has expired. You're now living here without legal status: you can't hold formal jobs, and you risk deportation.",
      );
      if (p.job) leaveJob(ctx, "You lost your job because your visa expired.", "bad");
    }
  },
  onMonth(ctx) {
    const p = ctx.state.player;
    if (currentResidency(ctx).status !== "undocumented") return;
    const dev = countryOf(ctx, p.cityId).development;
    if (!ctx.rng.chance(0.02 + dev * 0.04)) return;
    // Deported to the first country of citizenship, to its capital.
    const home = ctx.geography.countries.find((c) => c.id === p.citizenship[0]);
    if (!home || home.capitalCityId === null) return;
    if (p.job) leaveJob(ctx, "You lost your job.", "bad");
    if (p.housing.kind === "renting") p.housing = { kind: "homeless" };
    p.housing = { kind: "homeless" };
    p.cityId = home.capitalCityId;
    p.residency = { countryId: home.id, status: "citizen", since: ctx.state.time, expiresAt: null };
    ensureCompanies(ctx, p.cityId);
    ctx.alert("bad", `You were caught by immigration authorities and deported to ${home.name}.`);
  },
};
