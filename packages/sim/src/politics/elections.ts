import { addDays, ageInYears, type GameTime } from "../core/calendar";
import type { GameContext } from "../core/game";
import { hashString } from "../core/rng";
import { rivalCandidateAppeal } from "../ai/rivals";
import { cityCosts } from "../economy/costs";
import { transact } from "../finance/finance";
import { personById } from "../social/people";
import { adjustReputation } from "../social/social";
import { formatMoney, formatPercent } from "../world/format";
import type { CountryState, Party } from "../world/types";
import { isPresidential, largestRemainder, newPolitician, officeScope } from "./government";
import { playerParty } from "./party";
import type { Candidate, Election, ElectionResult, Office, OfficeKind } from "./types";

const DAY = 24;
const FILING_OPENS_DAYS = 120;
const FILING_CLOSES_DAYS = 45;

/** Party rank needed to be a party's candidate, and minimum age, by office. */
export const REQUIREMENTS: Record<
  OfficeKind,
  { rank: number; age: number; fee: number; independentFame: number }
> = {
  councilor: { rank: 0, age: 18, fee: 15, independentFame: 0 },
  mayor: { rank: 2, age: 21, fee: 40, independentFame: 15 },
  regionalCouncilor: { rank: 1, age: 21, fee: 40, independentFame: 10 },
  governor: { rank: 3, age: 25, fee: 100, independentFame: 35 },
  legislator: { rank: 2, age: 25, fee: 80, independentFame: 1000 },
  headOfGovernment: { rank: 5, age: 30, fee: 300, independentFame: 60 },
};

export function officeById(ctx: GameContext, id: string): Office | undefined {
  return ctx.state.politics.offices.find((o) => o.id === id);
}

export function electionFor(ctx: GameContext, office: Office): Election | undefined {
  return ctx.state.politics.elections.find(
    (e) => e.officeId === office.id && e.status === "upcoming",
  );
}

function countryOf(ctx: GameContext, office: Office): CountryState {
  return ctx.state.world.countries[office.countryId]!;
}

/** Opens upcoming elections once their filing period starts. */
export function scheduleElections(ctx: GameContext): void {
  const now = ctx.state.time;
  for (const office of ctx.state.politics.offices) {
    if (office.nextElection === null || electionFor(ctx, office)) continue;
    // Parliamentary systems choose their head of government in the legislature.
    if (office.kind === "headOfGovernment" && !isPresidential(countryOf(ctx, office))) continue;
    if (now < office.nextElection - FILING_OPENS_DAYS * DAY) continue;
    ctx.state.politics.elections.push({
      id: `e${ctx.state.politics.nextId++}`,
      officeId: office.id,
      date: office.nextElection,
      filingOpens: now,
      filingCloses: office.nextElection - FILING_CLOSES_DAYS * DAY,
      candidates: [],
      status: "upcoming",
    });
  }
}

function residesIn(ctx: GameContext, office: Office): boolean {
  const geoCity = ctx.geography.cities[ctx.state.player.cityId]!;
  if (geoCity.countryId !== office.countryId) return false;
  if (office.level === "city") return office.cityId === ctx.state.player.cityId;
  if (office.level === "region") return office.provinceId === geoCity.provinceId;
  return true;
}

export function filingFee(ctx: GameContext, office: Office, independent: boolean): number {
  const wage = cityCosts(ctx, ctx.state.player.cityId).medianWageCents;
  return Math.round(wage * REQUIREMENTS[office.kind].fee * (independent ? 2 : 1));
}

/** Why the player can't file for this election, or null. */
export function filingBlocker(ctx: GameContext, election: Election): string | null {
  const p = ctx.state.player;
  const office = officeById(ctx, election.officeId);
  if (!office) return "Unknown office.";
  const req = REQUIREMENTS[office.kind];
  const now = ctx.state.time;
  if (now > election.filingCloses) return "Filing has closed.";
  if (p.politics.candidacy) return "You're already running for something.";
  if (office.holders.includes("player") && office.seats === 1) return null;
  if (!p.citizenship.includes(office.countryId)) return "Only citizens can run.";
  if (!residesIn(ctx, office)) return "You must live in the area to run.";
  if (ageInYears(p.birthTime, now) < req.age) return `You must be at least ${req.age}.`;
  const party = playerParty(ctx);
  if (office.kind === "legislator" && !party)
    return "Seats are won on party lists: join a party first.";
  if (party) {
    if (!party.legal) return "Your party is banned from elections.";
    if (p.politics.rank < req.rank)
      return `Your party nominates members ranked ${req.rank}+ for this office.`;
  } else if (p.reputation.fame < req.independentFame) {
    return `Independent candidates need fame ${req.independentFame}+ (you have ${Math.round(p.reputation.fame)}).`;
  }
  const fee = filingFee(ctx, office, !party);
  if (fee > p.cashCents) return `The filing fee is ${formatMoney(fee, true)}.`;
  return null;
}

