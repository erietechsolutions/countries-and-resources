import { addDays } from "../core/calendar";
import type { GameContext } from "../core/game";
import { ensurePolitics, isDemocratic, newPolitician, playerOffices } from "../politics/government";
import { emptyPlayerPolitics } from "../politics/types";
import { adjustReputation } from "../social/social";
import { formatPercent } from "../world/format";
import type { CountryId, ProvinceId } from "../world/geography";
import { geoCountry, nextCountryId, registerCountry } from "../world/territory";
import type { CountryState, GovernmentType, Party } from "../world/types";
import { GOVERNMENT_LABELS } from "../world/types";
import { hslToHex } from "../worldgen/color";
import { initialPops } from "../worldgen/economyInit";
import { generateParties } from "../worldgen/parties";
import { headOfStateTitle } from "../worldgen/proceduralWorld";
import { heldDays } from "./militia";
import { adjustRelation, militaryOf } from "./military";
import type { Insurgency } from "./types";
import { startWar } from "./war";

export const FOUNDABLE_GOVERNMENTS = Object.keys(GOVERNMENT_LABELS) as GovernmentType[];

/** Days a militia must hold its territory before it can declare independence. */
export const HOLD_DAYS_FOR_INDEPENDENCE = 30;

interface NationSpec {
  name: string;
  parentId: CountryId;
  founderId: string;
  government: GovernmentType;
  provinces: ProvinceId[];
}

function nameProblem(ctx: GameContext, name: string): string | null {
  const clean = name.trim();
  if (clean.length < 2 || clean.length > 40) return "Name the country (2–40 characters).";
  if (ctx.geography.countries.some((c) => c.name.toLowerCase() === clean.toLowerCase()))
    return "A country with that name already exists.";
  return null;
}

/** Creates a country from part of another, inheriting its economy and institutions. */
export function createNation(ctx: GameContext, spec: NationSpec): CountryId {
  const world = ctx.state.world;
  const rng = ctx.rng;
  const id = nextCountryId(world);
  const parent = world.countries[spec.parentId]!;
  const { parties, rulingPartyId } = generateParties(id, spec.government, rng);
  const country: CountryState = {
    id,
    government: spec.government,
    headOfStateTitle: headOfStateTitle(spec.government, rng),
    development: parent.development,
    population: 0,
    gdpPerCapita: parent.gdpPerCapita,
    unemployment: parent.unemployment,
    inflation: parent.inflation,
    stability: 50,
    taxes: { ...parent.taxes },
    minimumWageCents: parent.minimumWageCents,
    medianWageCents: parent.medianWageCents,
    costOfLivingIndex: parent.costOfLivingIndex,
    parties,
    rulingPartyId,
    color: hslToHex(rng.float(0, 360), rng.float(0.45, 0.65), rng.float(0.42, 0.55)),
    economy: JSON.parse(JSON.stringify(parent.economy)) as CountryState["economy"],
    pops: [],
    healthcare: parent.healthcare,
    socialServices: parent.socialServices,
    ruleOfLaw: parent.ruleOfLaw,
    businessRegulation: parent.businessRegulation,
    budget: { debtCents: 0, revenueCents: 0, spendingCents: 0 },
  };
  country.pops = initialPops(country);
  world.countries[id] = country;
  registerCountry(ctx, id, { ...spec, name: spec.name.trim(), color: country.color });
  adjustRelation(ctx, id, spec.parentId, -50);
  return id;
}

/** The old country either lets the region go, or fights to keep it. */
function parentResponds(
  ctx: GameContext,
  parentId: CountryId,
  id: CountryId,
  acceptChance: number,
) {
  const name = geoCountry(ctx.geography, id)!.name;
  const parent = geoCountry(ctx.geography, parentId)!.name;
  if (ctx.rng.chance(acceptChance)) {
    ctx.alert("good", `${parent} has recognized ${name}'s independence.`, "politics");
    return;
  }
  startWar(ctx, parentId, id, "independence", [...geoCountry(ctx.geography, id)!.provinceIds]);
}

// ---------------------------------------------------------------------------------------------
// The player's new country

