import type { GameTime } from "../core/calendar";
import type { GameContext } from "../core/game";
import type { System } from "../core/systems";
import { cityCosts, countryOf } from "../economy/costs";
import { transact } from "../finance/finance";
import { adjustReputation } from "../social/social";
import { formatMoney } from "../world/format";
import type { CityId } from "../world/geography";
import { PHASE_DEMAND } from "../work/companies";
import { SECTOR_LABELS, type Sector } from "../work/occupations";

export type WageLevel = "low" | "market" | "high";
export type PriceLevel = "budget" | "standard" | "premium";

export interface BusinessLocation {
  cityId: CityId;
  /** 1–5: floor space and equipment. Each level supports more staff. */
  size: number;
  openedAt: GameTime;
}

export interface BusinessMonth {
  time: GameTime;
  revenueCents: number;
  costsCents: number;
  profitCents: number;
  customersShare: number;
}

export interface Business {
  id: string;
  name: string;
  sector: Sector;
  ownerId: "player";
  foundedAt: GameTime;
  status: "active" | "closed" | "bankrupt";
  /** The company's own bank account, separate from the owner's cash. */
  cashCents: number;
  debtCents: number;
  locations: BusinessLocation[];
  employees: number;
  wageLevel: WageLevel;
  priceLevel: PriceLevel;
  marketingCents: number;
  /** 0–100 */
  quality: number;
  /** 0–100: how well known the brand is. */
  brand: number;
  /** 0–100 */
  morale: number;
  /** The player's ownership share, 0–1 (falls as investors buy in). */
  playerShare: number;
  /** Hours the owner put in this month. */
  ownerHours: number;
  /** Consecutive months the company ended with negative cash. */
  troubleMonths: number;
  history: BusinessMonth[];
}

export interface SectorEconomics {
  /** Share of household spending that goes to this sector. */
  spendShare: number;
  /** Share of revenue spent on materials and stock. */
  materials: number;
  /** Monthly revenue one worker can handle, as a multiple of the local median monthly wage. */
  productivity: number;
  description: string;
}

export const SECTOR_ECONOMICS: Record<Sector, SectorEconomics> = {
  hospitality: {
    spendShare: 0.06,
    materials: 0.35,
    productivity: 1.9,
    description: "Restaurants and cafés. Steady demand, thin margins.",
  },
  retail: {
    spendShare: 0.12,
    materials: 0.58,
    productivity: 2.8,
    description: "Shops. Big market, but most revenue goes to stock.",
  },
  logistics: {
    spendShare: 0.03,
    materials: 0.25,
    productivity: 1.8,
    description: "Warehousing and delivery for other businesses.",
  },
  construction: {
    spendShare: 0.05,
    materials: 0.42,
    productivity: 2.3,
    description: "Building and renovation. Swings hard with the economy.",
  },
  agriculture: {
    spendShare: 0.03,
    materials: 0.3,
    productivity: 1.7,
    description: "Farming. Cheap to run, low prices.",
  },
  manufacturing: {
    spendShare: 0.05,
    materials: 0.45,
    productivity: 2.6,
    description: "Making goods. Needs scale to pay off.",
  },
  office: {
    spendShare: 0.04,
    materials: 0.08,
    productivity: 1.5,
    description: "Consulting and business services. High margins.",
  },
  healthcare: {
    spendShare: 0.06,
    materials: 0.2,
    productivity: 1.7,
    description: "Clinics and care homes. Recession-proof.",
  },
  tech: {
    spendShare: 0.03,
    materials: 0.08,
    productivity: 1.6,
    description: "Software and IT. High margins if you build a brand.",
  },
  education: {
    spendShare: 0.02,
    materials: 0.12,
    productivity: 1.5,
    description: "Tutoring and training.",
  },
  security: {
    spendShare: 0.01,
    materials: 0.1,
    productivity: 1.4,
    description: "Guards and security services. Small market.",
  },
  transport: {
    spendShare: 0.02,
    materials: 0.35,
    productivity: 1.9,
    description: "Taxis, buses and trucking.",
  },
};

