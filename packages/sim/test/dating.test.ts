import { describe, expect, it } from "vitest";
import {
  createNewGame,
  electionFor,
  filingBlocker,
  FILING_SUPPORT,
  homeLocalities,
  localSupport,
  matchChance,
  officesFor,
  playerParty,
  RALLY_SUPPORT,
  scheduleElections,
  type Command,
  type Game,
} from "../src";
import { economicConfig, testCharacter, tinyGeography } from "./fixtures";

const geo = tinyGeography();
const DAY = 24;

function setup(): Game {
  const game = createNewGame({ config: economicConfig(), character: testCharacter }, geo);
  game.state.player.cashCents = 1_000_000_000;
  // New parties can only compete in a democracy.
  game.state.world.countries.AAA!.government = "democracy";
  return game;
}

function run(game: Game, command: Command) {
  const result = game.dispatch(command);
  if (!result.ok) throw new Error(`${command.type} refused: ${result.reason}`);
}

describe("the dating app", () => {
  it("needs a phone, then shows profiles of the chosen gender every day", () => {
    const game = setup();
    expect(game.dispatch({ type: "dating.join", seeking: "women" }).ok).toBe(false);
    run(game, { type: "shop.buy", item: "phone" });
    run(game, { type: "dating.join", seeking: "women" });
    const d = game.state.dating;
    expect(d.profiles.length).toBe(5);
    expect(d.profiles.every((x) => x.gender === "female")).toBe(true);
    run(game, { type: "dating.swipe", profileId: d.profiles[0]!.id, like: false });
    expect(d.profiles.length).toBe(4);
    game.tick(DAY);
    expect(d.profiles.length).toBe(5);
  });

  it("a match becomes someone you can ask on a date", () => {
    const game = setup();
    run(game, { type: "shop.buy", item: "phone" });
    run(game, { type: "dating.join", seeking: "men" });
    run(game, { type: "dating.premium" });
    game.tick(DAY);
    expect(game.state.dating.profiles.length).toBe(12);
    // Keep liking until someone likes you back.
    for (let i = 0; i < 20 && game.state.dating.matches === 0; i++) {
      for (const prof of [...game.state.dating.profiles])
        run(game, { type: "dating.swipe", profileId: prof.id, like: true });
      game.tick(DAY);
    }
    expect(game.state.dating.matches).toBeGreaterThan(0);
    const rel = game.state.player.relationships.find((r) => r.context.includes("Spark"))!;
    expect(rel.romance).toBeGreaterThanOrEqual(35);
    const person = game.state.people.find((x) => x.id === rel.personId)!;
    expect(person.gender).toBe("male");
  });

  it("looking after yourself makes matching more likely", () => {
    const game = setup();
    run(game, { type: "shop.buy", item: "phone" });
    run(game, { type: "dating.join", seeking: "everyone" });
    const profile = game.state.dating.profiles[0]!;
    game.state.player.lifestyle = "frugal";
    game.state.player.needs.hygiene = 30;
    const low = matchChance(game, profile);
    game.state.player.lifestyle = "luxury";
    game.state.player.needs.hygiene = 100;
    expect(matchChance(game, profile)).toBeGreaterThan(low);
  });
});

describe("growing a party", () => {
  it("a new party starts tiny, and can't hold rallies or run for local office yet", () => {
    const game = setup();
    run(game, { type: "politics.found", name: "Forward Together", preset: "centrist" });
    const party = playerParty(game)!;
    expect(localSupport(game, homeLocalities(game).city, party)).toBeLessThan(RALLY_SUPPORT);
    expect(game.dispatch({ type: "activity.start", activityId: "partyRally" }).ok).toBe(false);
    const council = officesFor(game, game.state.player.cityId).find((o) => o.kind === "councilor")!;
    council.nextElection = game.time + 60 * DAY;
    scheduleElections(game);
    const election = electionFor(game, council)!;
    expect(filingBlocker(game, election)).toMatch(/8%/);
  });

  it("volunteering, ads and rallies build local support, enough to run", () => {
    const game = setup();
    run(game, { type: "politics.found", name: "Forward Together", preset: "centrist" });
    const party = playerParty(game)!;
    const city = homeLocalities(game).city;
    const start = localSupport(game, city, party);
    run(game, { type: "party.promote", amountCents: 5_000_000 });
    expect(localSupport(game, city, party)).toBeGreaterThan(start);
    // Months of daily door-knocking.
    for (let day = 0; day < 150 && localSupport(game, city, party) < FILING_SUPPORT; day++) {
      while (new Date(game.time * 3_600_000).getUTCHours() !== 10) game.tick();
      game.dispatch({ type: "activity.start", activityId: "partyWork" });
      game.tick(4);
      if (localSupport(game, city, party) >= RALLY_SUPPORT) {
        while (new Date(game.time * 3_600_000).getUTCHours() !== 14) game.tick();
        game.dispatch({ type: "activity.start", activityId: "partyRally" });
      }
      game.dispatch({ type: "party.promote", amountCents: 5_000_000 });
      game.tick(6);
    }
    expect(localSupport(game, city, party)).toBeGreaterThanOrEqual(FILING_SUPPORT);
  });
});
