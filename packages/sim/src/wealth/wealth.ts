import { activeBusinesses, valuation } from "../business/business";
import { addDays } from "../core/calendar";
import type { GameContext } from "../core/game";
import type { System } from "../core/systems";
import { CRIME_SEVERITY } from "../crime/crime";
import { cityCosts, countryOf } from "../economy/costs";
import { totalDebtCents, transact } from "../finance/finance";
import { documentedIncome } from "../finance/income";
import { legislatureFor, playerOffices } from "../politics/government";
import { createBill } from "../politics/bills";
import { policyFor } from "../politics/policies";
import { adjustReputation } from "../social/social";
import { formatMoney } from "../world/format";
import type { CityId, CountryId } from "../world/geography";
import { countryName } from "../world/territory";
import type { CountryState, Resource } from "../world/types";
import {
  bondYield,
  commodityPrice,
  COMMODITIES,
  defaultRisk,
  ensureRichList,
  stockIndex,
  updateMarkets,
} from "./markets";
import type { Holding, HoldingKind, MediaOutlet, Property, PropertyKind } from "./types";

const UNIT = 10_000; // $100 per unit at a price level of 1 (or an index of 100)
const MIN_TRADE = 10_000;

function wage(ctx: GameContext): number {
  return cityCosts(ctx, ctx.state.player.cityId).medianWageCents;
}

function playerCountryState(ctx: GameContext): CountryState {
  return countryOf(ctx, ctx.state.player.cityId);
}

function monthlyGdp(c: CountryState): number {
  return (c.gdpPerCapita * 100 * c.population) / 12;
}

/** Tax on investment gains where the player lives. */
export function capitalGainsRate(ctx: GameContext): number {
  return Math.round(Math.min(0.4, playerCountryState(ctx).taxes.income * 0.5) * 1000) / 1000;
}

function nextId(ctx: GameContext, prefix: string): string {
  return `${prefix}${ctx.state.wealth.nextId++}`;
}

// ---------------------------------------------------------------------------------------------
// Savings and offshore accounts

/** Yearly interest on savings where the player lives (banks pay a little under inflation). */
export function savingsRate(ctx: GameContext): number {
  const c = playerCountryState(ctx);
  return Math.round(Math.max(0, Math.min(0.2, c.inflation * 0.6 + 0.005)) * 10000) / 10000;
}

/** Positive amounts deposit into savings, negative ones withdraw. */
export function moveSavings(ctx: GameContext, amountCents: number): string | null {
  const w = ctx.state.wealth;
  const p = ctx.state.player;
  if (!Number.isInteger(amountCents) || amountCents === 0) return "Enter an amount.";
  if (amountCents > 0 && amountCents > p.cashCents) return "You don't have that much cash.";
  if (amountCents < 0 && -amountCents > w.savingsCents) return "Your savings aren't that large.";
  w.savingsCents += amountCents;
  p.cashCents -= amountCents;
  return null;
}

/**
 * Money moved offshore escapes taxes and courts, but hiding it is fraud: a secret that can come
 * out as a scandal. Positive amounts move money offshore, negative ones bring it home.
 */
export function moveOffshore(ctx: GameContext, amountCents: number): string | null {
  const w = ctx.state.wealth;
  const p = ctx.state.player;
  if (!Number.isInteger(amountCents) || amountCents === 0) return "Enter an amount.";
  if (amountCents < 0) {
    if (-amountCents > w.offshoreCents) return "Your offshore account isn't that large.";
    w.offshoreCents += amountCents;
    p.cashCents -= amountCents;
    return null;
  }
  if (amountCents > p.cashCents) return "You don't have that much cash.";
  const fee = Math.round(amountCents * 0.02);
  p.cashCents -= amountCents;
  w.offshoreCents += amountCents - fee;
  if (amountCents >= wage(ctx) * 100) {
    p.legal.secrets.push({ crime: "fraud", time: ctx.state.time, severity: CRIME_SEVERITY.fraud });
    if (p.legal.secrets.length > 20) p.legal.secrets.shift();
  }
  ctx.log(
    "money",
    `Moved ${formatMoney(amountCents, true)} offshore (fee ${formatMoney(fee, true)}).`,
  );
  return null;
}

// ---------------------------------------------------------------------------------------------
// Investments

