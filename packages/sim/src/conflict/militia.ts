import type { GameContext } from "../core/game";
import { arrest, CRIME_SEVERITY } from "../crime/crime";
import { cityCosts } from "../economy/costs";
import { transact } from "../finance/finance";
import { injurePlayer, killPlayer } from "../life/aging";
import { adjustReputation } from "../social/social";
import { formatMoney } from "../world/format";
import type { CountryId, ProvinceId } from "../world/geography";
import { countryName } from "../world/territory";
import { armyPower, garrisonPower, warsOf, winChance } from "./military";
import { foundInsurgentCountry } from "./nation";
import type { Insurgency, Militia, MilitiaOrders } from "./types";

const HOUR = 1;

function wage(ctx: GameContext): number {
  return cityCosts(ctx, ctx.state.player.cityId).medianWageCents;
}

export function playerMilitia(ctx: GameContext): Militia | null {
  return ctx.state.conflict.militia;
}

function locked(ctx: GameContext): string | null {
  const p = ctx.state.player;
  if (p.legal.prisonUntil !== null || p.activity?.id === "custody")
    return "You can't do that from a cell.";
  return null;
}

// ---------------------------------------------------------------------------------------------
// Founding and running a militia

export function militiaFoundingCost(ctx: GameContext): number {
  return wage(ctx) * 150;
}

/** Why the player can't raise a militia right now, or null. */
export function militiaBlocker(ctx: GameContext): string | null {
  const p = ctx.state.player;
  if (ctx.state.conflict.militia) return "You already lead a militia.";
  const lock = locked(ctx);
  if (lock) return lock;
  const rep = p.reputation;
  if (rep.underworld < 30 && rep.activists < 30 && p.legal.gangRank < 2)
    return "Nobody will take up arms behind you yet (underworld or activist reputation 30+, or gang rank Soldier).";
  const cost = militiaFoundingCost(ctx);
  if (cost > p.cashCents) return `Arming your first fighters costs ${formatMoney(cost, true)}.`;
  return null;
}

export function foundMilitia(ctx: GameContext, name: string): string | null {
  const blocker = militiaBlocker(ctx);
  if (blocker) return blocker;
  const clean = name.trim();
  if (clean.length < 2 || clean.length > 40) return "Give your militia a name (2–40 characters).";
  const p = ctx.state.player;
  const city = ctx.geography.cities[p.cityId]!;
  transact(ctx, -militiaFoundingCost(ctx), "other", `Weapons and supplies for ${clean}`);
  const militia: Militia = {
    name: clean,
    foundedAt: ctx.state.time,
    countryId: city.countryId,
    baseProvinceId: city.provinceId,
    fighters: 8 + Math.floor(Math.max(p.reputation.underworld, p.reputation.activists, 0) / 10),
    equipment: 15,
    training: 10,
    morale: 60,
    orders: "train",
    held: [],
    operation: null,
    crackdown: 5,
    recruitsLeft: 0,
  };
  ctx.state.conflict.militia = militia;
  militia.recruitsLeft = recruitCapacity(ctx, militia);
  p.legal.heat = Math.min(100, p.legal.heat + 10);
  p.legal.secrets.push({
    crime: "insurrection",
    time: ctx.state.time,
    severity: CRIME_SEVERITY.insurrection,
  });
  adjustReputation(ctx, "establishment", -8);
  ctx.alert(
    "info",
    `${clean} is born: ${militia.fighters} fighters answer to you. The authorities will come looking.`,
    "politics",
  );
  return null;
}

/** New fighters available each month: unrest, your name and the land you hold all help. */
export function recruitCapacity(ctx: GameContext, m: Militia): number {
  const p = ctx.state.player;
  const stability = ctx.state.world.provinces[m.baseProvinceId]?.stability ?? 50;
  const name = Math.max(0, p.reputation.activists, p.reputation.underworld);
  return Math.round(5 + (100 - stability) / 5 + name / 8 + m.held.length * 15);
}

export function recruitCost(ctx: GameContext): number {
  return wage(ctx) * 8;
}

/** Monthly pay per fighter. */
export function fighterUpkeep(ctx: GameContext): number {
  return wage(ctx) * 30;
}

