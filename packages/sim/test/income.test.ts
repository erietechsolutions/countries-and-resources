import { describe, expect, it } from "vitest";
import {
  createNewGame,
  documentedIncome,
  isWorking,
  loanOffers,
  rentalListings,
  type Command,
  type Game,
} from "../src";
import { economicConfig, testCharacter, tinyGeography } from "./fixtures";

const geo = tinyGeography();
const DAY = 24;

function owner(): Game {
  const game = createNewGame(
    {
      config: economicConfig({ startingHousing: "homeless", startingCashCents: 0 }),
      character: testCharacter,
    },
    geo,
  );
  game.state.player.cashCents = 50_000_000;
  run(game, {
    type: "business.found",
    name: "Corner Shop",
    sector: "retail",
    capitalCents: 30_000_000,
  });
  return game;
}

function run(game: Game, command: Command) {
  const result = game.dispatch(command);
  if (!result.ok) throw new Error(`${command.type} refused: ${result.reason}`);
}

describe("income from a business", () => {
  it("running a business counts as working", () => {
    expect(isWorking(owner())).toBe(true);
  });

  it("an owner's salary is paid on Fridays and counts after 14 days of steady pay", () => {
    const game = owner();
    const b = game.state.businesses[0]!;
    run(game, { type: "business.salary", businessId: b.id, monthlyCents: 500_000 });
    expect(documentedIncome(game).business).toBe(0);
    expect(documentedIncome(game).pending).toBe(true);
    const room = () => rentalListings(game).find((l) => l.unit === "room")!;
    expect(room().reason).toMatch(/14 days/);

    game.tick(16 * DAY);
    expect(
      game.state.player.finance.ledger.some((t) => t.description.startsWith("Salary from")),
    ).toBe(true);
    const income = documentedIncome(game);
    expect(income.business).toBe(500_000);
    expect(income.pending).toBe(false);
    expect(room().available).toBe(true);
    expect(room().cosigned).toBe(false);
  });

  it("a missed salary resets the record", () => {
    const game = owner();
    const b = game.state.businesses[0]!;
    run(game, { type: "business.salary", businessId: b.id, monthlyCents: 500_000 });
    game.tick(16 * DAY);
    expect(documentedIncome(game).business).toBeGreaterThan(0);
    b.cashCents = 0;
    game.tick(8 * DAY);
    expect(b.salaryPaidSince).toBeNull();
    expect(documentedIncome(game).business).toBe(0);
  });

  it("only what the business really earns counts", () => {
    const game = owner();
    const b = game.state.businesses[0]!;
    run(game, { type: "business.salary", businessId: b.id, monthlyCents: 5_000_000 });
    game.tick(16 * DAY);
    // A new shop with no sales: only a third of its cash is believable as pay.
    expect(documentedIncome(game).business).toBeLessThanOrEqual(Math.round(b.cashCents / 3) + 1);
  });

  it("banks lend against 14 days of steady income; payday lenders against any paycheck", () => {
    const game = owner();
    const b = game.state.businesses[0]!;
    expect(loanOffers(game)[0]!.available).toBe(false);
    run(game, { type: "business.salary", businessId: b.id, monthlyCents: 500_000 });
    expect(loanOffers(game)[0]!.available).toBe(true);
    expect(loanOffers(game)[1]!.reason).toMatch(/14 days/);
    game.tick(16 * DAY);
    expect(loanOffers(game)[1]!.reason ?? "").not.toMatch(/14 days/);
  });
});
