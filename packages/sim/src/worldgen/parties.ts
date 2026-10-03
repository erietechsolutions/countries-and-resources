import type { Rng } from "../core/rng";
import type { GovernmentType, Ideology, Party } from "../world/types";
import { hslToHex } from "./color";

const SUFFIXES = ["Party", "Union", "Alliance", "Front", "Movement", "League", "Congress"];

function core(ideology: Ideology, rng: Rng): string {
  if (ideology.economic < -0.4)
    return rng.pick(["Labour", "Socialist", "Workers'", "Social Democratic"]);
  if (ideology.economic > 0.4)
    return rng.pick(["Free Enterprise", "Liberal", "Market", "Prosperity"]);
  return rng.pick(["Centre", "Democratic", "Civic", "People's"]);
}

function prefixes(ideology: Ideology): string[] {
  const out: string[] = [];
  if (ideology.nationalism > 0.5) out.push("National", "Patriotic", "Homeland");
  if (ideology.authority > 0.5) out.push("Unity", "Order", "Vanguard");
  if (ideology.social < -0.4) out.push("Progressive", "Green", "New");
  if (ideology.social > 0.4) out.push("Conservative", "Heritage", "Traditionalist");
  if (ideology.authority < -0.5) out.push("Freedom", "Independent");
  return out;
}

function initials(name: string): string {
  return name
    .split(/[\s-]+/)
    .filter((w) => w.length > 0)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

function axis(rng: Rng, mean: number, spread: number): number {
  return Math.max(-1, Math.min(1, rng.normal(mean, spread)));
}

function partyName(ideology: Ideology, rng: Rng, taken: Set<string>): string {
  for (let attempt = 0; attempt < 20; attempt++) {
    const pre = prefixes(ideology);
    const parts = [
      pre.length > 0 && rng.chance(0.75) ? rng.pick(pre) : null,
      core(ideology, rng),
      rng.pick(SUFFIXES),
    ].filter((p): p is string => p !== null);
    const name = parts.join(" ");
    if (!taken.has(name)) return name;
  }
  let n = 2;
  const base = `${core(ideology, rng)} Party`;
  while (taken.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

interface PartyPlan {
  count: number;
  legal: boolean;
  /** Bias applied to each party's authority axis. */
  authorityBias: number;
  socialBias: number;
}

function planFor(government: GovernmentType, rng: Rng): PartyPlan {
  switch (government) {
    case "democracy":
    case "constitutionalMonarchy":
      return { count: rng.int(2, 6), legal: true, authorityBias: -0.2, socialBias: 0 };
    case "oligarchy":
      return { count: rng.int(2, 4), legal: true, authorityBias: 0.2, socialBias: 0 };
    case "oneParty":
      return { count: 1, legal: true, authorityBias: 0.8, socialBias: 0 };
    case "theocracy":
      return { count: rng.int(1, 3), legal: true, authorityBias: 0.5, socialBias: 0.8 };
    case "militaryJunta":
    case "absoluteMonarchy":
      return { count: rng.int(0, 2), legal: false, authorityBias: -0.3, socialBias: 0 };
  }
}

export interface GeneratedParties {
  parties: Party[];
  rulingPartyId: string | null;
}

/** Generates a country's political parties appropriate to its form of government. */
export function generateParties(
  countryId: string,
  government: GovernmentType,
  rng: Rng,
): GeneratedParties {
  const plan = planFor(government, rng);
  const taken = new Set<string>();
  const parties: Party[] = [];
  for (let i = 0; i < plan.count; i++) {
    const ideology: Ideology = {
      economic: axis(rng, 0, 0.6),
      social: axis(rng, plan.socialBias, 0.5),
      authority: axis(rng, plan.authorityBias, 0.4),
      nationalism: axis(rng, 0, 0.5),
    };
    const name = partyName(ideology, rng, taken);
    taken.add(name);
    parties.push({
      id: `${countryId}-p${i + 1}`,
      name,
      shortName: initials(name),
      ideology,
      popularity: rng.float(0.2, 1) ** 2,
      color: hslToHex(rng.float(0, 360), rng.float(0.45, 0.7), rng.float(0.42, 0.58)),
      legal: plan.legal,
    });
  }
  const total = parties.reduce((s, p) => s + p.popularity, 0);
  for (const p of parties) p.popularity = total > 0 ? p.popularity / total : 0;
  parties.sort((a, b) => b.popularity - a.popularity);

  // Juntas and absolute monarchies are not ruled by a party; their parties are banned opposition.
  const rulingPartyId = plan.legal ? (parties[0]?.id ?? null) : null;
  return { parties, rulingPartyId };
}