export function fileCandidacy(ctx: GameContext, electionId: string): string | null {
  const election = ctx.state.politics.elections.find(
    (e) => e.id === electionId && e.status === "upcoming",
  );
  if (!election) return "That election isn't open.";
  const blocked = filingBlocker(ctx, election);
  if (blocked) return blocked;
  const office = officeById(ctx, election.officeId)!;
  const party = playerParty(ctx);
  const fee = filingFee(ctx, office, !party);
  transact(ctx, -fee, "other", `Filing fee: ${office.title}`);
  ctx.state.player.politics.candidacy = { electionId, effort: 0, fundsCents: 0, spentCents: 0 };
  ctx.alert(
    "good",
    `You're running for ${office.title}! Election day is ${new Date(election.date * 3.6e6).toUTCString().slice(5, 16)}. Campaign and fundraise to win votes.`,
    "politics",
  );
  return null;
}

export function withdrawCandidacy(ctx: GameContext): string | null {
  const p = ctx.state.player;
  if (!p.politics.candidacy) return "You're not running.";
  p.politics.candidacy = null;
  ctx.log("politics", "You withdrew from the race.");
  return null;
}

export function spendOnAds(ctx: GameContext, amountCents: number): string | null {
  const c = ctx.state.player.politics.candidacy;
  if (!c) return "You're not running for anything.";
  if (!Number.isInteger(amountCents) || amountCents <= 0) return "Choose an amount.";
  const fromFunds = Math.min(c.fundsCents, amountCents);
  const fromCash = amountCents - fromFunds;
  if (fromCash > ctx.state.player.cashCents) return "Not enough campaign funds or cash.";
  c.fundsCents -= fromFunds;
  if (fromCash > 0) transact(ctx, -fromCash, "other", "Campaign ads");
  c.spentCents += amountCents;
  return null;
}

// ---------------------------------------------------------------------------------------------
// Vote model

/** Local strength of a party: national popularity with a stable regional lean. */
function localStrength(party: Party, office: Office): number {
  const lean = ((hashString(`${party.id}|${officeScope(office)}`) % 1000) / 1000 - 0.5) * 0.6;
  return Math.max(0.002, party.popularity * (1 + lean));
}

/** The player's personal pull with voters, from reputation, fame and campaign effort. */
export function playerAppeal(ctx: GameContext, office: Office): number {
  const p = ctx.state.player;
  const rep = p.reputation;
  const c = p.politics.candidacy;
  const wage = cityCosts(ctx, p.cityId).medianWageCents;
  const reputation =
    (rep.community * 0.5 +
      rep.workers * 0.25 +
      rep.business * 0.25 +
      rep.activists * 0.15 -
      Math.max(0, rep.underworld) * 0.6) /
    100;
  const scale = office.level === "city" ? 1 : office.level === "region" ? 0.7 : 0.5;
  const effort = c ? Math.min(0.35, c.effort / 200) * scale : 0;
  const ads = c ? Math.min(0.3, Math.log10(1 + c.spentCents / (wage * 40)) * 0.15) * scale : 0;
  const incumbency = office.holders.includes("player") ? (p.politics.approval - 50) / 100 : 0;
  const record = p.legal.record.length * 0.15;
  const raw = reputation + rep.fame / 250 + effort + ads + incumbency - record;
  // Diminishing returns: no amount of money and effort guarantees a win.
  return raw > 0 ? 0.45 * Math.tanh(raw / 0.45) : raw;
}

