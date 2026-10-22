import { addDays, type DateParts } from "../core/calendar";
import type { GameContext } from "../core/game";
import { isDemocratic } from "../politics/government";
import type { CountryId, ProvinceId } from "../world/geography";
import {
  borderProvinces,
  countryName,
  geoCountry,
  landNeighbors,
  transferProvince,
} from "../world/territory";
import {
  activeWars,
  adjustRelation,
  allied,
  alliesOf,
  armyPower,
  baseRelation,
  militaryOf,
  peacetimeTroops,
  playerRuledCountry,
  relation,
  sideOf,
  warBetween,
  warsOf,
  winChance,
} from "./military";
import { pairKey, type War, type WarKind } from "./types";

const MAX_AI_WARS = 3;

/** The country the player lives in. */
function homeCountry(ctx: GameContext): CountryId {
  return ctx.geography.cities[ctx.state.player.cityId]!.countryId;
}

/** Whether news about these countries concerns the player directly. */
function concernsPlayer(ctx: GameContext, ids: CountryId[]): boolean {
  const home = homeCountry(ctx);
  const ruled = playerRuledCountry(ctx);
  return ids.some((id) => id === home || id === ruled);
}

function report(ctx: GameContext, ids: CountryId[], level: "good" | "bad" | "info", text: string) {
  if (concernsPlayer(ctx, ids)) ctx.alert(level, text, "politics");
  else ctx.log("politics", text);
}

function alive(ctx: GameContext, id: CountryId): boolean {
  return (geoCountry(ctx.geography, id)?.provinceIds.length ?? 0) > 0;
}

export function startWar(
  ctx: GameContext,
  attacker: CountryId,
  defender: CountryId,
  kind: WarKind,
  claims: ProvinceId[],
): War {
  const conflict = ctx.state.conflict;
  const a = countryName(ctx, attacker);
  const d = countryName(ctx, defender);
  const war: War = {
    id: `w${conflict.nextId++}`,
    name: kind === "independence" ? `${d} War of Independence` : `${a}–${d} War`,
    kind,
    attackers: [attacker],
    defenders: [defender],
    claims: [...claims],
    startedAt: ctx.state.time,
    occupied: {},
    score: 0,
    status: "active",
    battles: [],
  };
  conflict.wars.push(war);
  adjustRelation(ctx, attacker, defender, -60);
  for (const id of [attacker, defender]) {
    const m = militaryOf(ctx.state.world.countries[id]!);
    m.mobilization = Math.max(m.mobilization, 0.3);
  }
  // Allies honor their alliances (defensive pacts are honored more often).
  for (const ally of alliesOf(ctx, defender)) {
    if (ally !== attacker && !warBetween(ctx, ally, defender) && ctx.rng.chance(0.8))
      war.defenders.push(ally);
  }
  for (const ally of alliesOf(ctx, attacker)) {
    if (war.defenders.includes(ally) || allied(ctx, ally, defender)) continue;
    if (relation(ctx, ally, defender) < 20 && ctx.rng.chance(0.5)) war.attackers.push(ally);
  }
  report(
    ctx,
    [...war.attackers, ...war.defenders],
    "bad",
    kind === "independence"
      ? `${a} has sent troops to crush ${d}'s independence. War has begun.`
      : `${a} has declared war on ${d}!`,
  );
  return war;
}

/** Which side holds a province in this war right now. */
function holder(ctx: GameContext, war: War, id: ProvinceId): "attackers" | "defenders" | null {
  const occupant = war.occupied[id];
  if (occupant) return sideOf(war, occupant);
  return sideOf(war, ctx.geography.provinces[id]!.countryId);
}

function sidePower(ctx: GameContext, ids: CountryId[]): number {
  return ids.reduce((sum, id, i) => {
    const c = ctx.state.world.countries[id];
    if (!c || !alive(ctx, id)) return sum;
    return sum + armyPower(c) * (i === 0 ? 1 : 0.5);
  }, 0);
}

