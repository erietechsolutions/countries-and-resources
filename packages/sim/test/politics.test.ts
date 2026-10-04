import { describe, expect, it } from "vitest";
import {
  createNewGame,
  electionFor,
  ensurePolitics,
  largestRemainder,
  officesFor,
  playerOffices,
  policyFor,
  runBudget,
  type Command,
  type Game,
} from "../src";
import { economicConfig, testCharacter, tinyGeography } from "./fixtures";

const geo = tinyGeography();

function democracy(): Game {
  const game = createNewGame({ config: economicConfig(), character: testCharacter }, geo);
  const c = game.state.world.countries.AAA!;
  c.government = "democracy";
  c.headOfStateTitle = "President";
  if (c.parties.length < 2) {
    c.parties = [
      {
        id: "AAA-p1",
        name: "Left Party",
        shortName: "LP",
        ideology: { economic: -0.7, social: -0.3, authority: 0, nationalism: 0 },
        popularity: 0.5,
        color: 0xff0000,
        legal: true,
      },
      {
        id: "AAA-p2",
        name: "Right Party",
        shortName: "RP",
        ideology: { economic: 0.7, social: 0.4, authority: 0.2, nationalism: 0.3 },
        popularity: 0.5,
        color: 0x0000ff,
        legal: true,
      },
    ];
  }
  c.parties.forEach((p) => (p.legal = true));
  c.rulingPartyId = c.parties[0]!.id;
  game.state.player.cashCents = 100_000_000;
  ensurePolitics(game);
  return game;
}

function run(game: Game, command: Command) {
  const result = game.dispatch(command);
  if (!result.ok) throw new Error(`${command.type} refused: ${result.reason}`);
}

function tickSafely(game: Game, hours: number) {
  for (let h = 0; h < hours; h++) {
    const n = game.state.player.needs;
    n.food = Math.max(n.food, 60);
    n.energy = Math.max(n.energy, 60);
    n.hygiene = Math.max(n.hygiene, 60);
    game.tick();
  }
}