function playerParty(ctx: GameContext, countryId: CountryId, name: string): Party {
  const country = ctx.state.world.countries[countryId]!;
  const old = ctx.state.player.politics.partyId;
  const oldParty = Object.values(ctx.state.world.countries)
    .flatMap((c) => c.parties)
    .find((p) => p.id === old);
  const party: Party = {
    id: `${countryId}-p0`,
    name: oldParty?.name ?? `Movement for ${name}`,
    shortName: oldParty?.shortName ?? "MOV",
    ideology: oldParty
      ? { ...oldParty.ideology }
      : { economic: 0, social: 0, authority: 0, nationalism: 0.6 },
    popularity: 0.5,
    color: oldParty?.color ?? country.color,
    legal: true,
  };
  for (const p of country.parties) p.popularity = Math.round(p.popularity * 0.5 * 10000) / 10000;
  country.parties.unshift(party);
  if (country.government !== "militaryJunta" && country.government !== "absoluteMonarchy")
    country.rulingPartyId = party.id;
  return party;
}

/** The founder takes power: citizenship, their own party, and the top office. */
function makePlayerRuler(ctx: GameContext, id: CountryId, name: string): void {
  const p = ctx.state.player;
  // Old offices are left behind.
  for (const office of playerOffices(ctx)) {
    const i = office.holders.indexOf("player");
    office.holders[i] = newPolitician(ctx, p.cityId, null);
    office.holderParties[i] = null;
  }
  if (!p.citizenship.includes(id)) p.citizenship.push(id);
  p.residency = { countryId: id, status: "citizen", since: ctx.state.time, expiresAt: null };
  const party = playerParty(ctx, id, name);
  p.politics = {
    ...emptyPlayerPolitics(),
    partyId: party.id,
    rank: 5,
    standing: 200,
    joinedAt: ctx.state.time,
    approval: 65,
    electionsWon: p.politics.electionsWon,
  };
  ensurePolitics(ctx);
  const head = ctx.state.politics.offices.find(
    (o) => o.kind === "headOfGovernment" && o.countryId === id,
  );
  if (head) {
    head.holders = ["player"];
    head.holderParties = [party.id];
  }
  adjustReputation(ctx, "fame", 25);
  adjustReputation(ctx, "activists", 10);
  adjustReputation(ctx, "establishment", -10);
}

export interface Requirement {
  label: string;
  met: boolean;
}

/** What still stands between the player's militia and a country of its own. */
export function militiaIndependenceRequirements(ctx: GameContext): Requirement[] {
  const m = ctx.state.conflict.militia;
  if (!m) return [{ label: "Lead a militia", met: false }];
  const parent = geoCountry(ctx.geography, m.countryId);
  const needed = Math.min(3, Math.max(1, (parent?.provinceIds.length ?? 1) - 1));
  const held = new Set(m.held.map((h) => h.provinceId));
  const home = ctx.geography.cities[ctx.state.player.cityId]!;
  return [
    {
      label: `Hold ${needed} region${needed > 1 ? "s" : ""} (${m.held.length} now)`,
      met: m.held.length >= needed,
    },
    {
      label: `Hold them for ${HOLD_DAYS_FOR_INDEPENDENCE} days`,
      met: m.held.length > 0 && heldDays(ctx, m) >= HOLD_DAYS_FOR_INDEPENDENCE,
    },
    { label: "Live inside the territory you hold", met: held.has(home.provinceId) },
    { label: `40+ fighters (${m.fighters} now)`, met: m.fighters >= 40 },
    { label: `Morale 40+ (${Math.round(m.morale)} now)`, met: m.morale >= 40 },
  ];
}