const WAGE: Record<WageLevel, { pay: number; morale: number; label: string }> = {
  low: { pay: 0.85, morale: 35, label: "Below market" },
  market: { pay: 1, morale: 55, label: "Market rate" },
  high: { pay: 1.2, morale: 75, label: "Above market" },
};
const PRICE: Record<PriceLevel, { appeal: number; price: number; label: string }> = {
  budget: { appeal: 1.3, price: 0.85, label: "Budget" },
  standard: { appeal: 1, price: 1, label: "Standard" },
  premium: { appeal: 0.7, price: 1.3, label: "Premium" },
};
export const WAGE_LABELS = Object.fromEntries(
  Object.entries(WAGE).map(([k, v]) => [k, v.label]),
) as Record<WageLevel, string>;
export const PRICE_LABELS = Object.fromEntries(
  Object.entries(PRICE).map(([k, v]) => [k, v.label]),
) as Record<PriceLevel, string>;

/** Staff each location size can hold. */
export const STAFF_PER_SIZE = 8;

const monthlyWage = (ctx: GameContext, cityId: CityId) =>
  cityCosts(ctx, cityId).medianWageCents * 160;

export function businessById(ctx: GameContext, id: string): Business | undefined {
  return ctx.state.businesses.find((b) => b.id === id);
}

export function activeBusinesses(ctx: GameContext): Business[] {
  return ctx.state.businesses.filter((b) => b.status === "active");
}

export function staffCapacity(b: Business): number {
  return b.locations.reduce((s, l) => s + l.size * STAFF_PER_SIZE, 0);
}

// ---------------------------------------------------------------------------------------------
// Costs of decisions

export function foundingCost(ctx: GameContext): { fee: number; minCapital: number } {
  const wage = cityCosts(ctx, ctx.state.player.cityId).medianWageCents;
  return { fee: wage * 30, minCapital: wage * 120 };
}

export function locationSetupCost(ctx: GameContext, cityId: CityId): number {
  return cityCosts(ctx, cityId).rentCents("oneBed") * 8;
}

export function upgradeCost(ctx: GameContext, b: Business, index: number): number {
  const loc = b.locations[index];
  if (!loc) return 0;
  return cityCosts(ctx, loc.cityId).rentCents("oneBed") * 6 * loc.size;
}

/** What the business is worth: a multiple of recent profit plus net assets. */
export function valuation(b: Business): number {
  const recent = b.history.slice(-6);
  const avgProfit = recent.length
    ? recent.reduce((s, m) => s + m.profitCents, 0) / recent.length
    : 0;
  const assets = b.locations.reduce((s, l) => s + l.size, 0);
  return Math.max(0, Math.round(avgProfit * 12 * 3 + b.cashCents - b.debtCents + assets * 0));
}

// ---------------------------------------------------------------------------------------------
// Commands

function getActive(ctx: GameContext, id: string): Business | string {
  const b = businessById(ctx, id);
  if (!b || b.status !== "active") return "That business isn't operating.";
  return b;
}

export function foundBusiness(
  ctx: GameContext,
  name: string,
  sector: Sector,
  capitalCents: number,
): string | null {
  const p = ctx.state.player;
  const clean = name.trim().replace(/\s+/g, " ");
  if (clean.length < 2 || clean.length > 40) return "Choose a name (2–40 characters).";
  if (!SECTOR_ECONOMICS[sector]) return "Unknown sector.";
  if (activeBusinesses(ctx).length >= 5) return "You can run at most 5 businesses.";
  const { fee, minCapital } = foundingCost(ctx);
  if (!Number.isInteger(capitalCents) || capitalCents < minCapital)
    return `Start with at least ${formatMoney(minCapital, true)} in capital.`;
  if (p.cashCents < fee + capitalCents)
    return `You need ${formatMoney(fee + capitalCents, true)} (registration fee plus capital).`;
  transact(ctx, -fee, "other", `Registered ${clean}`);
  transact(ctx, -capitalCents, "other", `Capital for ${clean}`);
  const b: Business = {
    id: `b${ctx.state.nextBusinessId++}`,
    name: clean,
    sector,
    ownerId: "player",
    foundedAt: ctx.state.time,
    status: "active",
    cashCents: capitalCents,
    debtCents: 0,
    locations: [{ cityId: p.cityId, size: 1, openedAt: ctx.state.time }],
    employees: 0,
    wageLevel: "market",
    priceLevel: "standard",
    marketingCents: 0,
    quality: 45,
    brand: 5,
    morale: 60,
    playerShare: 1,
    ownerHours: 0,
    troubleMonths: 0,
    history: [],
  };
  ctx.state.businesses.push(b);
  adjustReputation(ctx, "business", 3);
  ctx.alert(
    "good",
    `You founded ${clean}, a ${SECTOR_LABELS[sector].toLowerCase()} business. Hire staff and work on it to get it going.`,
    "work",
  );
  return null;
}

