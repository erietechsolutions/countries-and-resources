/**
 * Balance report: plays bots through starts in cities across poor and rich countries.
 *
 *   npm run balance            (180 days, default seeds)
 *   npm run balance -- 365     (custom number of days)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createNewGame,
  formatMoney,
  type GameMode,
  type StartingHousing,
  type WorldGeography,
} from "../../packages/sim/src";
import { playBot, type BotStats } from "./bot";

const here = path.dirname(fileURLToPath(import.meta.url));
export const realWorld = JSON.parse(
  fs.readFileSync(path.resolve(here, "../../data/geography/real-world.json"), "utf8"),
) as WorldGeography;

export interface RunResult extends BotStats {
  city: string;
  mode: GameMode;
  housing: string;
  employed: boolean;
  jobTitle: string;
  cash: string;
  development: number;
  finalHealth: number;
}

export function runScenario(
  cityName: string,
  mode: GameMode,
  start: StartingHousing,
  seed: number,
  days: number,
): RunResult {
  const city = realWorld.cities.find((c) => c.name === cityName);
  if (!city) throw new Error(`No city named ${cityName}`);
  const hard = mode === "hardEconomic";
  const game = createNewGame(
    {
      config: {
        mode,
        mapType: "real",
        geographyId: realWorld.id,
        worldSeed: seed,
        startTime: Date.UTC(2026, 9, 3) / 3_600_000,
        startingCashCents: hard ? 0 : 200_000,
        startingHousing: hard ? "homeless" : start,
        startCityId: city.id,
      },
      character: {
        firstName: "Bot",
        lastName: "Player",
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
  const stats = playBot(game, days);
  const p = game.state.player;
  return {
    ...stats,
    city: cityName,
    mode,
    housing: p.housing.kind,
    employed: p.job !== null,
    jobTitle: p.job?.occupationId ?? "-",
    cash: formatMoney(p.cashCents, true),
    development: game.state.world.countries[city.countryId]!.development,
    finalHealth: Math.round(p.needs.health),
  };
}

export const SCENARIO_CITIES = [
  "Chicago",
  "Lyon",
  "São Paulo",
  "Lagos",
  "Mumbai",
  "Tokyo",
  "Cairo",
  "Warsaw",
];

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const days = Number(process.argv[2] ?? 180);
  const rows: RunResult[] = [];
  for (const seed of [11, 22, 33]) {
    for (const city of SCENARIO_CITIES) {
      rows.push(runScenario(city, "hardEconomic", "homeless", seed, days));
      rows.push(runScenario(city, "economic", "parents", seed, days));
    }
  }
  console.table(
    rows.map((r) => ({
      city: r.city,
      mode: r.mode === "hardEconomic" ? "hard" : "econ",
      dev: r.development.toFixed(2),
      firstJob: r.firstJobDay ?? "never",
      employed: r.employed ? r.jobTitle : "no",
      home: r.housing,
      homelessDays: r.daysHomeless,
      cash: r.cash,
      hospital: r.hospitalVisits,
      collapses: r.collapses,
      robbed: r.robberies,
      fired: r.firedOrLaidOff,
      health: r.finalHealth,
    })),
  );
  const hard = rows.filter((r) => r.mode === "hardEconomic");
  const pct = (xs: RunResult[], f: (r: RunResult) => boolean) =>
    `${Math.round((xs.filter(f).length / xs.length) * 100)}%`;
  console.log(
    `Hard Economic after ${days} days: employed ${pct(hard, (r) => r.employed)}, housed ${pct(hard, (r) => r.housing !== "homeless")}, hospitalized at least once ${pct(hard, (r) => r.hospitalVisits > 0)}`,
  );
}
