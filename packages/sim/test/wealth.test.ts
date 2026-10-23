import { describe, expect, it } from "vitest";
import {
  createNewGame,
  holdingValue,
  netWorth,
  propertyPrice,
  supplyFactor,
  updateMarkets,
  type Command,
  type Game,
} from "../src";
import { economicConfig, testCharacter, tinyGeography } from "./fixtures";

const geo = tinyGeography();
const DAY = 24;

function rich(): Game {
  const game = createNewGame({ config: economicConfig(), character: testCharacter }, geo);
  game.state.player.cashCents = 10_000_000_000;
  return game;
}

function run(game: Game, command: Command) {
  const result = game.dispatch(command);
  if (!result.ok) throw new Error(`${command.type} refused: ${result.reason}`);
}

describe("savings and investing", () => {
  it("savings move cash in and out", () => {
    const game = rich();
    run(game, { type: "savings.move", amountCents: 1_000_000 });
    expect(game.state.wealth.savingsCents).toBe(1_000_000);
    expect(game.dispatch({ type: "savings.move", amountCents: -2_000_000 }).ok).toBe(false);
    run(game, { type: "savings.move", amountCents: -500_000 });
    expect(game.state.wealth.savingsCents).toBe(500_000);
  });

  it("stocks follow their country's market, and gains are taxed when sold", () => {
    const game = rich();
    run(game, { type: "invest.buy", kind: "stocks", target: "AAA", amountCents: 1_000_000 });
    const h = game.state.wealth.holdings[0]!;
    const before = holdingValue(game, h);
    game.state.markets.indexes.AAA = 150;
    expect(holdingValue(game, h)).toBeGreaterThan(before * 1.4);
    const cash = game.state.player.cashCents;
    const value = holdingValue(game, h);
    run(game, { type: "invest.sell", holdingId: h.id, fraction: 1 });
    expect(game.state.wealth.holdings).toHaveLength(0);
    const gained = game.state.player.cashCents - cash;
    expect(gained).toBeGreaterThan(1_000_000);
    // Fees and capital gains tax come off the top.
    expect(gained).toBeLessThan(value);
  });

  it("markets move every month, and bonds pay interest", () => {
    const game = rich();
    run(game, { type: "invest.buy", kind: "bonds", target: "AAA", amountCents: 10_000_000 });
    const cash = game.state.player.cashCents;
    game.tick(40 * DAY);
    expect(game.state.markets.indexes.AAA).not.toBe(100);
    expect(game.state.markets.commodities.oil).toBeGreaterThan(0);
    expect(game.state.markets.richList.length).toBeGreaterThan(10);
    expect(
      game.state.player.finance.ledger.some((t) => t.description.startsWith("Dividends")),
    ).toBe(true);
    expect(game.state.player.cashCents).not.toBe(cash);
  });

  it("offshore money is a secret", () => {
    const game = rich();
    run(game, { type: "offshore.move", amountCents: 100_000_000 });
    expect(game.state.wealth.offshoreCents).toBe(98_000_000);
    expect(game.state.player.legal.secrets.some((s) => s.crime === "fraud")).toBe(true);
  });
});

describe("real estate", () => {
  it("mortgages need income; property can be lived in or rented out", () => {
    const game = rich();
    game.state.player.cashCents = propertyPrice(game, 0, "house");
    expect(
      game.dispatch({ type: "property.buy", cityId: 0, kind: "house", mortgage: true }).ok,
    ).toBe(false);
    run(game, { type: "property.buy", cityId: 0, kind: "apartment", mortgage: false });
    const home = game.state.wealth.properties[0]!;
    run(game, { type: "property.moveIn", propertyId: home.id });
    expect(game.state.player.housing).toEqual({ kind: "owned", propertyId: home.id });
    expect(game.dispatch({ type: "property.rentOut", propertyId: home.id, rentOut: true }).ok).toBe(
      false,
    );
  });

  it("rented property earns money each month", () => {
    const game = rich();
    run(game, { type: "property.buy", cityId: 0, kind: "commercial", mortgage: false });
    const prop = game.state.wealth.properties[0]!;
    run(game, { type: "property.rentOut", propertyId: prop.id, rentOut: true });
    game.tick(70 * DAY);
    expect(
      game.state.player.finance.ledger.some((t) => t.category === "rent" && t.amountCents > 0),
    ).toBe(true);
  });
});

describe("influence", () => {
  it("donations lift a party; lobbying puts a bill to a vote", () => {
    const game = rich();
    const country = game.state.world.countries.AAA!;
    country.parties.push({
      ...country.parties[0]!,
      id: "AAA-px",
      name: "Test Party",
      popularity: 0.1,
    });
    const party = country.parties[country.parties.length - 1]!;
    const before = party.popularity / country.parties.reduce((s, x) => s + x.popularity, 0);
    run(game, { type: "influence.donate", partyId: party.id, amountCents: 500_000_000 });
    expect(party.popularity).toBeGreaterThan(before);
    expect(game.state.player.reputation.establishment).toBeGreaterThan(0);
    const bills = game.state.politics.bills.length;
    run(game, { type: "influence.lobby", policyId: "incomeTax", direction: -1 });
    expect(game.state.politics.bills.length).toBe(bills + 1);
  });

  it("media outlets bring fame and can back a party", () => {
    const game = rich();
    run(game, { type: "media.buy" });
    const outlet = game.state.wealth.media[0]!;
    const party = game.state.world.countries.AAA!.parties[0]!;
    run(game, { type: "media.line", outletId: outlet.id, partyId: party.id });
    game.tick(40 * DAY);
    expect(game.state.player.reputation.fame).toBeGreaterThan(5);
  });
});

describe("net worth and business", () => {
  it("net worth adds everything up", () => {
    const game = rich();
    run(game, { type: "savings.move", amountCents: 1_000_000 });
    run(game, { type: "invest.buy", kind: "commodity", target: "gold", amountCents: 1_000_000 });
    const w = netWorth(game);
    expect(w.savings).toBe(1_000_000);
    expect(w.total).toBe(w.cash + w.savings + w.investments - w.debts);
    updateMarkets(game);
    expect(game.state.markets.lastChange.gold).toBeDefined();
  });

  it("local resources make materials cheaper", () => {
    const game = rich();
    run(game, {
      type: "business.found",
      name: "Test Diner",
      sector: "hospitality",
      capitalCents: 50_000_000,
    });
    const b = game.state.businesses[0]!;
    const province = game.state.world.provinces[0]!;
    province.resources = ["farmland"];
    const local = supplyFactor(game, b);
    province.resources = ["gold"];
    expect(local).toBeLessThan(supplyFactor(game, b));
  });
});