export function setStaff(ctx: GameContext, id: string, employees: number): string | null {
  const b = getActive(ctx, id);
  if (typeof b === "string") return b;
  if (!Number.isInteger(employees) || employees < 0) return "Invalid number of staff.";
  if (employees > staffCapacity(b))
    return `Your locations only have room for ${staffCapacity(b)} staff. Upgrade or open a location.`;
  const wage = monthlyWage(ctx, b.locations[0]!.cityId) * WAGE[b.wageLevel].pay;
  const change = employees - b.employees;
  // Hiring costs a week of wages per person; layoffs cost two weeks of severance and morale.
  const cost = Math.round(change > 0 ? change * wage * 0.25 : -change * wage * 0.5);
  if (cost > b.cashCents) return `The business needs ${formatMoney(cost, true)} for that.`;
  b.cashCents -= cost;
  if (change < 0) {
    b.morale = Math.max(0, b.morale + change * 3);
    adjustReputation(ctx, "workers", change * 0.5);
  }
  b.employees = employees;
  return null;
}

export function setPolicy(
  ctx: GameContext,
  id: string,
  policy: { wageLevel?: WageLevel; priceLevel?: PriceLevel; marketingCents?: number },
): string | null {
  const b = getActive(ctx, id);
  if (typeof b === "string") return b;
  if (policy.wageLevel) {
    if (!WAGE[policy.wageLevel]) return "Invalid wage level.";
    b.wageLevel = policy.wageLevel;
  }
  if (policy.priceLevel) {
    if (!PRICE[policy.priceLevel]) return "Invalid price level.";
    b.priceLevel = policy.priceLevel;
  }
  if (policy.marketingCents !== undefined) {
    if (!Number.isInteger(policy.marketingCents) || policy.marketingCents < 0)
      return "Invalid marketing budget.";
    b.marketingCents = policy.marketingCents;
  }
  return null;
}

export function investInBusiness(ctx: GameContext, id: string, amountCents: number): string | null {
  const b = getActive(ctx, id);
  if (typeof b === "string") return b;
  if (!Number.isInteger(amountCents) || amountCents <= 0) return "Choose an amount.";
  if (amountCents > ctx.state.player.cashCents) return "You don't have that much cash.";
  transact(ctx, -amountCents, "other", `Invested in ${b.name}`);
  b.cashCents += amountCents;
  if (b.cashCents >= 0) b.troubleMonths = 0;
  return null;
}

export function withdrawFromBusiness(
  ctx: GameContext,
  id: string,
  amountCents: number,
): string | null {
  const b = getActive(ctx, id);
  if (typeof b === "string") return b;
  if (!Number.isInteger(amountCents) || amountCents <= 0) return "Choose an amount.";
  if (amountCents > b.cashCents) return "The business doesn't have that much cash.";
  b.cashCents -= amountCents;
  // Investors get their share of any payout.
  const yours = Math.round(amountCents * b.playerShare);
  const tax = Math.round(yours * countryOf(ctx, b.locations[0]!.cityId).taxes.income * 0.6);
  transact(ctx, yours - tax, "wages", `Payout from ${b.name} (${formatMoney(tax)} tax)`);
  return null;
}

export function openLocation(ctx: GameContext, id: string, cityId: CityId): string | null {
  const b = getActive(ctx, id);
  if (typeof b === "string") return b;
  const geoCity = ctx.geography.cities[cityId];
  if (!geoCity) return "Unknown city.";
  if (geoCity.countryId !== ctx.geography.cities[b.locations[0]!.cityId]!.countryId) {
    return "You can only expand within the same country (for now).";
  }
  if (b.locations.some((l) => l.cityId === cityId)) return "You already have a location there.";
  const cost = locationSetupCost(ctx, cityId);
  if (cost > b.cashCents) return `Opening there costs ${formatMoney(cost, true)}.`;
  b.cashCents -= cost;
  b.locations.push({ cityId, size: 1, openedAt: ctx.state.time });
  ctx.alert("good", `${b.name} opened a location in ${geoCity.name}.`, "work");
  return null;
}