/** Picks where the winning side pushes next: liberating its own land first, then taking more. */
function nextObjective(
  ctx: GameContext,
  war: War,
  side: "attackers" | "defenders",
): ProvinceId | null {
  const geo = ctx.geography;
  const ours = side === "attackers" ? war.attackers : war.defenders;
  const theirs = side === "attackers" ? war.defenders : war.attackers;
  const frontTouches = (id: ProvinceId) =>
    geo.provinces[id]!.neighbors.some((n) => holder(ctx, war, n) === side);

  const liberate = Object.keys(war.occupied)
    .map(Number)
    .filter((id) => ours.includes(geo.provinces[id]!.countryId) && frontTouches(id));
  if (liberate.length > 0) return ctx.rng.pick(liberate);

  const enemyLand = theirs
    .flatMap((id) => geoCountry(geo, id)?.provinceIds ?? [])
    .filter(
      (id) => holder(ctx, war, id) !== side && (ctx.state.world.provinces[id]?.population ?? 0) > 0,
    );
  let options = enemyLand.filter(frontTouches);
  if (options.length === 0) {
    // No land front: landings on the coast.
    const coastal = ours.some((id) =>
      (geoCountry(geo, id)?.provinceIds ?? []).some((p) => geo.provinces[p]!.coastal),
    );
    options = coastal ? enemyLand.filter((id) => geo.provinces[id]!.coastal) : [];
  }
  if (options.length === 0) return null;
  // Attackers go for what they came for.
  if (side === "attackers") {
    const claimed = options.filter((id) => war.claims.includes(id));
    if (claimed.length > 0) options = claimed;
  }
  return ctx.rng.pick(options);
}

function populationOf(ctx: GameContext, ids: ProvinceId[]): number {
  return ids.reduce((s, id) => s + (ctx.state.world.provinces[id]?.population ?? 0), 0);
}

/** -100..100: share of the enemy's people each side has under occupation. */
export function warScore(ctx: GameContext, war: War): number {
  const geo = ctx.geography;
  const land = (ids: CountryId[]) => ids.flatMap((id) => geoCountry(geo, id)?.provinceIds ?? []);
  const defLand = land(war.defenders);
  const attLand = land(war.attackers);
  const takenFromDef = defLand.filter((id) => sideOf(war, war.occupied[id] ?? "") === "attackers");
  const takenFromAtt = attLand.filter((id) => sideOf(war, war.occupied[id] ?? "") === "defenders");
  const a = populationOf(ctx, takenFromDef) / Math.max(1, populationOf(ctx, defLand));
  const d = populationOf(ctx, takenFromAtt) / Math.max(1, populationOf(ctx, attLand));
  return Math.round(Math.max(-100, Math.min(100, (a - d) * 100)));
}

function exhaust(ctx: GameContext, ids: CountryId[], amount: number): void {
  for (const id of ids) {
    const c = ctx.state.world.countries[id];
    if (!c) continue;
    const m = militaryOf(c);
    const scale = isDemocratic(c.government) ? 1.3 : 1;
    m.exhaustion = Math.min(100, m.exhaustion + amount * scale);
  }
}

function losses(ctx: GameContext, ids: CountryId[], share: number): void {
  for (const id of ids) {
    const c = ctx.state.world.countries[id];
    if (c) militaryOf(c).troops = Math.round(militaryOf(c).troops * (1 - share));
  }
}