/** Price of one unit of a holding right now, in cents. */
export function unitPrice(ctx: GameContext, kind: HoldingKind, target: string): number {
  if (kind === "stocks") return Math.round((stockIndex(ctx, target) / 100) * UNIT);
  if (kind === "commodity") return Math.round(commodityPrice(ctx, target as Resource) * UNIT);
  return UNIT;
}

export function holdingValue(ctx: GameContext, h: Holding): number {
  return Math.round(h.units * unitPrice(ctx, h.kind, h.target));
}

function validTarget(ctx: GameContext, kind: HoldingKind, target: string): boolean {
  if (kind === "commodity") return COMMODITIES.includes(target as Resource);
  return (ctx.state.world.countries[target]?.population ?? 0) > 0;
}

export function buyInvestment(
  ctx: GameContext,
  kind: HoldingKind,
  target: string,
  amountCents: number,
): string | null {
  const p = ctx.state.player;
  if (!["stocks", "bonds", "commodity"].includes(kind)) return "Unknown investment.";
  if (!validTarget(ctx, kind, target)) return "That market doesn't exist.";
  if (!Number.isInteger(amountCents) || amountCents < MIN_TRADE)
    return `The minimum is ${formatMoney(MIN_TRADE, true)}.`;
  if (amountCents > p.cashCents) return "You don't have that much cash.";
  const fee = Math.round(amountCents * 0.005);
  const units = (amountCents - fee) / unitPrice(ctx, kind, target);
  const w = ctx.state.wealth;
  let h = w.holdings.find((x) => x.kind === kind && x.target === target);
  if (!h) {
    h = { id: nextId(ctx, "h"), kind, target, units: 0, costCents: 0 };
    w.holdings.push(h);
  }
  h.units += units;
  h.costCents += amountCents;
  transact(ctx, -amountCents, "other", `Bought ${investmentLabel(ctx, kind, target)}`);
  return null;
}

export function investmentLabel(ctx: GameContext, kind: HoldingKind, target: string): string {
  if (kind === "commodity") return `${target} futures`;
  return `${countryName(ctx, target)} ${kind === "stocks" ? "stocks" : "government bonds"}`;
}

/** Sells part of a holding; gains are taxed where the player lives. */
export function sellInvestment(
  ctx: GameContext,
  holdingId: string,
  fraction: number,
): string | null {
  const w = ctx.state.wealth;
  const h = w.holdings.find((x) => x.id === holdingId);
  if (!h) return "You don't own that.";
  if (!(fraction > 0 && fraction <= 1)) return "Choose how much to sell.";
  const proceeds = Math.round(holdingValue(ctx, h) * fraction * 0.995);
  const cost = Math.round(h.costCents * fraction);
  const tax = Math.max(0, Math.round((proceeds - cost) * capitalGainsRate(ctx)));
  h.units *= 1 - fraction;
  h.costCents -= cost;
  if (fraction >= 0.999 || h.units < 1e-6) w.holdings = w.holdings.filter((x) => x !== h);
  transact(ctx, proceeds, "other", `Sold ${investmentLabel(ctx, h.kind, h.target)}`);
  if (tax > 0) transact(ctx, -tax, "other", "Capital gains tax");
  return null;
}

/** Dividends, bond coupons and defaults. */
function investmentIncome(ctx: GameContext): void {
  const w = ctx.state.wealth;
  let income = 0;
  for (const h of [...w.holdings]) {
    if (h.kind === "commodity") continue;
    const c = ctx.state.world.countries[h.target];
    if (!c || c.population === 0) {
      // The country is gone, and the investments with it.
      w.holdings = w.holdings.filter((x) => x !== h);
      ctx.alert(
        "bad",
        `Your ${investmentLabel(ctx, h.kind, h.target)} are worthless now.`,
        "money",
      );
      continue;
    }
    if (h.kind === "stocks") {
      income += holdingValue(ctx, h) * 0.002;
      continue;
    }
    if (ctx.rng.chance(defaultRisk(c))) {
      h.units *= 0.4;
      ctx.alert(
        "bad",
        `${countryName(ctx, h.target)} defaulted on its debt. Your bonds lost 60%.`,
        "money",
      );
      c.stability = Math.max(0, c.stability - 10);
      continue;
    }
    income += (holdingValue(ctx, h) * bondYield(c)) / 12;
  }
  if (w.savingsCents > 0) income += (w.savingsCents * savingsRate(ctx)) / 12;
  // Offshore money earns a little and pays no tax.
  w.offshoreCents = Math.round(w.offshoreCents * (1 + 0.02 / 12));
  const net = Math.round(income * (1 - capitalGainsRate(ctx)));
  if (net > 0) transact(ctx, net, "other", "Dividends and interest (after tax)");
}