function candidateScore(ctx: GameContext, office: Office, c: Candidate, slate = 1): number {
  const country = countryOf(ctx, office);
  const party = c.partyId ? country.parties.find((p) => p.id === c.partyId) : undefined;
  const base = (party ? localStrength(party, office) : 0.04) / slate;
  const appeal =
    c.id === "player" ? playerAppeal(ctx, office) : c.appeal + rivalCandidateAppeal(ctx, c.id);
  return base * Math.max(0.2, 1 + appeal) * (c.incumbent ? 1.12 : 1);
}

/** Current poll estimate for the player in an election (no randomness). */
export function pollShare(ctx: GameContext, election: Election): number {
  const office = officeById(ctx, election.officeId)!;
  const candidates = election.candidates.length
    ? election.candidates
    : nominees(ctx, office, false);
  const withPlayer = candidates.some((c) => c.id === "player")
    ? candidates
    : [...candidates, playerCandidate(ctx, office)];
  const scores = withPlayer.map((c) =>
    candidateScore(
      ctx,
      office,
      c,
      c.partyId ? withPlayer.filter((o) => o.partyId === c.partyId).length : 1,
    ),
  );
  const total = scores.reduce((a, b) => a + b, 0) || 1;
  return scores[withPlayer.findIndex((c) => c.id === "player")]! / total;
}

function playerCandidate(ctx: GameContext, office: Office): Candidate {
  return {
    id: "player",
    partyId: playerParty(ctx)?.id ?? null,
    appeal: 0,
    incumbent: office.holders.includes("player"),
  };
}

/** Party nominees. Creates NPC politicians when `commit` is true. */
function nominees(ctx: GameContext, office: Office, commit: boolean): Candidate[] {
  const country = countryOf(ctx, office);
  const parties = country.parties
    .filter((p) => p.legal)
    .sort((a, b) => b.popularity - a.popularity);
  const playerPartyId = ctx.state.player.politics.candidacy && playerParty(ctx)?.id;
  // Open lists: in multi-seat races a party fields up to a full slate and its vote is split among them.
  const perParty = office.seats === 1 ? 1 : office.seats;
  const list: Candidate[] = [];
  for (const party of parties.slice(0, office.seats === 1 ? 3 : 5)) {
    for (let i = 0; i < perParty; i++) {
      if (party.id === playerPartyId && i === 0) continue; // the player is this party's nominee
      const incumbentIdx = office.holders.findIndex(
        (h, idx) =>
          h !== "player" && office.holderParties[idx] === party.id && !list.some((c) => c.id === h),
      );
      const id =
        incumbentIdx >= 0
          ? office.holders[incumbentIdx]!
          : commit
            ? newPolitician(ctx, office.cityId ?? ctx.state.player.cityId, party)
            : `npc-${party.id}-${i}`;
      list.push({
        id,
        partyId: party.id,
        appeal: commit ? ctx.rng.float(-0.05, 0.6) : 0.15,
        incumbent: incumbentIdx >= 0,
      });
    }
  }
  return list;
}

/** Primary: for single-seat offices, party members compete for the nomination. */
function wonPrimary(ctx: GameContext, office: Office): boolean {
  const pol = ctx.state.player.politics;
  if (office.seats > 1 || !pol.partyId || office.kind === "legislator") return true;
  const incumbent = office.holders.includes("player");
  const chance = incumbent
    ? 0.9
    : Math.max(
        0.15,
        Math.min(0.9, 0.3 + pol.rank * 0.08 + pol.standing / 500 + playerAppeal(ctx, office) * 0.4),
      );
  if (ctx.rng.chance(chance)) {
    ctx.alert(
      "good",
      `You won your party's primary for ${office.title}. On to the general election!`,
      "politics",
    );
    return true;
  }
  pol.candidacy = null;
  pol.standing += 3;
  ctx.alert(
    "bad",
    `You lost your party's primary for ${office.title}. Another member will carry the party's banner.`,
    "politics",
  );
  return false;
}