export function recruit(ctx: GameContext, count: number): string | null {
  const m = ctx.state.conflict.militia;
  if (!m) return "You don't lead a militia.";
  if (!Number.isInteger(count) || count <= 0) return "Choose how many fighters to recruit.";
  if (count > m.recruitsLeft) return `Only ${m.recruitsLeft} more recruits will join this month.`;
  const cost = recruitCost(ctx) * count;
  if (cost > ctx.state.player.cashCents)
    return `Recruiting ${count} costs ${formatMoney(cost, true)}.`;
  transact(ctx, -cost, "other", `Recruiting ${count} fighters`);
  // Raw recruits dilute training.
  m.training = Math.round((m.training * m.fighters + 5 * count) / (m.fighters + count));
  m.fighters += count;
  m.recruitsLeft -= count;
  m.crackdown = Math.min(100, m.crackdown + count / 10);
  ctx.log("politics", `${count} new fighters joined ${m.name}.`);
  return null;
}

/** Equipment gained for a sum: arming a large force costs more. */
export function equipmentGain(ctx: GameContext, m: Militia, amountCents: number): number {
  const full = Math.max(1, m.fighters * wage(ctx) * 25);
  return Math.round((100 - m.equipment) * Math.min(0.6, amountCents / full) * 10) / 10;
}

export function arm(ctx: GameContext, amountCents: number): string | null {
  const m = ctx.state.conflict.militia;
  if (!m) return "You don't lead a militia.";
  if (!Number.isInteger(amountCents) || amountCents <= 0) return "Enter an amount.";
  if (amountCents > ctx.state.player.cashCents) return "You don't have that much.";
  if (m.equipment >= 99) return "Your fighters are as well armed as they can be.";
  const gain = equipmentGain(ctx, m, amountCents);
  transact(ctx, -amountCents, "other", `Weapons for ${m.name}`);
  m.equipment = Math.min(100, m.equipment + gain);
  ctx.log("politics", `Bought weapons: equipment is now ${Math.round(m.equipment)}.`);
  return null;
}

export function setOrders(ctx: GameContext, orders: MilitiaOrders): string | null {
  const m = ctx.state.conflict.militia;
  if (!m) return "You don't lead a militia.";
  m.orders = orders;
  return null;
}

export function disbandMilitia(ctx: GameContext): string | null {
  const m = ctx.state.conflict.militia;
  if (!m) return "You don't lead a militia.";
  ctx.state.conflict.militia = null;
  ctx.alert(
    "info",
    `You disbanded ${m.name}. The fighters melt back into ordinary life.`,
    "politics",
  );
  return null;
}

/** Fighting strength of the militia. */
export function militiaPower(m: Militia, lead = false): number {
  return (
    m.fighters *
    (0.5 + m.equipment / 100) *
    (0.5 + m.training / 100) *
    (0.5 + m.morale / 100) *
    (lead ? 1.25 : 1)
  );
}

/** Government forces hunting the militia in a region. */
export function counterforcePower(ctx: GameContext, m: Militia, provinceId: ProvinceId): number {
  const distracted = warsOf(ctx, m.countryId).length > 0 ? 0.6 : 1;
  return garrisonPower(ctx, provinceId) * (1 + m.crackdown / 60) * distracted;
}

/** Regions the militia can strike next: home turf first, then neighbors of what it holds. */
export function attackTargets(ctx: GameContext): ProvinceId[] {
  const m = ctx.state.conflict.militia;
  if (!m) return [];
  const geo = ctx.geography;
  const held = new Set(m.held.map((h) => h.provinceId));
  const candidates = new Set<ProvinceId>([m.baseProvinceId]);
  for (const id of held) for (const n of geo.provinces[id]!.neighbors) candidates.add(n);
  return [...candidates]
    .filter(
      (id) =>
        !held.has(id) &&
        geo.provinces[id]!.countryId === m.countryId &&
        (ctx.state.world.provinces[id]?.population ?? 0) > 0,
    )
    .sort((a, b) => a - b);
}

export function attackCost(ctx: GameContext): number {
  const m = ctx.state.conflict.militia;
  return m ? m.fighters * wage(ctx) * 2 : 0;
}

export function launchAttack(
  ctx: GameContext,
  provinceId: ProvinceId,
  lead: boolean,
): string | null {
  const m = ctx.state.conflict.militia;
  if (!m) return "You don't lead a militia.";
  if (m.operation) return "Your fighters are already on an operation.";
  if (!attackTargets(ctx).includes(provinceId)) return "You can't reach that region from here.";
  if (m.fighters < 5) return "You need at least 5 fighters.";
  if (lead) {
    const lock = locked(ctx);
    if (lock) return lock;
    if (ctx.state.player.activity?.id === "hospital") return "You're in the hospital.";
  }
  const cost = attackCost(ctx);
  if (cost > ctx.state.player.cashCents)
    return `Supplies for the attack cost ${formatMoney(cost, true)}.`;
  transact(ctx, -cost, "other", `Supplies for ${m.name}`);
  m.operation = { provinceId, resolveAt: ctx.state.time + 72 * HOUR, lead };
  const name = ctx.geography.provinces[provinceId]!.name;
  ctx.alert(
    "info",
    `${m.name} is moving on ${name}. The fighting will be decided in 3 days.`,
    "politics",
  );
  return null;
}