// ---------------------------------------------------------------------------------------------
// Real estate

const PROPERTY: Record<PropertyKind, { label: string; rentMultiple: number }> = {
  apartment: { label: "Apartment", rentMultiple: 1 },
  house: { label: "House", rentMultiple: 2.2 },
  commercial: { label: "Commercial building", rentMultiple: 3.5 },
};

export const PROPERTY_KINDS = Object.keys(PROPERTY) as PropertyKind[];

export function propertyLabel(kind: PropertyKind): string {
  return PROPERTY[kind].label;
}

/** Asking price for a property in a city: about ten years of its rent. */
export function propertyPrice(ctx: GameContext, cityId: CityId, kind: PropertyKind): number {
  return Math.round(cityCosts(ctx, cityId).rentCents("oneBed") * PROPERTY[kind].rentMultiple * 120);
}

export function propertyValue(ctx: GameContext, prop: Property): number {
  const rent = ctx.state.world.cities[prop.cityId]?.rentCents ?? prop.basisRentCents;
  return Math.round(
    prop.purchasePriceCents * (rent / prop.basisRentCents) * (prop.renovated ? 1.15 : 1),
  );
}

/** Monthly rent from tenants. */
export function propertyRent(ctx: GameContext, prop: Property): number {
  return Math.round(propertyValue(ctx, prop) / 160);
}

function livesIn(ctx: GameContext, prop: Property): boolean {
  const h = ctx.state.player.housing;
  return h.kind === "owned" && h.propertyId === prop.id;
}

export function mortgageRate(ctx: GameContext): number {
  return (
    Math.round(Math.max(0.02, Math.min(0.4, playerCountryState(ctx).inflation + 0.03)) * 10000) /
    10000
  );
}

function payment(principal: number, yearlyRate: number, months = 300): number {
  const r = yearlyRate / 12;
  return Math.round((principal * r) / (1 - (1 + r) ** -months));
}

/** Steady pay (job or business salary) and rents that count toward a mortgage application. */
function qualifyingIncome(ctx: GameContext): number {
  return documentedIncome(ctx).total;
}

export function buyProperty(
  ctx: GameContext,
  cityId: CityId,
  kind: PropertyKind,
  withMortgage: boolean,
): string | null {
  const p = ctx.state.player;
  const city = ctx.geography.cities[cityId];
  if (!city || !PROPERTY[kind]) return "Unknown property.";
  if (city.countryId !== ctx.geography.cities[p.cityId]!.countryId)
    return "You can only buy property in the country you live in.";
  const price = propertyPrice(ctx, cityId, kind);
  const fees = Math.round(price * 0.02);
  let mortgage: Property["mortgage"] = null;
  let upfront = price + fees;
  if (withMortgage) {
    const loan = Math.round(price * 0.8);
    const rate = mortgageRate(ctx);
    const monthly = payment(loan, rate);
    if ((p.finance.creditScore ?? 620) < 580)
      return "Banks won't lend to you with your credit score.";
    if (qualifyingIncome(ctx) < monthly * 2.5)
      return `The bank wants income of ${formatMoney(monthly * 2.5, true)}/month (2.5× the payment).`;
    mortgage = { balanceCents: loan, monthlyCents: monthly, rate };
    upfront = price - loan + fees;
  }
  if (upfront > p.cashCents) return `You need ${formatMoney(upfront, true)} up front.`;
  transact(ctx, -upfront, "deposit", `${PROPERTY[kind].label} in ${city.name}`);
  ctx.state.wealth.properties.push({
    id: nextId(ctx, "re"),
    kind,
    cityId,
    purchasePriceCents: price,
    basisRentCents: ctx.state.world.cities[cityId]!.rentCents,
    renovated: false,
    rentedOut: false,
    vacant: false,
    mortgage,
    boughtAt: ctx.state.time,
  });
  ctx.alert("good", `You bought a ${PROPERTY[kind].label.toLowerCase()} in ${city.name}.`, "money");
  return null;
}