function closeFiling(ctx: GameContext, election: Election): void {
  if (election.candidates.length > 0) return;
  const office = officeById(ctx, election.officeId)!;
  election.candidates = nominees(ctx, office, true);
  if (ctx.state.player.politics.candidacy?.electionId === election.id && !wonPrimary(ctx, office)) {
    // The player's party picked someone else; that nominee stays on the ballot.
    const party = playerParty(ctx);
    if (party && !election.candidates.some((c) => c.partyId === party.id)) {
      election.candidates.push({
        id: newPolitician(ctx, ctx.state.player.cityId, party),
        partyId: party.id,
        appeal: ctx.rng.float(0, 0.4),
        incumbent: false,
      });
    }
  } else if (ctx.state.player.politics.candidacy?.electionId === election.id) {
    election.candidates.push(playerCandidate(ctx, office));
    // A political rival takes their party's slot to face the player directly.
    const rival = ctx.state.rivals.find((r) => r.kind === "political");
    if (rival && !election.candidates.some((c) => c.id === rival.personId)) {
      const slot = election.candidates.find(
        (c) => c.id !== "player" && c.partyId !== playerParty(ctx)?.id,
      );
      if (slot) slot.id = rival.personId;
    }
  }
}

function resolveElection(ctx: GameContext, election: Election): void {
  const office = officeById(ctx, election.officeId)!;
  closeFiling(ctx, election);
  const country = countryOf(ctx, office);
  const playerRunning = election.candidates.some((c) => c.id === "player");
  let results: ElectionResult[];

  if (office.kind === "legislator") {
    // Proportional: parties win seats by vote share; members fill them in rank order.
    const parties = country.parties.filter((p) => p.legal);
    const playerPartyId = playerRunning ? playerParty(ctx)?.id : undefined;
    const scores = parties.map(
      (p) =>
        localStrength(p, office) *
        ctx.rng.float(0.88, 1.12) *
        (p.id === playerPartyId ? 1 + playerAppeal(ctx, office) * 0.15 : 1),
    );
    const seats = largestRemainder(scores, office.seats);
    const total = scores.reduce((a, b) => a + b, 0) || 1;
    election.partySeats = Object.fromEntries(parties.map((p, i) => [p.id, seats[i]!]));
    const holders: string[] = [];
    const holderParties: (string | null)[] = [];
    let playerWon = false;
    parties.forEach((party, i) => {
      const n = seats[i]!;
      const listPosition = [50, 25, 12, 6, 3, 1][ctx.state.player.politics.rank]!;
      const playerIn = party.id === playerPartyId && n >= listPosition;
      if (playerIn) playerWon = true;
      const keep = office.holders.filter(
        (h, idx) => h !== "player" && office.holderParties[idx] === party.id,
      );
      for (let s = 0; s < n; s++) {
        holders.push(
          playerIn && s === 0
            ? "player"
            : (keep.shift() ?? newPolitician(ctx, ctx.state.player.cityId, party)),
        );
        holderParties.push(party.id);
      }
    });
    office.holders = holders;
    office.holderParties = holderParties;
    results = parties.map((p, i) => ({
      id: p.id,
      partyId: p.id,
      share: scores[i]! / total,
      won: seats[i]! > 0,
    }));
    // The largest party governs.
    const biggest = parties[seats.indexOf(Math.max(...seats))];
    if (biggest) setGoverningParty(ctx, country, biggest);
    if (playerRunning)
      reportPlayer(
        ctx,
        office,
        playerWon,
        (scores[parties.findIndex((p) => p.id === playerPartyId)] ?? 0) / total,
      );
  } else {
    const slate = (c: Candidate) =>
      c.partyId ? election.candidates.filter((o) => o.partyId === c.partyId).length : 1;
    const scores = election.candidates.map(
      (c) => candidateScore(ctx, office, c, slate(c)) * ctx.rng.float(0.75, 1.25),
    );
    const total = scores.reduce((a, b) => a + b, 0) || 1;
    const order = election.candidates
      .map((c, i) => ({ c, s: scores[i]! }))
      .sort((a, b) => b.s - a.s);
    const winners = order.slice(0, office.seats);
    office.holders = winners.map((w) => w.c.id);
    office.holderParties = winners.map((w) => w.c.partyId);
    results = order.map((o, idx) => ({
      id: o.c.id,
      partyId: o.c.partyId,
      share: o.s / total,
      won: idx < office.seats,
    }));
    if (office.kind === "headOfGovernment" && winners[0]?.c.partyId) {
      const party = country.parties.find((p) => p.id === winners[0]!.c.partyId);
      if (party) country.rulingPartyId = party.id;
    }
    if (playerRunning) {
      const mine = results.find((r) => r.id === "player")!;
      reportPlayer(ctx, office, mine.won, mine.share);
    }
  }

  election.status = "done";
  election.results = results;
  office.nextElection = addDays(election.date, office.termYears * 365);
  const local = ctx.geography.cities[ctx.state.player.cityId]!;
  const affectsPlayer =
    office.countryId === local.countryId &&
    (office.level === "national" ||
      office.cityId === ctx.state.player.cityId ||
      office.provinceId === local.provinceId);
  if (affectsPlayer && !playerRunning) {
    const top = results.find((r) => r.won);
    const name = top
      ? top.id === "player"
        ? "you"
        : (personById(ctx, top.id)?.lastName ?? country.parties.find((p) => p.id === top.id)?.name)
      : "";
    const party = top?.partyId
      ? country.parties.find((p) => p.id === top.partyId)?.name
      : undefined;
    ctx.log(
      "politics",
      `Election for ${office.title}: ${office.kind === "legislator" ? `${party} won the most seats` : `${name}${party ? ` (${party})` : ""} won`}.`,
    );
  }
}