/** One week of fighting: a battle somewhere along the front. */
function fight(ctx: GameContext, war: War): void {
  const att = sidePower(ctx, war.attackers);
  const def = sidePower(ctx, war.defenders) * 1.1;
  const winner = ctx.rng.chance(winChance(att, def)) ? "attackers" : "defenders";
  const loser = winner === "attackers" ? "defenders" : "attackers";
  const target = nextObjective(ctx, war, winner);
  losses(ctx, war[winner], 0.01);
  losses(ctx, war[loser], 0.03);
  exhaust(ctx, war[winner], 1);
  exhaust(ctx, war[loser], 2.5);
  if (target === null) return;

  const owner = ctx.geography.provinces[target]!.countryId;
  const liberated = war[winner].includes(owner);
  if (liberated) delete war.occupied[target];
  else war.occupied[target] = war[winner][0]!;
  war.battles.push({ time: ctx.state.time, provinceId: target, winner: war[winner][0]! });
  if (war.battles.length > 12) war.battles.shift();
  const ps = ctx.state.world.provinces[target];
  if (ps) ps.stability = Math.max(0, ps.stability - 6);
  war.score = warScore(ctx, war);

  const name = ctx.geography.provinces[target]!.name;
  const who = countryName(ctx, war[winner][0]!);
  const here = ctx.geography.cities[ctx.state.player.cityId]!.provinceId === target;
  if (here) {
    const p = ctx.state.player;
    p.needs.happiness = Math.max(0, p.needs.happiness - 15);
    ctx.alert(
      liberated ? "good" : "bad",
      liberated
        ? `${who}'s troops have liberated ${name}, where you live.`
        : `${who}'s troops have taken ${name}. Soldiers are on your street.`,
      "politics",
    );
  } else if (concernsPlayer(ctx, [...war.attackers, ...war.defenders])) {
    ctx.log("politics", `${war.name}: ${who} ${liberated ? "liberated" : "captured"} ${name}.`);
  }

  // A side whose leader is fully occupied capitulates.
  const leader = war[loser][0]!;
  const land = geoCountry(ctx.geography, leader)?.provinceIds ?? [];
  if (land.length > 0 && land.every((id) => holder(ctx, war, id) === winner)) {
    endWar(ctx, war, "capitulation");
  }
}

/**
 * Peace: the winners keep what they occupy of the land they fought for. A crushing win, or a
 * capitulation, keeps everything taken. The rest goes back.
 */
export function endWar(ctx: GameContext, war: War, how: "capitulation" | "negotiated"): void {
  war.score = warScore(ctx, war);
  const total = how === "capitulation";
  const transfers: [ProvinceId, CountryId][] = [];
  for (const [key, occupant] of Object.entries(war.occupied)) {
    const id = Number(key);
    const side = sideOf(war, occupant);
    // A breakaway state fights to survive, not to conquer the country it left.
    if (war.kind === "independence" && side === "defenders") continue;
    const keep =
      total ||
      (side === "attackers" && war.claims.includes(id) && war.score > 0) ||
      (side === "attackers" && war.score >= 60) ||
      (side === "defenders" && war.score <= -60);
    if (keep) transfers.push([id, occupant]);
  }
  war.status = "ended";
  war.endedAt = ctx.state.time;
  war.occupied = {};
  const a = countryName(ctx, war.attackers[0]!);
  const d = countryName(ctx, war.defenders[0]!);
  const winner = war.score > 10 ? a : war.score < -10 ? d : null;
  war.outcome =
    (total ? "Capitulation" : "Peace treaty") +
    (winner ? `: ${winner} prevailed` : ": a stalemate") +
    (transfers.length
      ? `, ${transfers.length} region${transfers.length > 1 ? "s" : ""} changed hands.`
      : ".");
  for (const [id, to] of transfers) transferProvince(ctx, id, to);
  for (const x of war.attackers) for (const y of war.defenders) adjustRelation(ctx, x, y, 20);
  for (const id of [...war.attackers, ...war.defenders]) {
    const c = ctx.state.world.countries[id];
    if (c) militaryOf(c).exhaustion = Math.max(0, militaryOf(c).exhaustion - 20);
  }
  report(ctx, [...war.attackers, ...war.defenders], "info", `${war.name} is over. ${war.outcome}`);
  for (const id of [...war.attackers, ...war.defenders]) {
    if (!alive(ctx, id)) countryDestroyed(ctx, id);
  }
}

/** A country that lost all its land: its government and wars end with it. */
export function countryDestroyed(ctx: GameContext, id: CountryId): void {
  const c = ctx.state.world.countries[id];
  if (c) c.population = 0;
  for (const war of activeWars(ctx)) {
    war.attackers = war.attackers.filter((x) => x !== id);
    war.defenders = war.defenders.filter((x) => x !== id);
    if (war.attackers.length === 0 || war.defenders.length === 0) {
      war.status = "ended";
      war.endedAt = ctx.state.time;
      war.outcome = `${countryName(ctx, id)} ceased to exist.`;
    }
  }
  const politics = ctx.state.politics;
  const offices = politics.offices.filter((o) => o.countryId === id);
  if (offices.some((o) => o.holders.includes("player"))) {
    ctx.alert("bad", `${countryName(ctx, id)} has fallen. Your government is no more.`, "politics");
  }
  const ids = new Set(offices.map((o) => o.id));
  politics.offices = politics.offices.filter((o) => !ids.has(o.id));
  politics.elections = politics.elections.filter((e) => !ids.has(e.officeId));
  ctx.state.conflict.alliances = ctx.state.conflict.alliances.filter(
    (k) => !k.split("|").includes(id),
  );
  report(ctx, [id], "bad", `${countryName(ctx, id)} has ceased to exist.`);
}

