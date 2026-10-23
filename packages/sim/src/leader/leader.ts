import { formatDate, type GameTime } from "../core/calendar";
import type { GameContext } from "../core/game";
import type { System } from "../core/systems";
import { militaryOf, playerRuledCountry, warsOf } from "../conflict/military";
import { budgetOf, isDemocratic, isPresidential } from "../politics/government";
import { emptyPlayerPolitics } from "../politics/types";
import type { CountryId } from "../world/geography";
import { countryName, geoCountry } from "../world/territory";
import type { GovernmentType } from "../world/types";

/** A country's vital signs, recorded when the player takes power to measure their record. */
export interface CountrySnapshot {
  population: number;
  gdpPerCapita: number;
  unemployment: number;
  inflation: number;
  stability: number;
  debtCents: number;
  provinces: number;
}

/** Leader mode: the player's time in power. */
export interface Reign {
  countryId: CountryId;
  startedAt: GameTime;
  government: GovernmentType;
  /** Dynasty generation at the start, to tell a death in office from other endings. */
  generation: number;
  start: CountrySnapshot;
  endedAt: GameTime | null;
  endReason: string | null;
}

export function isLeaderMode(ctx: { state: { config: { mode: string } } }): boolean {
  return ctx.state.config.mode === "leader";
}

export function snapshot(ctx: GameContext, id: CountryId): CountrySnapshot {
  const c = ctx.state.world.countries[id]!;
  return {
    population: c.population,
    gdpPerCapita: c.gdpPerCapita,
    unemployment: c.unemployment,
    inflation: c.inflation,
    stability: c.stability,
    debtCents: budgetOf(c).debtCents,
    provinces: geoCountry(ctx.geography, id)?.provinceIds.length ?? 0,
  };
}

/** Puts the player in charge of the country they live in. Used when a Leader game begins. */
export function startReign(ctx: GameContext): void {
  const s = ctx.state;
  const p = s.player;
  const countryId = ctx.geography.cities[p.cityId]!.countryId;
  const country = s.world.countries[countryId]!;
  const head = s.politics.offices.find(
    (o) => o.kind === "headOfGovernment" && o.countryId === countryId,
  );
  if (!head) throw new Error(`No government to lead in ${countryId}`);
  head.holders = ["player"];
  head.holderParties = [country.rulingPartyId];
  p.politics = {
    ...emptyPlayerPolitics(),
    partyId: country.rulingPartyId,
    rank: country.rulingPartyId ? 5 : 0,
    standing: 200,
    joinedAt: s.time,
    approval: 60,
    proposalsLeft: LEADER_PROPOSALS,
  };
  p.reputation.fame = 35;
  p.reputation.establishment = 30;
  s.family = [];
  s.reign = {
    countryId,
    startedAt: s.time,
    government: country.government,
    generation: s.dynasty.generation,
    start: snapshot(ctx, countryId),
    endedAt: null,
    endReason: null,
  };
  ctx.log("politics", `You take office as ${head.title}.`);
}

/** Bills and decrees a leader can push each month. */
export const LEADER_PROPOSALS = 4;

/** Where public approval settles: how people feel, how stable things are, the economy and war. */
export function leaderApprovalTarget(ctx: GameContext, id: CountryId): number {
  const c = ctx.state.world.countries[id]!;
  const mood = c.pops.reduce((s, pop) => s + pop.satisfaction * pop.share, 0);
  const economy = c.economy.phase === "expansion" ? 5 : c.economy.phase === "recession" ? -8 : 0;
  const war = warsOf(ctx, id).length > 0 ? -militaryOf(c).exhaustion / 5 : 0;
  // Even a thriving country rarely gives its leader more than about 80%.
  const wellbeing = mood * 0.6 + c.stability * 0.4;
  return Math.max(0, Math.min(100, 15 + wellbeing * 0.65 + economy + war));
}

/** Works out why the player is no longer in charge. */
function lossReason(ctx: GameContext, reign: Reign): string {
  const s = ctx.state;
  const country = s.world.countries[reign.countryId];
  const name = countryName(ctx, reign.countryId);
  if (!country || country.population === 0) return `${name} was conquered.`;
  if (s.dynasty.generation !== reign.generation) return "You died in office.";
  if (country.government !== reign.government) return "You were overthrown.";
  const lost = s.politics.elections.some((e) => {
    const office = s.politics.offices.find((o) => o.id === e.officeId);
    return (
      e.status === "done" &&
      office?.kind === "headOfGovernment" &&
      office.countryId === reign.countryId &&
      e.results?.some((r) => r.id === "player" && !r.won)
    );
  });
  if (lost) return "You lost the election.";
  if (isDemocratic(country.government) && !isPresidential(country))
    return "Your party lost control of the legislature.";
  return "You lost power.";
}

export function endReign(ctx: GameContext, reason: string): void {
  const reign = ctx.state.reign;
  if (!reign || reign.endedAt !== null) return;
  reign.endedAt = ctx.state.time;
  reign.endReason = reason;
  ctx.alert("bad", `Your rule has ended. ${reason}`, "politics");
  ctx.events.emit({ type: "reignEnded" });
}

export const leaderSystem: System = {
  id: "leader",
  onDay(ctx) {
    const s = ctx.state;
    const reign = s.reign;
    if (!reign || reign.endedAt !== null || !s.player.alive) return;
    if (playerRuledCountry(ctx) !== reign.countryId) {
      endReign(ctx, lossReason(ctx, reign));
      return;
    }
    // The party machine puts a sitting leader on the ballot automatically.
    const p = s.player;
    if (p.politics.candidacy) return;
    for (const e of s.politics.elections) {
      if (e.status !== "upcoming") continue;
      const office = s.politics.offices.find((o) => o.id === e.officeId);
      if (office?.kind !== "headOfGovernment" || !office.holders.includes("player")) continue;
      p.politics.candidacy = { electionId: e.id, effort: 120, fundsCents: 0, spentCents: 0 };
      ctx.log("politics", `You are running for re-election on ${formatDate(e.date)}.`);
      return;
    }
  },
};