function propertyById(ctx: GameContext, id: string): Property | undefined {
  return ctx.state.wealth.properties.find((x) => x.id === id);
}

export function sellProperty(ctx: GameContext, id: string, forced = false): string | null {
  const prop = propertyById(ctx, id);
  if (!prop) return "You don't own that.";
  const value = propertyValue(ctx, prop) * (forced ? 0.8 : 0.94);
  const owed = prop.mortgage?.balanceCents ?? 0;
  const gain = Math.max(0, value - prop.purchasePriceCents);
  const tax = Math.round(gain * capitalGainsRate(ctx));
  const net = Math.round(value - owed - tax);
  if (livesIn(ctx, prop)) ctx.state.player.housing = { kind: "homeless" };
  ctx.state.wealth.properties = ctx.state.wealth.properties.filter((x) => x !== prop);
  transact(
    ctx,
    net,
    "other",
    forced ? "Foreclosure sale" : `Sold ${PROPERTY[prop.kind].label.toLowerCase()}`,
  );
  return null;
}

export function renovateProperty(ctx: GameContext, id: string): string | null {
  const prop = propertyById(ctx, id);
  if (!prop) return "You don't own that.";
  if (prop.renovated) return "It's already been renovated.";
  const cost = Math.round(propertyValue(ctx, prop) * 0.1);
  if (cost > ctx.state.player.cashCents) return `Renovating costs ${formatMoney(cost, true)}.`;
  transact(ctx, -cost, "other", "Renovation");
  prop.renovated = true;
  return null;
}

export function setRentedOut(ctx: GameContext, id: string, rentOut: boolean): string | null {
  const prop = propertyById(ctx, id);
  if (!prop) return "You don't own that.";
  if (rentOut && livesIn(ctx, prop)) return "You live there.";
  prop.rentedOut = rentOut;
  prop.vacant = false;
  return null;
}

/** Makes an owned home the player's residence. */
export function moveIntoProperty(ctx: GameContext, id: string): string | null {
  const p = ctx.state.player;
  const prop = propertyById(ctx, id);
  if (!prop) return "You don't own that.";
  if (prop.kind === "commercial") return "You can't live in a commercial building.";
  if (prop.cityId !== p.cityId) return "It's in another city. Move there first.";
  if (p.housing.kind === "renting" && p.housing.missedPayments === 0)
    transact(ctx, p.housing.rentCents, "deposit", "Security deposit returned");
  prop.rentedOut = false;
  p.housing = { kind: "owned", propertyId: prop.id };
  p.shelterBedUntil = null;
  ctx.alert("good", "You moved into a home of your own.");
  return null;
}