/** Declares a new country: from a militia's territory, or a region whose referendum was ignored. */
export function declareIndependence(
  ctx: GameContext,
  name: string,
  government: GovernmentType,
): string | null {
  if (!FOUNDABLE_GOVERNMENTS.includes(government)) return "Choose a form of government.";
  const problem = nameProblem(ctx, name);
  if (problem) return problem;
  const conflict = ctx.state.conflict;
  const ref = conflict.referendum;
  if (ref?.rejected && (ref.expiresAt ?? 0) > ctx.state.time) {
    if (ctx.geography.provinces[ref.provinceId]!.countryId !== ref.countryId)
      return "That region is no longer part of the same country.";
    conflict.referendum = null;
    const parent = ctx.state.world.countries[ref.countryId]!;
    const id = createNation(ctx, {
      name,
      parentId: ref.countryId,
      founderId: "player",
      government,
      provinces: [ref.provinceId],
    });
    makePlayerRuler(ctx, id, name);
    // The region's share of the army defects to the new state.
    const share =
      ctx.state.world.countries[id]!.population /
      Math.max(1, parent.population + ctx.state.world.countries[id]!.population);
    const army = militaryOf(ctx.state.world.countries[id]!);
    army.troops = Math.round(militaryOf(parent).troops * share * 0.5) + army.troops;
    ctx.alert("good", `You declared the independence of ${name.trim()}!`, "politics");
    parentResponds(ctx, ref.countryId, id, 0.05);
    return null;
  }
  const m = conflict.militia;
  if (!m) return "You need a militia holding territory, or a referendum result to act on.";
  const missing = militiaIndependenceRequirements(ctx).find((r) => !r.met);
  if (missing) return `Not yet: ${missing.label.toLowerCase()}.`;
  const parentId = m.countryId;
  const parent = ctx.state.world.countries[parentId]!;
  const id = createNation(ctx, {
    name,
    parentId,
    founderId: "player",
    government,
    provinces: m.held.map((h) => h.provinceId),
  });
  makePlayerRuler(ctx, id, name);
  // The militia becomes the new national army.
  const army = militaryOf(ctx.state.world.countries[id]!);
  army.troops = Math.max(army.troops, m.fighters * 3);
  army.quality = Math.round(((m.equipment + m.training) / 200) * 100) / 100;
  conflict.militia = null;
  ctx.alert(
    "good",
    `You declared the independence of ${name.trim()}! ${m.name} is now its army.`,
    "politics",
  );
  const weak = militaryOf(parent).exhaustion / 200 + (parent.stability < 30 ? 0.2 : 0);
  parentResponds(ctx, parentId, id, 0.05 + weak);
  return null;
}

// ---------------------------------------------------------------------------------------------
// Independence referendums

export function referendumBlocker(ctx: GameContext): string | null {
  const p = ctx.state.player;
  const office = playerOffices(ctx).find((o) => o.kind === "governor");
  if (!office || office.provinceId === undefined)
    return "Only a regional governor can call an independence referendum.";
  if (ctx.state.conflict.referendum) return "A referendum is already under way.";
  if ((p.cooldowns.referendum ?? 0) > ctx.state.time)
    return "Voters said no recently. You can't ask again so soon.";
  if (p.politics.approval < 55) return "You need approval of 55+ to win a vote like this.";
  const parent = geoCountry(ctx.geography, office.countryId);
  if ((parent?.provinceIds.length ?? 0) < 2) return "This region is the whole country.";
  return null;
}

export function callReferendum(
  ctx: GameContext,
  name: string,
  government: GovernmentType,
): string | null {
  const blocker = referendumBlocker(ctx);
  if (blocker) return blocker;
  if (!FOUNDABLE_GOVERNMENTS.includes(government)) return "Choose a form of government.";
  const problem = nameProblem(ctx, name);
  if (problem) return problem;
  const office = playerOffices(ctx).find((o) => o.kind === "governor")!;
  ctx.state.conflict.referendum = {
    provinceId: office.provinceId!,
    countryId: office.countryId,
    name: name.trim(),
    government,
    voteAt: addDays(ctx.state.time, 30),
  };
  adjustReputation(ctx, "establishment", -10);
  adjustReputation(ctx, "activists", 5);
  ctx.alert(
    "info",
    `You called a referendum on independence for ${ctx.geography.provinces[office.provinceId!]!.name}. The vote is in 30 days.`,
    "politics",
  );
  return null;
}

/** Share of the region likely to vote yes. */
export function referendumSupport(
  ctx: GameContext,
  provinceId: ProvinceId,
  countryId: CountryId,
): number {
  const p = ctx.state.player;
  const stability = ctx.state.world.provinces[provinceId]?.stability ?? 50;
  const parent = ctx.state.world.countries[countryId]!;
  return Math.max(
    0.05,
    Math.min(
      0.95,
      0.3 +
        p.politics.approval / 400 +
        (50 - stability) / 150 +
        Math.max(0, p.reputation.activists) / 400 +
        p.reputation.fame / 500 +
        (isDemocratic(parent.government) ? 0 : 0.08),
    ),
  );
}

