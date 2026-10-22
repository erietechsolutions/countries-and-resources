/**
 * World history report: lets the AI world run for years (the player just keeps fed) and lists
 * the wars, uprisings and new countries that came of it. Useful for tuning how turbulent the
 * world is.
 *
 *   npx tsx tools/sim/worldHistory.ts [years] [seeds]
 */
import { createNewGame, type Game } from "../../packages/sim/src";
import { realWorld } from "./balance";

export interface WorldHistory {
  seed: number;
  wars: string[];
  uprisings: number;
  newCountries: string[];
  regionsChanged: number;
}

export function runWorld(seed: number, years: number): WorldHistory {
  const city = realWorld.cities.find((c) => c.name === "Chicago")!;
  const game: Game = createNewGame(
    {
      config: {
        mode: "economic",
        mapType: "real",
        geographyId: realWorld.id,
        worldSeed: seed,
        startTime: Date.UTC(2026, 0, 1) / 3_600_000,
        startingCashCents: 200_000,
        startingHousing: "parents",
        startCityId: city.id,
      },
      character: {
        firstName: "World",
        lastName: "Watcher",
        gender: "nonbinary",
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
  let uprisings = 0;
  game.events.on("log", (e) => {
    if (e.entry.message.startsWith("Uprising in")) uprisings++;
  });
  for (let day = 0; day < years * 365; day++) {
    const p = game.state.player;
    p.birthTime = game.state.time - 25 * 365 * 24; // keep the watcher young
    Object.assign(p.needs, { food: 80, energy: 80, hygiene: 80, health: 90 });
    game.tick(24);
  }
  const s = game.state;
  return {
    seed,
    wars: s.conflict.wars.map((w) => `${w.name}: ${w.outcome ?? `ongoing, score ${w.score}`}`),
    uprisings,
    newCountries: (s.world.foundedCountries ?? []).map((f) => f.name),
    regionsChanged: Object.keys(s.world.provinceOwners ?? {}).length,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const years = Number(process.argv[2] ?? 15);
  const seeds = Number(process.argv[3] ?? 3);
  for (let seed = 1; seed <= seeds; seed++) {
    const h = runWorld(seed, years);
    console.log(
      `\nSeed ${seed}: ${h.wars.length} wars, ${h.uprisings} uprisings, ${h.newCountries.length} new countries, ${h.regionsChanged} regions changed hands`,
    );
    for (const w of h.wars) console.log(`  war  ${w}`);
    for (const c of h.newCountries) console.log(`  new  ${c}`);
  }
}