export function upgradeLocation(ctx: GameContext, id: string, index: number): string | null {
  const b = getActive(ctx, id);
  if (typeof b === "string") return b;
  const loc = b.locations[index];
  if (!loc) return "Unknown location.";
  if (loc.size >= 5) return "That location is already as big as it gets.";
  const cost = upgradeCost(ctx, b, index);
  if (cost > b.cashCents) return `The upgrade costs ${formatMoney(cost, true)}.`;
  b.cashCents -= cost;
  loc.size++;
  return null;
}

/** Sells part of the company to investors for cash in the business account. */
export function raiseInvestment(ctx: GameContext, id: string, sharePercent: number): string | null {
  const b = getActive(ctx, id);
  if (typeof b === "string") return b;
  if (![5, 10, 20, 30].includes(sharePercent)) return "Investors buy 5, 10, 20 or 30% stakes.";
  const share = sharePercent / 100;
  if (b.playerShare - share < 0.51) return "You'd lose majority control.";
  if (b.history.length < 3 || b.history.slice(-3).every((m) => m.revenueCents === 0)) {
    return "Investors want to see at least 3 months of sales.";
  }
  const value = valuation(b);
  if (value <= 0) return "Investors don't see any value in the business yet.";
  const price = Math.round(value * share);
  b.playerShare = Math.round((b.playerShare - share) * 1000) / 1000;
  b.cashCents += price;
  ctx.alert(
    "good",
    `Investors bought ${sharePercent}% of ${b.name} for ${formatMoney(price, true)}.`,
    "money",
  );
  return null;
}

export function sellBusiness(ctx: GameContext, id: string): string | null {
  const b = getActive(ctx, id);
  if (typeof b === "string") return b;
  const value = valuation(b);
  const yours = Math.round(value * b.playerShare);
  b.status = "closed";
  if (yours > 0) transact(ctx, yours, "other", `Sold ${b.name}`);
  ctx.alert(
    "good",
    `You sold ${b.name}${yours > 0 ? ` for ${formatMoney(yours, true)}` : ""}.`,
    "money",
  );
  adjustReputation(ctx, "fame", 2);
  return null;
}

export function closeBusiness(ctx: GameContext, id: string): string | null {
  const b = getActive(ctx, id);
  if (typeof b === "string") return b;
  b.status = "closed";
  if (b.employees > 0) adjustReputation(ctx, "workers", -b.employees * 0.3);
  const left = Math.max(0, b.cashCents - b.debtCents);
  if (left > 0)
    transact(ctx, Math.round(left * b.playerShare), "other", `Closed ${b.name}: remaining cash`);
  ctx.alert("info", `You closed ${b.name}.`, "work");
  return null;
}

// ---------------------------------------------------------------------------------------------
// Monthly simulation

/** NPC competitors in a sector and city: the real companies there, or at least what the market size suggests. */
function competitors(ctx: GameContext, sector: Sector, cityId: CityId): number {
  const world = ctx.state.world;
  const pop = world.cities[cityId]?.population ?? 0;
  const expected = Math.max(
    1,
    Math.round((pop / 120_000) * SECTOR_ECONOMICS[sector].spendShare * 25),
  );
  const real = world.companyCities.includes(cityId)
    ? world.companies.filter((c) => c.cityId === cityId && c.sector === sector).length
    : 0;
  return Math.max(expected, real);
}

export interface MonthlyResult {
  revenue: number;
  costs: number;
  profit: number;
  share: number;
}