function resolveReferendum(ctx: GameContext): void {
  const conflict = ctx.state.conflict;
  const ref = conflict.referendum;
  if (!ref) return;
  if (ref.rejected) {
    if (ctx.state.time >= (ref.expiresAt ?? 0)) {
      conflict.referendum = null;
      ctx.log("politics", "The moment to act on the independence vote has passed.");
    }
    return;
  }
  if (ctx.state.time < ref.voteAt) return;
  const region = ctx.geography.provinces[ref.provinceId]!;
  if (region.countryId !== ref.countryId) {
    conflict.referendum = null;
    return;
  }
  const yes = Math.max(
    0.02,
    Math.min(0.98, referendumSupport(ctx, ref.provinceId, ref.countryId) + ctx.rng.normal(0, 0.06)),
  );
  ref.yesShare = yes;
  if (yes < 0.5) {
    conflict.referendum = null;
    ctx.state.player.cooldowns.referendum = addDays(ctx.state.time, 2 * 365);
    ctx.state.player.politics.approval = Math.max(0, ctx.state.player.politics.approval - 10);
    ctx.alert(
      "bad",
      `Independence was rejected: only ${formatPercent(yes, 0)} voted yes.`,
      "politics",
    );
    return;
  }
  const parent = ctx.state.world.countries[ref.countryId]!;
  const accept = isDemocratic(parent.government) ? 0.3 + (yes - 0.5) * 1.5 : 0.05;
  if (ctx.rng.chance(accept)) {
    conflict.referendum = null;
    const id = createNation(ctx, {
      name: ref.name,
      parentId: ref.countryId,
      founderId: "player",
      government: ref.government,
      provinces: [ref.provinceId],
    });
    adjustRelation(ctx, id, ref.countryId, 35);
    makePlayerRuler(ctx, id, ref.name);
    ctx.alert(
      "good",
      `${formatPercent(yes, 0)} voted yes, and ${geoCountry(ctx.geography, ref.countryId)!.name} accepted the result. ${ref.name} is independent, and you lead it!`,
      "politics",
    );
    return;
  }
  ref.rejected = true;
  ref.expiresAt = addDays(ctx.state.time, 90);
  ctx.alert(
    "bad",
    `${formatPercent(yes, 0)} voted yes, but ${geoCountry(ctx.geography, ref.countryId)!.name} refuses to recognize the result. You can declare independence anyway within 90 days, and face the consequences.`,
    "politics",
  );
}

// ---------------------------------------------------------------------------------------------
// Rebels that win

const REBEL_STATE_NAMES = [
  (r: string) => `Free ${r}`,
  (r: string) => `Republic of ${r}`,
  (r: string) => `People's Republic of ${r}`,
  (r: string) => `${r} State`,
];

export function foundInsurgentCountry(ctx: GameContext, ins: Insurgency): void {
  const region = ctx.geography.provinces[ins.held[0]!]!.name;
  let name = ctx.rng.pick(REBEL_STATE_NAMES)(region);
  if (nameProblem(ctx, name)) name = `${name} ${ins.id.toUpperCase()}`;
  const id = createNation(ctx, {
    name,
    parentId: ins.countryId,
    founderId: ins.id,
    government: ctx.rng.pick<GovernmentType>(["militaryJunta", "oneParty", "theocracy"]),
    provinces: [...ins.held],
  });
  const army = militaryOf(ctx.state.world.countries[id]!);
  army.troops = Math.max(army.troops, ins.fighters * 2);
  army.quality = ins.quality;
  const text = `The ${ins.name} has declared the independent state of ${name}.`;
  const here = ctx.geography.cities[ctx.state.player.cityId]!.countryId;
  if (here === ins.countryId || here === id) ctx.alert("info", text, "politics");
  else ctx.log("politics", text);
  parentResponds(ctx, ins.countryId, id, 0.35);
}

export function nationDaily(ctx: GameContext): void {
  resolveReferendum(ctx);
}