/** In parliamentary systems the governing party's leader becomes head of government. */
export function setGoverningParty(ctx: GameContext, country: CountryState, party: Party): void {
  const changed = country.rulingPartyId !== party.id;
  country.rulingPartyId = party.id;
  if (isPresidential(country)) return;
  const head = ctx.state.politics.offices.find(
    (o) => o.kind === "headOfGovernment" && o.countryId === country.id,
  );
  if (!head) return;
  const pol = ctx.state.player.politics;
  const playerLeads =
    pol.partyId === party.id && pol.rank >= 5 && ctx.state.player.citizenship.includes(country.id);
  if (playerLeads) {
    if (!head.holders.includes("player")) {
      ctx.alert("good", `Your party won! You are now ${head.title}.`, "politics");
      for (const other of ctx.state.politics.offices) {
        const i = other.holders.indexOf("player");
        if (other !== head && i >= 0)
          other.holders[i] = newPolitician(ctx, ctx.state.player.cityId, party);
      }
    }
    head.holders = ["player"];
  } else if (changed || head.holders[0] === "player") {
    head.holders = [newPolitician(ctx, ctx.state.player.cityId, party)];
  }
  head.holderParties = [party.id];
}

function reportPlayer(ctx: GameContext, office: Office, won: boolean, share: number): void {
  const p = ctx.state.player;
  p.politics.candidacy = null;
  if (won) {
    p.politics.electionsWon = (p.politics.electionsWon ?? 0) + 1;
    // One job at a time: winning a new office means giving up any other.
    for (const other of ctx.state.politics.offices) {
      if (other.id === office.id) continue;
      const i = other.holders.indexOf("player");
      if (i >= 0) other.holders[i] = newPolitician(ctx, ctx.state.player.cityId, null);
    }
    p.politics.standing += 20;
    p.politics.approval = 55;
    adjustReputation(ctx, "fame", office.level === "city" ? 4 : office.level === "region" ? 8 : 12);
    adjustReputation(ctx, "establishment", 3);
    const role = office.seats === 1 ? office.title : `a member of the ${office.title}`;
    ctx.alert(
      "good",
      `You won with ${formatPercent(share, 0)} of the vote! You are now ${role}.`,
      "politics",
    );
  } else {
    p.politics.standing += 5;
    adjustReputation(ctx, "fame", 1);
    ctx.alert(
      "bad",
      `You lost the race for ${office.title}, with ${formatPercent(share, 0)} of the vote.`,
      "politics",
    );
  }
}

export function runElections(ctx: GameContext): void {
  const now: GameTime = ctx.state.time;
  for (const e of ctx.state.politics.elections) {
    if (e.status !== "upcoming") continue;
    if (now >= e.filingCloses && e.candidates.length === 0) closeFiling(ctx, e);
    if (now >= e.date) resolveElection(ctx, e);
  }
  // Keep a short history only.
  const done = ctx.state.politics.elections.filter((e) => e.status === "done");
  if (done.length > 30) {
    const drop = new Set(done.slice(0, done.length - 30));
    ctx.state.politics.elections = ctx.state.politics.elections.filter((e) => !drop.has(e));
  }
}