function casualties(ctx: GameContext, m: Militia, min: number, max: number): number {
  const lost = Math.min(m.fighters, Math.round(m.fighters * ctx.rng.float(min, max)));
  m.fighters -= lost;
  return lost;
}

/** Leading from the front makes the militia stronger, and puts the player in the line of fire. */
function frontLineRisk(ctx: GameContext, won: boolean): boolean {
  if (ctx.rng.chance(won ? 0.03 : 0.07)) {
    killPlayer(ctx, "was killed in battle");
    return true;
  }
  if (ctx.rng.chance(won ? 0.15 : 0.3)) {
    injurePlayer(ctx, ctx.rng.int(25, 55), "You were wounded in the fighting.");
  }
  return false;
}

function resolveOperation(ctx: GameContext, m: Militia): void {
  const op = m.operation!;
  m.operation = null;
  const province = ctx.geography.provinces[op.provinceId]!;
  if (province.countryId !== m.countryId) return;
  const lead = op.lead && ctx.state.player.alive && ctx.state.player.legal.prisonUntil === null;
  const odds = winChance(militiaPower(m, lead), counterforcePower(ctx, m, op.provinceId));
  const won = ctx.rng.chance(odds);
  if (won) {
    const lost = casualties(ctx, m, 0.04, 0.12);
    m.held.push({ provinceId: op.provinceId, since: ctx.state.time });
    m.morale = Math.min(100, m.morale + 10);
    m.crackdown = Math.min(100, m.crackdown + 20);
    adjustReputation(ctx, "fame", 4);
    adjustReputation(ctx, "establishment", -4);
    const ps = ctx.state.world.provinces[op.provinceId];
    if (ps) ps.stability = Math.max(0, ps.stability - 10);
    ctx.alert(
      "good",
      `${m.name} took control of ${province.name}! ${lost} fighters were lost.`,
      "politics",
    );
  } else {
    const lost = casualties(ctx, m, 0.2, 0.4);
    m.morale = Math.max(0, m.morale - 15);
    m.crackdown = Math.min(100, m.crackdown + 8);
    ctx.alert(
      "bad",
      `The attack on ${province.name} failed. ${lost} fighters were killed or captured.`,
      "politics",
    );
  }
  if (lead) frontLineRisk(ctx, won);
}

/** The government strikes back: at the regions the militia holds, or at its hideouts. */
function governmentStrike(ctx: GameContext, m: Militia): void {
  const p = ctx.state.player;
  const digIn = m.orders === "hold" ? 1.35 : 1;
  if (m.held.length > 0) {
    const target = m.held[ctx.rng.int(0, m.held.length - 1)]!;
    const name = ctx.geography.provinces[target.provinceId]!.name;
    const gov = counterforcePower(ctx, m, target.provinceId) * 1.2;
    if (ctx.rng.chance(winChance(gov, militiaPower(m) * digIn * 1.2))) {
      m.held = m.held.filter((h) => h !== target);
      const lost = casualties(ctx, m, 0.15, 0.3);
      m.morale = Math.max(0, m.morale - 15);
      ctx.alert(
        "bad",
        `Government forces retook ${name}. ${m.name} lost ${lost} fighters.`,
        "politics",
      );
    } else {
      const lost = casualties(ctx, m, 0.03, 0.08);
      m.morale = Math.min(100, m.morale + 6);
      m.crackdown = Math.max(0, m.crackdown - 5);
      ctx.alert("good", `${m.name} beat back an assault on ${name} (${lost} lost).`, "politics");
    }
    return;
  }
  // No territory: raids on safe houses.
  const lost = casualties(ctx, m, 0.1, 0.3);
  m.morale = Math.max(0, m.morale - 10);
  ctx.alert(
    "bad",
    `Police raided ${m.name}'s safe houses. ${lost} fighters were arrested.`,
    "politics",
  );
  if (!p.legal.pendingCase && p.legal.prisonUntil === null && ctx.rng.chance(m.crackdown / 250)) {
    arrest(ctx, "insurrection");
  }
}