describe("politics", () => {
  it("sets up city, regional and national offices held by NPC politicians", () => {
    const game = democracy();
    const kinds = officesFor(game, game.state.player.cityId)
      .map((o) => o.kind)
      .sort();
    expect(kinds).toEqual([
      "councilor",
      "governor",
      "headOfGovernment",
      "legislator",
      "mayor",
      "regionalCouncilor",
    ]);
    const legislature = officesFor(game, 0).find((o) => o.kind === "legislator")!;
    expect(legislature.holders).toHaveLength(101);
    expect(game.state.people.filter((p) => p.role === "politician").length).toBeGreaterThan(100);
  });

  it("allocates seats proportionally", () => {
    expect(largestRemainder([0.5, 0.3, 0.2], 10)).toEqual([5, 3, 2]);
    expect(largestRemainder([0.34, 0.33, 0.33], 101).reduce((a, b) => a + b)).toBe(101);
  });

  it("party members rise through the ranks by volunteering", () => {
    const game = democracy();
    const party = game.state.world.countries.AAA!.parties[0]!;
    run(game, { type: "politics.join", partyId: party.id });
    expect(game.state.player.politics.rank).toBe(0);
    game.state.player.politics.standing = 30;
    game.state.player.politics.joinedAt -= 24 * 70;
    tickSafely(game, 24 * 35);
    expect(game.state.player.politics.rank).toBeGreaterThanOrEqual(1);
  });

  it("founding a party makes you its leader", () => {
    const game = democracy();
    run(game, { type: "politics.found", name: "Future Party", preset: "green" });
    const party = game.state.world.countries.AAA!.parties.find((p) => p.name === "Future Party")!;
    expect(game.state.player.politics.partyId).toBe(party.id);
    expect(game.state.player.politics.rank).toBe(5);
  });

  it("a popular, hard-working candidate can win a city council seat", () => {
    const game = democracy();
    const p = game.state.player;
    run(game, { type: "politics.join", partyId: game.state.world.countries.AAA!.parties[0]!.id });
    const council = officesFor(game, p.cityId).find((o) => o.kind === "councilor")!;
    council.nextElection = game.time + 24 * 100;
    tickSafely(game, 24);
    const election = electionFor(game, council)!;
    expect(election).toBeDefined();
    run(game, { type: "politics.file", electionId: election.id });
    p.reputation.community = 60;
    p.reputation.fame = 30;
    p.politics.candidacy!.effort = 150;
    tickSafely(game, 24 * 101);
    expect(election.status).toBe("done");
    expect(council.holders).toContain("player");
    expect(playerOffices(game).map((o) => o.kind)).toContain("councilor");
  });

  it("council members propose bills, councils vote, and laws take effect", () => {
    const game = democracy();
    const council = officesFor(game, game.state.player.cityId).find((o) => o.kind === "councilor")!;
    council.holders[0] = "player";
    game.state.player.politics.proposalsLeft = 2;
    // Make the council friendly to the idea.
    council.holderParties = council.holderParties.map(
      () => game.state.world.countries.AAA!.parties[0]!.id,
    );
    for (const h of council.holders) {
      const person = game.state.people.find((x) => x.id === h);
      if (person) person.ideology = { economic: -0.9, social: -0.5, authority: 0, nationalism: 0 };
    }
    const mayor = officesFor(game, game.state.player.cityId).find((o) => o.kind === "mayor")!;
    const mayorPerson = game.state.people.find((x) => x.id === mayor.holders[0])!;
    mayorPerson.ideology = { economic: -0.9, social: -0.5, authority: 0, nationalism: 0 };
    const scope = `city:${game.state.player.cityId}`;
    const shelter = policyFor("shelterFunding", "city")!;
    const before = shelter.get(game, scope);
    run(game, {
      type: "politics.propose",
      officeId: council.id,
      policyId: "shelterFunding",
      direction: 1,
    });
    const bill = game.state.politics.bills.find((b) => b.proposerId === "player")!;
    run(game, { type: "politics.vote", billId: bill.id, vote: "yes" });
    tickSafely(game, 24 * 8);
    expect(bill.status).toBe("enacted");
    expect(shelter.get(game, scope)).toBeGreaterThan(before);
  });

  it("executives sign or veto bills", () => {
    const game = democracy();
    const mayor = officesFor(game, game.state.player.cityId).find((o) => o.kind === "mayor")!;
    mayor.holders = ["player"];
    const council = officesFor(game, game.state.player.cityId).find((o) => o.kind === "councilor")!;
    for (const h of council.holders) {
      const person = game.state.people.find((x) => x.id === h);
      if (person) person.ideology = { economic: -0.9, social: 0, authority: 0, nationalism: 0 };
    }
    game.state.player.politics.proposalsLeft = 1;
    run(game, {
      type: "politics.propose",
      officeId: mayor.id,
      policyId: "rentControl",
      direction: 1,
    });
    tickSafely(game, 24 * 8);
    const bill = game.state.politics.bills.find((b) => b.proposerId === "player")!;
    expect(bill.status).toBe("awaitingSignature");
    run(game, { type: "politics.sign", billId: bill.id, sign: false });
    expect(bill.status).toBe("vetoed");
  });

  it("autocrats rule by decree", () => {
    const game = democracy();
    const c = game.state.world.countries.AAA!;
    c.government = "absoluteMonarchy";
    const head = officesFor(game, 0).find((o) => o.kind === "headOfGovernment")!;
    head.holders = ["player"];
    game.state.player.politics.proposalsLeft = 1;
    const before = c.taxes.income;
    run(game, {
      type: "politics.propose",
      officeId: head.id,
      policyId: "incomeTax",
      direction: -1,
    });
    expect(c.taxes.income).toBeLessThan(before);
  });

  it("budgets track revenue, spending and debt", () => {
    const game = democracy();
    const c = game.state.world.countries.AAA!;
    c.taxes.income = 0;
    c.taxes.corporate = 0;
    c.taxes.sales = 0;
    runBudget(c);
    expect(c.budget!.debtCents).toBeGreaterThan(0);
    expect(c.budget!.spendingCents).toBeGreaterThan(c.budget!.revenueCents);
  });

  it("the world keeps working for a year with politics running", () => {
    const game = democracy();
    tickSafely(game, 24 * 365);
    expect(game.state.politics.laws.length + game.state.politics.bills.length).toBeGreaterThan(0);
    const total = game.state.world.countries.AAA!.parties.reduce((s, p) => s + p.popularity, 0);
    expect(total).toBeCloseTo(1, 2);
  });
});