// ---------------------------------------------------------------------------------------------
// Monthly: economies at war, armies, AI peace and AI wars

function warEconomy(ctx: GameContext): void {
  const fighting = new Set(activeWars(ctx).flatMap((w) => [...w.attackers, ...w.defenders]));
  for (const country of Object.values(ctx.state.world.countries)) {
    if (country.population === 0) continue;
    const atWar = fighting.has(country.id);
    if (!atWar && !country.military) continue;
    const m = militaryOf(country);
    if (atWar) {
      m.mobilization = Math.min(1, m.mobilization + 0.15);
      country.stability = Math.max(0, country.stability - (1 + m.exhaustion / 50));
      country.inflation = Math.min(3, country.inflation + 0.003);
      for (const pop of country.pops) pop.satisfaction = Math.max(0, pop.satisfaction - 1);
      if (country.budget) {
        const monthlyGdp = (country.gdpPerCapita * 100 * country.population) / 12;
        country.budget.debtCents += Math.round(monthlyGdp * 0.03 * m.mobilization);
      }
    } else {
      m.mobilization = Math.round(m.mobilization * 0.7 * 100) / 100;
      m.exhaustion = Math.max(0, m.exhaustion - 5);
    }
    const target = peacetimeTroops(country) * (0.5 + m.spending) * (1 + m.mobilization * 2);
    m.troops = Math.max(0, Math.round(m.troops + (target - m.troops) * 0.1));
    m.quality =
      Math.round(Math.min(1, Math.max(0.1, m.quality + (m.spending - 0.5) * 0.01)) * 1000) / 1000;
  }
}

/** AI leaders make peace when the war is decided or their people have had enough. */
function aiPeace(ctx: GameContext): void {
  const ruled = playerRuledCountry(ctx);
  for (const war of activeWars(ctx)) {
    const a = ctx.state.world.countries[war.attackers[0]!];
    const d = ctx.state.world.countries[war.defenders[0]!];
    if (!a || !d) continue;
    const exA = militaryOf(a).exhaustion;
    const exD = militaryOf(d).exhaustion;
    const playerLeads = war.attackers[0] === ruled || war.defenders[0] === ruled;
    if (playerLeads) {
      // The player decides, unless their own country can't fight on.
      const own = militaryOf(war.attackers[0] === ruled ? a : d).exhaustion;
      if (own >= 100) {
        ctx.alert(
          "bad",
          "Your exhausted country can't fight on. Your generals sued for peace.",
          "politics",
        );
        endWar(ctx, war, "negotiated");
      }
      continue;
    }
    const long = ctx.state.time - war.startedAt > 3 * 365 * 24;
    if (Math.abs(war.score) >= 70 || Math.max(exA, exD) >= 80 || long)
      endWar(ctx, war, "negotiated");
  }
}

function aiDeclarations(ctx: GameContext): void {
  const ruled = playerRuledCountry(ctx);
  const aiWars = activeWars(ctx).filter(
    (w) => w.attackers[0] !== ruled && w.defenders[0] !== ruled,
  );
  if (aiWars.length >= MAX_AI_WARS) return;
  const countries = ctx.geography.countries.filter(
    (c) => c.provinceIds.length > 0 && (ctx.state.world.countries[c.id]?.population ?? 0) > 0,
  );
  for (let i = 0; i < 6 && countries.length > 0; i++) {
    const geo = ctx.rng.pick(countries);
    const c = ctx.state.world.countries[geo.id]!;
    if (geo.id === ruled || c.stability < 40 || warsOf(ctx, geo.id).length > 0) continue;
    for (const target of landNeighbors(ctx.geography, geo.id)) {
      const t = ctx.state.world.countries[target];
      if (!t || t.population === 0 || allied(ctx, geo.id, target)) continue;
      const rel = relation(ctx, geo.id, target);
      if (rel >= -40 || armyPower(c) < armyPower(t) * 1.3) continue;
      if (!ctx.rng.chance(0.03 + (-rel - 40) / 2000)) continue;
      const border = borderProvinces(ctx.geography, geo.id, target);
      const claims = ctx.rng.shuffle(border).slice(0, ctx.rng.int(1, 3));
      if (claims.length === 0) continue;
      startWar(ctx, geo.id, target, "conquest", claims);
      return;
    }
  }
}