function monthlyUpkeep(ctx: GameContext, m: Militia): void {
  const p = ctx.state.player;
  // Holdings that changed hands no longer count.
  m.held = m.held.filter((h) => ctx.geography.provinces[h.provinceId]!.countryId === m.countryId);

  // Taxes levied in held regions.
  let levy = 0;
  for (const h of m.held) {
    const ps = ctx.state.world.provinces[h.provinceId]!;
    levy += Math.round(((ps.population * ps.gdpPerCapita * 100) / 12) * 0.0005);
    ps.stability = Math.max(0, ps.stability - 3);
  }
  if (levy > 0) transact(ctx, levy, "other", `"Revolutionary taxes" in held regions`);
  const country = ctx.state.world.countries[m.countryId];
  if (country) country.stability = Math.max(0, country.stability - 0.5 * m.held.length);

  const pay = m.fighters * fighterUpkeep(ctx);
  if (pay <= p.cashCents) {
    transact(ctx, -pay, "other", `Pay for ${m.fighters} fighters`);
    m.morale += (60 - m.morale) * 0.1;
  } else {
    const deserted = Math.round(m.fighters * 0.2);
    m.fighters -= deserted;
    m.morale = Math.max(0, m.morale - 20);
    ctx.alert(
      "bad",
      `You couldn't pay your fighters (${formatMoney(pay, true)}). ${deserted} deserted.`,
      "politics",
    );
  }

  switch (m.orders) {
    case "train":
      m.training = Math.min(100, m.training + (100 - m.training) * 0.12);
      m.crackdown = Math.min(100, m.crackdown + 2);
      break;
    case "raid": {
      const take = Math.round(m.fighters * wage(ctx) * 20 * (0.5 + m.training / 100));
      transact(ctx, take, "other", `Raids by ${m.name}`);
      adjustReputation(ctx, "community", -3);
      adjustReputation(ctx, "underworld", 2);
      m.crackdown = Math.min(100, m.crackdown + 8);
      p.legal.heat = Math.min(100, p.legal.heat + 8);
      casualties(ctx, m, 0, 0.05);
      break;
    }
    case "hold":
      break;
    case "lieLow":
      m.crackdown = Math.max(0, m.crackdown - 12);
      m.morale = Math.max(0, m.morale - 3);
      p.legal.heat = Math.max(0, p.legal.heat - 5);
      break;
  }
  m.crackdown = Math.min(100, m.crackdown + m.held.length * 6);
  m.crackdown = Math.max(0, m.crackdown - 3);
  m.morale = Math.round(Math.max(0, Math.min(100, m.morale)));
  m.training = Math.round(m.training * 10) / 10;
  m.recruitsLeft = recruitCapacity(ctx, m);

  if (m.crackdown > 20 && ctx.rng.chance(m.crackdown / 150)) governmentStrike(ctx, m);

  if (m.fighters < 3) {
    ctx.state.conflict.militia = null;
    ctx.alert("bad", `${m.name} has been destroyed.`, "politics");
  }
}

// ---------------------------------------------------------------------------------------------
// AI insurgencies in unstable countries

const INSURGENT_NAMES = [
  (r: string) => `${r} Liberation Front`,
  (r: string) => `People's Army of ${r}`,
  (r: string) => `${r} Freedom Movement`,
  (r: string) => `Sons and Daughters of ${r}`,
  (r: string) => `${r} Revolutionary Council`,
];

const MAX_INSURGENCIES = 4;

function insurgencyPower(ins: Insurgency): number {
  return ins.fighters * (0.5 + ins.quality) * 1.2;
}

function spawnInsurgencies(ctx: GameContext): void {
  const conflict = ctx.state.conflict;
  if (conflict.insurgencies.length >= MAX_INSURGENCIES) return;
  const busy = new Set(conflict.insurgencies.map((i) => i.countryId));
  for (const geo of ctx.geography.countries) {
    const country = ctx.state.world.countries[geo.id];
    if (!country || country.population === 0 || country.stability >= 20) continue;
    if (busy.has(geo.id) || geo.provinceIds.length < 2) continue;
    if (!ctx.rng.chance(0.006)) continue;
    const provinces = geo.provinceIds
      .map((id) => ctx.state.world.provinces[id]!)
      .filter((p) => p.population > 0)
      .sort((a, b) => a.stability - b.stability);
    const home = provinces[0];
    if (!home) continue;
    const region = ctx.geography.provinces[home.id]!.name;
    const ins: Insurgency = {
      id: `i${conflict.nextId++}`,
      name: ctx.rng.pick(INSURGENT_NAMES)(region),
      countryId: geo.id,
      fighters: Math.min(3000, Math.round(60 + home.population / 20000)),
      quality: Math.round(ctx.rng.float(0.3, 0.6) * 100) / 100,
      held: [home.id],
      since: ctx.state.time,
    };
    conflict.insurgencies.push(ins);
    if (geo.id === ctx.geography.cities[ctx.state.player.cityId]!.countryId) {
      ctx.alert(
        "bad",
        `An armed uprising has begun: the ${ins.name} has seized ${region}.`,
        "politics",
      );
    } else {
      ctx.log("politics", `Uprising in ${geo.name}: the ${ins.name} has seized ${region}.`);
    }
    if (conflict.insurgencies.length >= MAX_INSURGENCIES) return;
  }
}