function propertyMonth(ctx: GameContext): void {
  for (const prop of [...ctx.state.wealth.properties]) {
    const value = propertyValue(ctx, prop);
    let net = -Math.round(value * 0.002); // upkeep and property tax
    if (prop.rentedOut && !livesIn(ctx, prop)) {
      // Tenants come and go: some months a unit sits empty.
      prop.vacant = ctx.rng.chance(prop.vacant ? 0.5 : 0.08);
      if (!prop.vacant) net += propertyRent(ctx, prop);
    }
    if (net !== 0) transact(ctx, net, "rent", `${PROPERTY[prop.kind].label} income and upkeep`);
    const m = prop.mortgage;
    if (!m) continue;
    const interest = Math.round((m.balanceCents * m.rate) / 12);
    const due = Math.min(m.monthlyCents, m.balanceCents + interest);
    if (due > ctx.state.player.cashCents) {
      ctx.alert(
        "bad",
        "You couldn't make your mortgage payment. The bank has foreclosed.",
        "money",
      );
      ctx.state.player.finance.creditScore = Math.max(
        300,
        (ctx.state.player.finance.creditScore ?? 620) - 120,
      );
      sellProperty(ctx, prop.id, true);
      continue;
    }
    transact(ctx, -due, "debtPayment", "Mortgage payment");
    m.balanceCents = Math.max(0, m.balanceCents + interest - due);
    if (m.balanceCents === 0) {
      prop.mortgage = null;
      ctx.alert("good", "You paid off a mortgage!", "money");
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Influence: donations, lobbying and media

export function donationMinimum(ctx: GameContext): number {
  return wage(ctx) * 20;
}

export function donate(ctx: GameContext, partyId: string, amountCents: number): string | null {
  const p = ctx.state.player;
  const country = playerCountryState(ctx);
  const party = country.parties.find((x) => x.id === partyId);
  if (!party) return "That party isn't active here.";
  if (!Number.isInteger(amountCents) || amountCents < donationMinimum(ctx))
    return `Donations start at ${formatMoney(donationMinimum(ctx), true)}.`;
  if (amountCents > p.cashCents) return "You don't have that much cash.";
  transact(ctx, -amountCents, "other", `Donation to the ${party.name}`);
  const bump = Math.min(0.03, (0.01 * amountCents) / Math.max(1, monthlyGdp(country) * 1e-5));
  party.popularity += bump;
  const total = country.parties.reduce((s, x) => s + x.popularity, 0);
  for (const x of country.parties)
    x.popularity = Math.round((x.popularity / total) * 10000) / 10000;
  if (p.politics.partyId === partyId)
    p.politics.standing += Math.min(30, amountCents / (wage(ctx) * 50));
  adjustReputation(ctx, "establishment", Math.min(4, amountCents / (wage(ctx) * 200)));
  ctx.log("politics", `You donated ${formatMoney(amountCents, true)} to the ${party.name}.`);
  return null;
}

export function lobbyingCost(ctx: GameContext): number {
  return Math.max(wage(ctx) * 500, Math.round(monthlyGdp(playerCountryState(ctx)) * 2e-6));
}

/** Pays lobbyists to get a friendly legislator to put a bill to a vote. */
export function lobby(ctx: GameContext, policyId: string, direction: 1 | -1): string | null {
  const p = ctx.state.player;
  const country = playerCountryState(ctx);
  const scope = `national:${country.id}`;
  const policy = policyFor(policyId, "national");
  if (!policy) return "Unknown policy.";
  if (direction !== 1 && direction !== -1) return "Choose a direction.";
  const value = policy.get(ctx, scope);
  if ((direction > 0 && value >= policy.max) || (direction < 0 && value <= policy.min))
    return "That policy can't go any further.";
  const body = legislatureFor(ctx, scope);
  const sponsor = body?.holders.find((h) => h !== "player");
  if (!body || !sponsor) return "There's no legislature to lobby here.";
  if ((p.cooldowns.lobby ?? 0) > ctx.state.time)
    return "Your lobbyists are still working the last bill.";
  const cost = lobbyingCost(ctx);
  if (cost > p.cashCents) return `A lobbying campaign costs ${formatMoney(cost, true)}.`;
  transact(ctx, -cost, "other", "Lobbying firm");
  p.cooldowns.lobby = addDays(ctx.state.time, 60);
  createBill(ctx, scope, policyId, direction, sponsor);
  adjustReputation(ctx, "business", 2);
  ctx.alert(
    "info",
    `Your lobbyists got a bill introduced: ${direction > 0 ? "raise" : "lower"} ${policy.label.toLowerCase()}.`,
    "politics",
  );
  return null;
}

export function mediaPrice(ctx: GameContext): number {
  return Math.max(wage(ctx) * 2000, Math.round(monthlyGdp(playerCountryState(ctx)) * 1e-5));
}

const MEDIA_NAMES = ["Herald", "Tribune", "Daily", "News Network", "Post", "Observer", "Chronicle"];

export function buyMedia(ctx: GameContext): string | null {
  const p = ctx.state.player;
  const price = mediaPrice(ctx);
  if (price > p.cashCents) return `A media outlet costs ${formatMoney(price, true)}.`;
  const country = playerCountryState(ctx);
  const outlet: MediaOutlet = {
    id: nextId(ctx, "m"),
    name: `The ${ctx.geography.cities[p.cityId]!.name} ${ctx.rng.pick(MEDIA_NAMES)}`,
    countryId: country.id,
    partyId: null,
    priceCents: price,
  };
  transact(ctx, -price, "other", `Bought ${outlet.name}`);
  ctx.state.wealth.media.push(outlet);
  adjustReputation(ctx, "fame", 5);
  ctx.alert("good", `You now own ${outlet.name}.`, "money");
  return null;
}

export function setMediaLine(
  ctx: GameContext,
  outletId: string,
  partyId: string | null,
): string | null {
  const outlet = ctx.state.wealth.media.find((m) => m.id === outletId);
  if (!outlet) return "You don't own that outlet.";
  const country = ctx.state.world.countries[outlet.countryId];
  if (partyId && !country?.parties.some((x) => x.id === partyId)) return "Unknown party.";
  outlet.partyId = partyId;
  return null;
}

export function sellMedia(ctx: GameContext, outletId: string): string | null {
  const outlet = ctx.state.wealth.media.find((m) => m.id === outletId);
  if (!outlet) return "You don't own that outlet.";
  ctx.state.wealth.media = ctx.state.wealth.media.filter((m) => m !== outlet);
  transact(ctx, Math.round(outlet.priceCents * 0.9), "other", `Sold ${outlet.name}`);
  return null;
}

function mediaMonth(ctx: GameContext): void {
  const p = ctx.state.player;
  for (const outlet of ctx.state.wealth.media) {
    transact(ctx, Math.round(outlet.priceCents * 0.006), "other", `${outlet.name} profits`);
    adjustReputation(ctx, "fame", 0.4);
    const country = ctx.state.world.countries[outlet.countryId];
    const party = country?.parties.find((x) => x.id === outlet.partyId);
    if (!country || !party) continue;
    party.popularity += 0.003;
    if (party.id === p.politics.partyId && playerOffices(ctx).length > 0)
      p.politics.approval = Math.min(100, p.politics.approval + 0.5);
  }
}

// ---------------------------------------------------------------------------------------------
// Net worth

export interface NetWorth {
  cash: number;
  savings: number;
  offshore: number;
  investments: number;
  property: number;
  businesses: number;
  media: number;
  debts: number;
  total: number;
}

export function netWorth(ctx: GameContext): NetWorth {
  const w = ctx.state.wealth;
  const p = ctx.state.player;
  const investments = w.holdings.reduce((s, h) => s + holdingValue(ctx, h), 0);
  const property = w.properties.reduce(
    (s, x) => s + propertyValue(ctx, x) - (x.mortgage?.balanceCents ?? 0),
    0,
  );
  const businesses = activeBusinesses(ctx).reduce((s, b) => s + valuation(b) * b.playerShare, 0);
  const media = w.media.reduce((s, m) => s + m.priceCents, 0);
  const debts = totalDebtCents(p);
  const parts = {
    cash: p.cashCents,
    savings: w.savingsCents,
    offshore: w.offshoreCents,
    investments: Math.round(investments),
    property: Math.round(property),
    businesses: Math.round(businesses),
    media,
    debts,
  };
  const total =
    parts.cash +
    parts.savings +
    parts.offshore +
    parts.investments +
    parts.property +
    parts.businesses +
    parts.media -
    parts.debts;
  return { ...parts, total };
}

/** The player's place among the world's richest, or null if they're not close. */
export function richListRank(ctx: GameContext): number | null {
  const total = netWorth(ctx).total;
  const above = ctx.state.markets.richList.filter((t) => t.netWorthCents > total).length;
  return above < ctx.state.markets.richList.length ? above + 1 : null;
}

const MILESTONES = [100_000, 1_000_000, 10_000_000, 100_000_000, 1_000_000_000];

function celebrateMilestones(ctx: GameContext): void {
  const w = ctx.state.wealth;
  const dollars = netWorth(ctx).total / 100;
  for (const m of MILESTONES) {
    if (dollars < m || w.milestones.includes(m)) continue;
    w.milestones.push(m);
    adjustReputation(ctx, "fame", m >= 100_000_000 ? 10 : m >= 1_000_000 ? 4 : 1);
    ctx.alert("good", `Your net worth passed ${formatMoney(m * 100, true)}!`, "money");
  }
}

/** Markets move for everyone; the player's money works (or doesn't) every month. */
export const wealthSystem: System = {
  id: "wealth",
  onMonth(ctx) {
    ensureRichList(ctx);
    updateMarkets(ctx);
    if (!ctx.state.player.alive) return;
    investmentIncome(ctx);
    propertyMonth(ctx);
    mediaMonth(ctx);
    celebrateMilestones(ctx);
  },
};

export function countryMarketChange(ctx: GameContext, id: CountryId): number {
  return ctx.state.markets.lastChange[id] ?? 0;
}