/** Relations drift back toward their natural level. */
function driftRelations(ctx: GameContext): void {
  const relations = ctx.state.conflict.relations;
  for (const key of Object.keys(relations)) {
    const [a, b] = key.split("|") as [CountryId, CountryId];
    if (warBetween(ctx, a, b)) continue;
    const base = baseRelation(ctx, a, b);
    const next = relations[key]! + (base - relations[key]!) * 0.05;
    if (Math.abs(next - base) < 1) delete relations[key];
    else relations[key] = Math.round(next * 10) / 10;
  }
}

export function warWeekly(ctx: GameContext, date: DateParts): void {
  if (date.weekday !== 1) return;
  for (const war of activeWars(ctx)) {
    if (war.attackers.length === 0 || war.defenders.length === 0) continue;
    fight(ctx, war);
  }
}

export function warMonthly(ctx: GameContext): void {
  warEconomy(ctx);
  aiPeace(ctx);
  aiDeclarations(ctx);
  driftRelations(ctx);
  // Keep a short history of finished wars.
  const done = ctx.state.conflict.wars.filter((w) => w.status === "ended");
  if (done.length > 20) {
    const drop = new Set(done.slice(0, done.length - 20));
    ctx.state.conflict.wars = ctx.state.conflict.wars.filter((w) => !drop.has(w));
  }
}

// ---------------------------------------------------------------------------------------------
// Player diplomacy: only a head of government can speak for a country.

function ruler(ctx: GameContext): CountryId | string {
  const id = playerRuledCountry(ctx);
  return id ?? "Only a head of government can conduct diplomacy.";
}

function checkTarget(ctx: GameContext, self: CountryId, target: CountryId): string | null {
  if (target === self) return "That's your own country.";
  const c = ctx.state.world.countries[target];
  if (!c || c.population === 0 || !alive(ctx, target)) return "That country doesn't exist.";
  return null;
}

export function improveRelations(ctx: GameContext, target: CountryId): string | null {
  const self = ruler(ctx);
  if (!ctx.state.world.countries[self]) return self;
  const bad = checkTarget(ctx, self, target);
  if (bad) return bad;
  if (warBetween(ctx, self, target)) return "You're at war with them.";
  const p = ctx.state.player;
  const key = `diplomacy:${target}`;
  if ((p.cooldowns[key] ?? 0) > ctx.state.time) return "Your envoys were just there. Give it time.";
  p.cooldowns[key] = addDays(ctx.state.time, 30);
  const gain = ctx.rng.int(8, 15);
  adjustRelation(ctx, self, target, gain);
  ctx.log("politics", `State visit to ${countryName(ctx, target)}: relations improved by ${gain}.`);
  return null;
}

export function proposeAlliance(ctx: GameContext, target: CountryId): string | null {
  const self = ruler(ctx);
  if (!ctx.state.world.countries[self]) return self;
  const bad = checkTarget(ctx, self, target);
  if (bad) return bad;
  if (allied(ctx, self, target)) return "You're already allies.";
  if (warBetween(ctx, self, target)) return "You're at war with them.";
  const rel = relation(ctx, self, target);
  if (rel < 50) return "Relations must be at least 50 before they'll consider an alliance.";
  const p = ctx.state.player;
  const key = `alliance:${target}`;
  if ((p.cooldowns[key] ?? 0) > ctx.state.time) return "They turned you down recently.";
  if (!ctx.rng.chance(Math.min(0.9, (rel - 40) / 50))) {
    p.cooldowns[key] = addDays(ctx.state.time, 90);
    ctx.alert("bad", `${countryName(ctx, target)} declined an alliance.`, "politics");
    return null;
  }
  ctx.state.conflict.alliances.push(pairKey(self, target));
  ctx.alert("good", `${countryName(ctx, target)} is now your ally.`, "politics");
  return null;
}