function runInsurgency(
  ctx: GameContext,
  ins: Insurgency,
): "crushed" | "independent" | "revolution" | null {
  const geo = ctx.geography;
  ins.held = ins.held.filter((id) => geo.provinces[id]!.countryId === ins.countryId);
  if (ins.held.length === 0) return "crushed";
  const country = ctx.state.world.countries[ins.countryId]!;
  ins.fighters += Math.min(100, ins.held.length * 15) + ctx.rng.int(0, 30);
  ins.quality = Math.min(1, ins.quality + 0.01);
  country.stability = Math.max(0, country.stability - Math.min(3, 0.3 * ins.held.length));

  // Police and the national army both take part in putting down a rebellion.
  const target = ins.held[ctx.rng.int(0, ins.held.length - 1)]!;
  const distracted = warsOf(ctx, ins.countryId).length > 0 ? 0.6 : 1;
  const gov = (garrisonPower(ctx, target) * 2 + armyPower(country) * 0.15) * distracted;
  if (ctx.rng.chance(winChance(gov, insurgencyPower(ins)) * 0.6)) {
    ins.held = ins.held.filter((id) => id !== target);
    ins.fighters = Math.round(ins.fighters * 0.7);
  } else {
    ins.fighters = Math.round(ins.fighters * 0.92);
    const options = ins.held
      .flatMap((id) => geo.provinces[id]!.neighbors)
      .filter((id) => geo.provinces[id]!.countryId === ins.countryId && !ins.held.includes(id));
    if (options.length > 0 && ctx.rng.chance(0.35)) {
      const next = ctx.rng.pick(options);
      if (ctx.rng.chance(winChance(insurgencyPower(ins), garrisonPower(ctx, next)))) {
        ins.held.push(next);
        const ps = ctx.state.world.provinces[next];
        if (ps) ps.stability = Math.max(0, ps.stability - 8);
      }
    }
  }
  if (ins.held.length === 0 || ins.fighters < 20) return "crushed";
  const total = geo.countries.find((c) => c.id === ins.countryId)!.provinceIds.length;
  if (ins.held.length >= total) return "revolution";
  const needed = Math.max(2, Math.ceil(total * 0.25));
  if (ins.held.length >= needed && ctx.state.time - ins.since >= 365 * 24) return "independent";
  return null;
}

function runInsurgencies(ctx: GameContext): void {
  const conflict = ctx.state.conflict;
  const here: CountryId = ctx.geography.cities[ctx.state.player.cityId]!.countryId;
  for (const ins of [...conflict.insurgencies]) {
    const result = runInsurgency(ctx, ins);
    if (!result) continue;
    conflict.insurgencies = conflict.insurgencies.filter((i) => i !== ins);
    if (result === "independent") {
      foundInsurgentCountry(ctx, ins);
      continue;
    }
    const message =
      result === "crushed"
        ? `The ${ins.name} uprising in ${countryName(ctx, ins.countryId)} has been crushed.`
        : `Revolution in ${countryName(ctx, ins.countryId)}: the ${ins.name} has overthrown the government. A military council now rules.`;
    if (result === "revolution") {
      const country = ctx.state.world.countries[ins.countryId]!;
      country.government = "militaryJunta";
      country.headOfStateTitle = "Chairman of the Council";
      country.rulingPartyId = null;
      country.stability = 30;
    }
    if (ins.countryId === here)
      ctx.alert(result === "crushed" ? "info" : "bad", message, "politics");
    else ctx.log("politics", message);
  }
}

export function militiaDaily(ctx: GameContext): void {
  const m = ctx.state.conflict.militia;
  if (m?.operation && ctx.state.time >= m.operation.resolveAt) resolveOperation(ctx, m);
}

export function militiaMonthly(ctx: GameContext): void {
  const m = ctx.state.conflict.militia;
  if (m) monthlyUpkeep(ctx, m);
  runInsurgencies(ctx);
  spawnInsurgencies(ctx);
}

/** How long the militia has held its oldest region, in days. */
export function heldDays(ctx: GameContext, m: Militia): number {
  const oldest = m.held.reduce((t, h) => Math.min(t, h.since), ctx.state.time);
  return Math.floor((ctx.state.time - oldest) / 24);
}