/** Runs one month of a business. Exposed for tests and for showing projections. */
export function runBusinessMonth(ctx: GameContext, b: Business, commit: boolean): MonthlyResult {
  const econ = SECTOR_ECONOMICS[b.sector];
  const price = PRICE[b.priceLevel];
  const wage = WAGE[b.wageLevel];
  let revenue = 0;
  let wages = 0;
  let rent = 0;
  let shareSum = 0;
  // Staff are split across locations by size; the owner's hours count as extra staff.
  const totalSize = b.locations.reduce((s, l) => s + l.size, 0) || 1;
  const ownerFte = Math.min(1.2, b.ownerHours / 160);
  for (const loc of b.locations) {
    const city = ctx.state.world.cities[loc.cityId];
    if (!city) continue;
    const country = countryOf(ctx, loc.cityId);
    const monthly = monthlyWage(ctx, loc.cityId);
    const demand =
      city.population *
      city.medianWageCents *
      160 *
      0.55 *
      econ.spendShare *
      PHASE_DEMAND[country.economy.phase];
    const appeal = (b.quality / 50) ** 1.3 * ((b.brand + 15) / 40) * price.appeal;
    const rivals = competitors(ctx, b.sector, loc.cityId);
    const share = appeal / (appeal + rivals * 1.1);
    const staff = b.employees * (loc.size / totalSize) + (loc === b.locations[0] ? ownerFte : 0);
    const capacity = staff * monthly * econ.productivity * (0.7 + b.morale / 200);
    // Customers only find you as your brand grows: a new business starts with few of them.
    const awareness = 0.15 + 0.85 * (b.brand / 100);
    revenue += Math.min(demand * share * awareness, capacity) * price.price;
    wages += b.employees * (loc.size / totalSize) * monthly * wage.pay;
    rent += cityCosts(ctx, loc.cityId).rentCents("oneBed") * loc.size * 1.5;
    shareSum += share;
  }
  const materials = revenue * econ.materials;
  const interest = (b.debtCents * 0.1) / 12;
  const preTax = revenue - wages - rent - materials - b.marketingCents - interest;
  const tax = Math.max(0, preTax) * countryOf(ctx, b.locations[0]!.cityId).taxes.corporate;
  const profit = Math.round(preTax - tax);
  const costs = Math.round(revenue - profit);
  const result = {
    revenue: Math.round(revenue),
    costs,
    profit,
    share: shareSum / Math.max(1, b.locations.length),
  };
  if (!commit) return result;

  b.cashCents += profit;
  // Quality improves with good pay, morale and the owner's attention; brand with marketing and quality.
  const qualityTarget =
    30 +
    b.morale * 0.3 +
    (b.wageLevel === "high" ? 10 : b.wageLevel === "low" ? -8 : 0) +
    Math.min(20, b.ownerHours / 8);
  b.quality = Math.round(
    Math.max(5, Math.min(100, b.quality + (qualityTarget - b.quality) * 0.25)),
  );
  const medianMonthly = monthlyWage(ctx, b.locations[0]!.cityId);
  const marketingPush = 12 * Math.log10(1 + b.marketingCents / Math.max(1, medianMonthly * 0.3));
  b.brand = Math.round(
    Math.max(
      0,
      Math.min(
        100,
        b.brand * 0.95 + marketingPush * 0.5 + (b.quality - 50) * 0.05 + result.share * 4,
      ),
    ),
  );
  const capacityUse =
    b.employees > 0
      ? Math.min(
          1.5,
          revenue / price.price / Math.max(1, b.employees * medianMonthly * econ.productivity),
        )
      : 1;
  const moraleTarget = wage.morale + (capacityUse > 1.1 ? -10 : 5);
  b.morale = Math.round(Math.max(0, Math.min(100, b.morale + (moraleTarget - b.morale) * 0.3)));
  b.history.push({
    time: ctx.state.time,
    revenueCents: result.revenue,
    costsCents: costs,
    profitCents: profit,
    customersShare: result.share,
  });
  if (b.history.length > 24) b.history.shift();
  b.ownerHours = 0;
  return result;
}

export const businessSystem: System = {
  id: "business",
  onMonth(ctx) {
    for (const b of activeBusinesses(ctx)) {
      const r = runBusinessMonth(ctx, b, true);
      if (b.cashCents < 0) {
        b.troubleMonths++;
        if (b.troubleMonths >= 2) {
          b.status = "bankrupt";
          adjustReputation(ctx, "business", -8);
          adjustReputation(ctx, "workers", -b.employees * 0.4);
          ctx.alert(
            "bad",
            `${b.name} went bankrupt. The business is gone, but you aren't personally liable for its debts.`,
            "work",
          );
          continue;
        }
        ctx.alert(
          "bad",
          `${b.name} is out of cash (${formatMoney(b.cashCents, true)}). Invest money or cut costs, or it will go bankrupt next month.`,
          "work",
        );
      } else {
        b.troubleMonths = 0;
        ctx.log(
          "work",
          `${b.name}: ${formatMoney(r.revenue, true)} revenue, ${r.profit >= 0 ? "profit" : "loss"} of ${formatMoney(Math.abs(r.profit), true)}.`,
        );
      }
      if (b.employees >= 50) adjustReputation(ctx, "fame", 0.5);
      if (r.profit > 0) adjustReputation(ctx, "business", 0.3);
      if (b.wageLevel === "high" && b.employees > 0) adjustReputation(ctx, "workers", 0.3);
    }
  },
};