export function breakAlliance(ctx: GameContext, target: CountryId): string | null {
  const self = ruler(ctx);
  if (!ctx.state.world.countries[self]) return self;
  if (!allied(ctx, self, target)) return "You're not allied with them.";
  ctx.state.conflict.alliances = ctx.state.conflict.alliances.filter(
    (k) => k !== pairKey(self, target),
  );
  adjustRelation(ctx, self, target, -30);
  ctx.alert("info", `You ended the alliance with ${countryName(ctx, target)}.`, "politics");
  return null;
}

/** What the player's country would fight for: border regions, or coastal ones across the sea. */
export function warClaims(ctx: GameContext, self: CountryId, target: CountryId): ProvinceId[] {
  const geo = ctx.geography;
  const border = borderProvinces(geo, self, target);
  if (border.length > 0) return border;
  const coastal = (geoCountry(geo, self)?.provinceIds ?? []).some(
    (id) => geo.provinces[id]!.coastal,
  );
  if (!coastal) return [];
  return (geoCountry(geo, target)?.provinceIds ?? [])
    .filter((id) => geo.provinces[id]!.coastal)
    .sort(
      (a, b) =>
        (ctx.state.world.provinces[b]?.population ?? 0) -
        (ctx.state.world.provinces[a]?.population ?? 0),
    )
    .slice(0, 3);
}

export function declareWar(ctx: GameContext, target: CountryId): string | null {
  const self = ruler(ctx);
  if (!ctx.state.world.countries[self]) return self;
  const bad = checkTarget(ctx, self, target);
  if (bad) return bad;
  if (allied(ctx, self, target)) return "You can't attack an ally. End the alliance first.";
  if (warBetween(ctx, self, target)) return "You're already at war with them.";
  const p = ctx.state.player;
  const country = ctx.state.world.countries[self]!;
  if (isDemocratic(country.government) && p.politics.approval < 35)
    return "The legislature won't authorize a war while your approval is this low (35+).";
  const claims = warClaims(ctx, self, target);
  if (claims.length === 0) return "Your armies have no way to reach them.";
  startWar(ctx, self, target, "conquest", claims);
  p.politics.approval = Math.max(0, p.politics.approval - 5);
  return null;
}

export function proposePeace(ctx: GameContext, warId: string): string | null {
  const self = ruler(ctx);
  if (!ctx.state.world.countries[self]) return self;
  const war = activeWars(ctx).find((w) => w.id === warId);
  if (!war) return "That war is over.";
  const side =
    war.attackers[0] === self ? "attackers" : war.defenders[0] === self ? "defenders" : null;
  if (!side) return "Only the leaders of each side can make peace.";
  const p = ctx.state.player;
  const key = `peace:${war.id}`;
  if ((p.cooldowns[key] ?? 0) > ctx.state.time) return "They rejected your terms recently.";
  const other = side === "attackers" ? war.defenders[0]! : war.attackers[0]!;
  const otherCountry = ctx.state.world.countries[other]!;
  // Positive when the player's side is ahead.
  const lead = side === "attackers" ? war.score : -war.score;
  const willing =
    lead > 15 ||
    militaryOf(otherCountry).exhaustion > 50 ||
    ctx.rng.chance(0.15 + Math.max(0, lead) / 100);
  if (!willing) {
    p.cooldowns[key] = addDays(ctx.state.time, 30);
    ctx.alert("bad", `${countryName(ctx, other)} refused to negotiate.`, "politics");
    return null;
  }
  endWar(ctx, war, "negotiated");
  return null;
}

export const SPENDING_LEVELS = [0, 0.25, 0.5, 0.75, 1];

export function setMilitarySpending(ctx: GameContext, level: number): string | null {
  const self = ruler(ctx);
  if (!ctx.state.world.countries[self]) return self;
  if (!SPENDING_LEVELS.includes(level)) return "Choose a spending level.";
  militaryOf(ctx.state.world.countries[self]!).spending = level;
  ctx.log("politics", `Defense spending set to ${Math.round(level * 200)}% of normal.`);
  return null;
}
