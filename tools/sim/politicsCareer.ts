/**
 * Political career report: bots with political ambition play years in several democracies.
 *
 *   npx tsx tools/sim/politicsCareer.ts [years]
 */
import { createNewGame, playerOffices, RANK_TITLES, type Game } from "../../packages/sim/src";
import { realWorld } from "./balance";
import { botOptions, playBot } from "./bot";

export interface CareerResult {
  city: string;
  rank: string;
  races: number;
  wins: number;
  primariesLost: number;
  offices: string[];
  laws: number;
  fame: number;
}

export function runCareer(cityName: string, seed: number, years: number): CareerResult {
  const city = realWorld.cities.find((c) => c.name === cityName)!;
  const game: Game = createNewGame(
    {
      config: {
        mode: "economic",
        mapType: "real",
        geographyId: realWorld.id,
        worldSeed: seed,
        startTime: Date.UTC(2026, 9, 3) / 3_600_000,
        startingCashCents: 200_000,
        startingHousing: "parents",
        startCityId: city.id,
      },
      character: {
        firstName: "Bot",
        lastName: "Politician",
        gender: "female",
        appearance: {
          skinTone: "Medium",
          hairColor: "Black",
          hairStyle: "Short",
          eyeColor: "Brown",
          build: "Average",
        },
      },
    },
    realWorld,
  );
  // Make sure the country holds elections, so the career is possible.
  const country = game.state.world.countries[city.countryId]!;
  country.government = "democracy";
  for (const party of country.parties) party.legal = true;
  let races = 0;
  let wins = 0;
  let primariesLost = 0;
  game.events.on("alert", (e) => {
    if (e.message.startsWith("You won with")) wins++;
    if (e.message.startsWith("You won with") || e.message.startsWith("You lost the race")) races++;
    if (e.message.startsWith("You lost your party's primary")) primariesLost++;
  });
  botOptions.politics = true;
  try {
    playBot(game, Math.round(years * 365));
  } finally {
    botOptions.politics = false;
  }
  const p = game.state.player;
  return {
    city: cityName,
    rank: RANK_TITLES[p.politics.rank] ?? "-",
    races,
    wins,
    primariesLost,
    offices: playerOffices(game).map((o) => o.title),
    laws: game.state.politics.laws.filter((l) => l.passedBy === "player").length,
    fame: Math.round(p.reputation.fame),
  };
}

if (process.argv[1]?.endsWith("politicsCareer.ts")) {
  const years = Number(process.argv[2] ?? 5);
  const rows = ["Lyon", "Chicago", "Warsaw", "Tokyo", "São Paulo", "Mumbai"].flatMap((c) =>
    [11, 22].map((seed) => runCareer(c, seed, years)),
  );
  console.table(rows.map((r) => ({ ...r, offices: r.offices.join("; ") || "-" })));
}
