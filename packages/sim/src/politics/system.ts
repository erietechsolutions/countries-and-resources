import { addDays } from "../core/calendar";
import type { GameContext } from "../core/game";
import type { System } from "../core/systems";
import { transact } from "../finance/finance";
import { adjustReputation } from "../social/social";
import { npcProposals, resolveBills } from "./bills";
import { runElections, scheduleElections } from "./elections";
import { ensurePolitics, isDemocratic, playerOffices, runBudget } from "./government";
import { playerCountry, promoteInParty } from "./party";

/** Party popularity shifts with how people feel about the country, plus a little noise. */
function driftPopularity(ctx: GameContext): void {
  const pol = ctx.state.player.politics;
  for (const country of Object.values(ctx.state.world.countries)) {
    if (country.parties.length === 0 || country.population === 0) continue;
    const mood = country.pops.reduce((s, p) => s + p.satisfaction * p.share, 0);
    for (const party of country.parties) {
      let change = ctx.rng.normal(0, 0.004);
      if (party.id === country.rulingPartyId) change += ((mood - 50) / 50) * 0.01;
      // A party led by the player grows with the player's fame and good name.
      if (party.id === pol.partyId && pol.rank >= 5) {
        const rep = ctx.state.player.reputation;
        change += 0.002 * (rep.fame / 20 + Math.max(0, rep.community + rep.workers) / 80);
      }
      party.popularity = Math.max(0.002, party.popularity * (1 + change * 4) + change * 0.2);
    }
    const total = country.parties.reduce((s, p) => s + p.popularity, 0);
    for (const party of country.parties)
      party.popularity = Math.round((party.popularity / total) * 10000) / 10000;
  }
}

/** Countries without detailed offices still hold national elections now and then. */
function worldElections(ctx: GameContext): void {
  const setUp = new Set(ctx.state.politics.setUpCountries);
  for (const country of Object.values(ctx.state.world.countries)) {
    if (setUp.has(country.id) || !isDemocratic(country.government) || country.parties.length === 0)
      continue;
    country.nextElection ??= addDays(ctx.state.time, ctx.rng.int(30, 4 * 365));
    if (ctx.state.time < country.nextElection) continue;
    const legal = country.parties.filter((p) => p.legal);
    const winner = legal
      .map((p) => [p, p.popularity * ctx.rng.float(0.85, 1.15)] as const)
      .sort((a, b) => b[1] - a[1])[0];
    if (winner) country.rulingPartyId = winner[0].id;
    country.nextElection = addDays(ctx.state.time, 4 * 365);
  }
}

/** In non-democracies, offices are handed out to loyal party members and the well connected. */
function appointments(ctx: GameContext): void {
  const p = ctx.state.player;
  const country = playerCountry(ctx);
  if (isDemocratic(country.government) || !p.citizenship.includes(country.id)) return;
  const held = playerOffices(ctx);
  const loyal =
    country.government === "oneParty"
      ? p.politics.partyId === country.rulingPartyId
        ? p.politics.rank
        : -1
      : Math.floor(p.reputation.establishment / 15);
  const ladder: [string, number][] = [
    ["councilor", 1],
    ["mayor", 2],
    ["regionalCouncilor", 3],
    ["governor", 4],
  ];
  for (const [kind, needed] of ladder) {
    if (loyal < needed || held.some((o) => o.kind === kind)) continue;
    if (!ctx.rng.chance(0.15)) return;
    const office = ctx.state.politics.offices.find(
      (o) =>
        o.kind === kind &&
        o.countryId === country.id &&
        (o.cityId === p.cityId || o.provinceId === ctx.geography.cities[p.cityId]!.provinceId),
    );
    if (!office) return;
    office.holders[office.holders.length - 1] = "player";
    office.holderParties[office.holders.length - 1] = p.politics.partyId;
    adjustReputation(ctx, "establishment", 3);
    ctx.alert("good", `You've been appointed to ${office.title}.`, "politics");
    return;
  }
}

export const politicsSystem: System = {
  id: "politics",
  onDay(ctx) {
    ensurePolitics(ctx);
    scheduleElections(ctx);
    runElections(ctx);
    resolveBills(ctx);
  },
  onMonth(ctx) {
    const p = ctx.state.player;
    const offices = playerOffices(ctx);
    for (const o of offices) transact(ctx, o.salaryCents, "wages", `Salary: ${o.title}`);
    p.politics.proposalsLeft =
      offices.length > 0
        ? Math.min(3, offices.length + (offices.some((o) => o.seats === 1) ? 1 : 0))
        : 0;
    if (offices.length > 0) {
      const rep = p.reputation;
      const economy = playerCountry(ctx).economy.phase;
      const target =
        50 +
        (rep.community + rep.workers + rep.business) / 6 +
        (economy === "expansion" ? 5 : economy === "recession" ? -8 : 0) -
        Math.max(0, rep.underworld) / 4;
      p.politics.approval = Math.round(
        Math.max(0, Math.min(100, p.politics.approval + (target - p.politics.approval) * 0.3)),
      );
      adjustReputation(ctx, "fame", 0.3 * offices.length);
    }
    promoteInParty(ctx);
    appointments(ctx);
    npcProposals(ctx);
    driftPopularity(ctx);
    worldElections(ctx);
    for (const country of Object.values(ctx.state.world.countries)) runBudget(country);
  },
};
