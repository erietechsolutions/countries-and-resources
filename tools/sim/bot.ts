/**
 * A simple rule-based player used for balance testing. It only uses player commands, so it can
 * do nothing a real player couldn't. It survives first, then works its way up.
 */
import {
  activityBlocker,
  activityById,
  cityCosts,
  electionFor,
  filingBlocker,
  officesFor,
  rentalListings,
  toDateParts,
  type Command,
  type Game,
} from "../../packages/sim/src";

export interface BotStats {
  hospitalVisits: number;
  collapses: number;
  robberies: number;
  firstJobDay: number | null;
  jobsHeld: number;
  firedOrLaidOff: number;
  daysHomeless: number;
  minFood: number;
}

function tryStart(game: Game, activityId: string, amount?: number): boolean {
  const def = activityById(activityId);
  if (!def || activityBlocker(game, def, amount ?? def.amount?.default(game))) return false;
  return game.dispatch({ type: "activity.start", activityId, amount }).ok;
}

function tryCommand(game: Game, command: Command): boolean {
  return game.dispatch(command).ok;
}

/** Makes one decision if the character is free. */
export function botStep(game: Game): void {
  const s = game.state;
  const p = s.player;
  if (p.activity) return;
  const hour = toDateParts(s.time).hour;
  const n = p.needs;
  const costs = cityCosts(game, p.cityId);

  // Take the best job offer.
  if (p.jobOffers.length > 0) {
    const best = [...p.jobOffers].sort((a, b) => b.wageCents - a.wageCents)[0]!;
    if (!p.job || best.wageCents > p.job.wageCents * 1.1)
      tryCommand(game, { type: "job.accept", offerId: best.id });
  }
  // Move into the cheapest place once it is affordable with a buffer.
  if (p.housing.kind === "homeless") {
    const room = rentalListings(game).find((l) => l.unit === "room");
    if (room?.available && p.cashCents > room.upfrontCents + room.rentCents)
      tryCommand(game, { type: "housing.rent", unit: "room" });
  }
  // Useful purchases once there is spare cash.
  for (const item of ["phone", "backpack", "sleepingBag", "interviewClothes"] as const) {
    if (p.inventory.items.includes(item)) continue;
    if (item === "sleepingBag" && p.housing.kind !== "homeless") continue;
    if (p.cashCents > costs.itemCents(item) * 4) tryCommand(game, { type: "shop.buy", item });
  }

  const night = hour >= 22 || hour < 6;
  if (
    p.housing.kind === "homeless" &&
    hour >= 17 &&
    hour < 23 &&
    !p.shelterBedUntil &&
    tryStart(game, "shelter")
  )
    return;
  if (n.food < 45) {
    if (tryStart(game, "eat") || tryStart(game, "soupKitchen")) return;
    if (p.cashCents > costs.mealCents * 6 && tryStart(game, "groceries")) return;
    if (p.cashCents > costs.fastFoodCents * 3 && tryStart(game, "fastFood")) return;
    if (n.food < 20 && (tryStart(game, "foodBank") || tryStart(game, "dumpster"))) return;
  }
  if (n.energy < 25 || (night && n.energy < 75)) {
    if (tryStart(game, "sleep")) return;
  }
  if (n.hygiene < 40) {
    if (tryStart(game, "shower")) return;
    if (p.cashCents > costs.showerCents * 5 && tryStart(game, "gymShower")) return;
    if (tryStart(game, "washUp")) return;
  }
  if (!p.job) {
    if (tryStart(game, "dayLabor")) return;
    if (!p.daily.chores && p.housing.kind === "parents" && tryStart(game, "chores")) return;
    if ((p.cooldowns.botSearched ?? 0) <= s.time && tryStart(game, "jobSearch")) {
      p.cooldowns.botSearched = s.time + 20;
      return;
    }
    if (p.inventory.items.includes("bicycle") && tryStart(game, "delivery")) return;
    if (p.housing.kind === "homeless" && n.energy > 40) {
      if (tryStart(game, "cans") || tryStart(game, "panhandle")) return;
    }
  }
  if (p.housing.kind === "parents" && !p.daily.chores && tryStart(game, "chores")) return;
  if (politicalAmbition(game)) return;
  tryStart(game, "wait", 1);
}

/** Optional political career: join a party, volunteer, run for anything open, campaign hard. */
export const botOptions = { politics: false };

function politicalAmbition(game: Game): boolean {
  if (!botOptions.politics) return false;
  const p = game.state.player;
  const country = game.state.world.countries[game.geography.cities[p.cityId]!.countryId]!;
  if (!p.politics.partyId) {
    const party = [...country.parties]
      .filter((x) => x.legal)
      .sort((a, b) => b.popularity - a.popularity)[0];
    if (party) tryCommand(game, { type: "politics.join", partyId: party.id });
  }
  if (!p.politics.candidacy) {
    for (const office of officesFor(game, p.cityId)) {
      const e = electionFor(game, office);
      if (e && !filingBlocker(game, e) && game.time <= e.filingCloses) {
        tryCommand(game, { type: "politics.file", electionId: e.id });
        break;
      }
    }
  }
  if (p.politics.candidacy) {
    const c = p.politics.candidacy;
    if (c.fundsCents > 0) tryCommand(game, { type: "politics.ads", amountCents: c.fundsCents });
    return tryStart(game, c.effort < 150 ? "campaign" : "fundraise");
  }
  if (tryStart(game, "partyWork")) return true;
  return !p.job && tryStart(game, "volunteer");
}

export function playBot(game: Game, days: number): BotStats {
  const stats: BotStats = {
    hospitalVisits: 0,
    collapses: 0,
    robberies: 0,
    firstJobDay: null,
    jobsHeld: 0,
    firedOrLaidOff: 0,
    daysHomeless: 0,
    minFood: 100,
  };
  const start = game.time;
  game.events.on("log", (e) => {
    const m = e.entry.message;
    if (m.includes("rushed to the hospital")) stats.hospitalVisits++;
    if (m.includes("collapsed from exhaustion")) stats.collapses++;
    if (m.includes("robbed")) stats.robberies++;
    if (m.startsWith("You're hired")) {
      stats.jobsHeld++;
      stats.firstJobDay ??= Math.floor((game.time - start) / 24);
    }
    if (m.includes("fired") || m.includes("laid off")) stats.firedOrLaidOff++;
  });
  for (let h = 0; h < days * 24; h++) {
    botStep(game);
    game.tick();
    stats.minFood = Math.min(stats.minFood, game.state.player.needs.food);
    if (h % 24 === 0 && game.state.player.housing.kind === "homeless") stats.daysHomeless++;
  }
  return stats;
}
