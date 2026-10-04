import type { GameContext } from "../core/game";
import { cityCosts } from "../economy/costs";
import { transact } from "../finance/finance";
import { adjustReputation } from "../social/social";
import { formatMoney } from "../world/format";
import type { CountryState, Ideology, Party } from "../world/types";
import { hslToHex } from "../worldgen/color";
import { isDemocratic } from "./government";
import { RANK_TITLES } from "./types";

export const IDEOLOGY_PRESETS: { id: string; label: string; ideology: Ideology }[] = [
  {
    id: "socialist",
    label: "Socialist",
    ideology: { economic: -0.9, social: -0.3, authority: 0.2, nationalism: -0.2 },
  },
  {
    id: "socialDemocrat",
    label: "Social democratic",
    ideology: { economic: -0.55, social: -0.4, authority: -0.2, nationalism: -0.3 },
  },
  {
    id: "green",
    label: "Green",
    ideology: { economic: -0.4, social: -0.7, authority: -0.3, nationalism: -0.6 },
  },
  {
    id: "centrist",
    label: "Centrist",
    ideology: { economic: 0, social: 0, authority: 0, nationalism: 0 },
  },
  {
    id: "liberal",
    label: "Liberal",
    ideology: { economic: 0.5, social: -0.4, authority: -0.5, nationalism: -0.3 },
  },
  {
    id: "libertarian",
    label: "Libertarian",
    ideology: { economic: 0.85, social: -0.2, authority: -0.85, nationalism: -0.1 },
  },
  {
    id: "conservative",
    label: "Conservative",
    ideology: { economic: 0.5, social: 0.6, authority: 0.3, nationalism: 0.4 },
  },
  {
    id: "nationalist",
    label: "Nationalist",
    ideology: { economic: 0.2, social: 0.6, authority: 0.6, nationalism: 0.9 },
  },
];

/** Standing needed to reach each rank. */
export const RANK_STANDING = [0, 20, 50, 90, 140, 200];

export function playerCountry(ctx: GameContext): CountryState {
  return ctx.state.world.countries[ctx.geography.cities[ctx.state.player.cityId]!.countryId]!;
}

export function playerParty(ctx: GameContext): Party | undefined {
  const id = ctx.state.player.politics.partyId;
  return id ? playerCountry(ctx).parties.find((p) => p.id === id) : undefined;
}

function isCitizenHere(ctx: GameContext): boolean {
  return ctx.state.player.citizenship.includes(playerCountry(ctx).id);
}

export function joinParty(ctx: GameContext, partyId: string): string | null {
  const p = ctx.state.player;
  const country = playerCountry(ctx);
  if (!isCitizenHere(ctx)) return "Only citizens can join a party here.";
  const party = country.parties.find((x) => x.id === partyId);
  if (!party) return "That party doesn't exist here.";
  if (p.politics.partyId === partyId) return "You're already a member.";
  const fee = cityCosts(ctx, p.cityId).medianWageCents * 5;
  if (fee > p.cashCents) return `Membership costs ${formatMoney(fee, true)}.`;
  transact(ctx, -fee, "other", `${party.name} membership`);
  if (p.politics.candidacy) return "Finish or withdraw from your campaign first.";
  p.politics = { ...p.politics, partyId, rank: 0, standing: 0, joinedAt: ctx.state.time };
  if (!party.legal) adjustReputation(ctx, "establishment", -5);
  ctx.alert(
    "good",
    `You joined the ${party.name}${party.legal ? "" : " (it's banned: keep your head down)"}.`,
    "politics",
  );
  return null;
}

export function leaveParty(ctx: GameContext): string | null {
  const p = ctx.state.player;
  const party = playerParty(ctx);
  if (!party) return "You're not in a party.";
  if (p.politics.candidacy) return "Withdraw from your campaign first.";
  p.politics = { ...p.politics, partyId: null, rank: 0, standing: 0 };
  ctx.log("politics", `You left the ${party.name}.`);
  return null;
}

export function foundingPartyCost(ctx: GameContext): number {
  return cityCosts(ctx, ctx.state.player.cityId).medianWageCents * 120;
}

export function foundParty(ctx: GameContext, name: string, presetId: string): string | null {
  const p = ctx.state.player;
  const country = playerCountry(ctx);
  const clean = name.trim().replace(/\s+/g, " ");
  if (!isCitizenHere(ctx)) return "Only citizens can found a party here.";
  if (clean.length < 3 || clean.length > 40) return "Choose a party name (3–40 characters).";
  if (country.parties.some((x) => x.name.toLowerCase() === clean.toLowerCase()))
    return "A party with that name already exists.";
  const preset = IDEOLOGY_PRESETS.find((x) => x.id === presetId);
  if (!preset) return "Choose an ideology.";
  const cost = foundingPartyCost(ctx);
  if (cost > p.cashCents) return `Founding a party costs ${formatMoney(cost, true)}.`;
  if (p.politics.candidacy) return "Withdraw from your campaign first.";
  transact(ctx, -cost, "other", `Founded ${clean}`);
  const legal = isDemocratic(country.government);
  const party: Party = {
    id: `${country.id}-u${ctx.state.politics.nextId++}`,
    name: clean,
    shortName: clean
      .split(/\s+/)
      .map((w) => w[0]!.toUpperCase())
      .join(""),
    ideology: { ...preset.ideology },
    popularity: 0.005,
    color: hslToHex(ctx.rng.float(0, 360), 0.6, 0.55),
    legal,
  };
  for (const other of country.parties) other.popularity *= 0.995;
  country.parties.push(party);
  p.politics = {
    ...p.politics,
    partyId: party.id,
    rank: 5,
    standing: RANK_STANDING[5]!,
    joinedAt: ctx.state.time,
  };
  adjustReputation(ctx, "fame", 3);
  if (!legal) adjustReputation(ctx, "establishment", -10);
  ctx.alert(
    "good",
    `You founded the ${clean}${legal ? "" : ". Parties are banned here, so it operates underground"}. You are its leader.`,
    "politics",
  );
  return null;
}

/** Monthly: members who put in the work move up the ranks. */
export function promoteInParty(ctx: GameContext): void {
  const pol = ctx.state.player.politics;
  const party = playerParty(ctx);
  if (!party || pol.rank >= 5) return;
  const next = pol.rank + 1;
  const months = (ctx.state.time - pol.joinedAt) / (30 * 24);
  if (pol.standing < RANK_STANDING[next]! || months < next * 2) return;
  // Becoming party leader means winning a leadership contest.
  if (next === 5 && !ctx.rng.chance(0.35)) {
    ctx.alert(
      "info",
      `You challenged for the leadership of the ${party.name}, but lost. You can try again next month.`,
      "politics",
    );
    pol.standing -= 15;
    return;
  }
  pol.rank = next;
  adjustReputation(ctx, "fame", next);
  ctx.alert("good", `You've risen to ${RANK_TITLES[next]} in the ${party.name}.`, "politics");
}
