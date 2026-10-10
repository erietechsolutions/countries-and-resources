import { describe, expect, it } from "vitest";
import {
  arrest,
  commitCrime,
  createNewGame,
  detectionChance,
  ensurePolitics,
  exposeScandal,
  officesFor,
  playerOffices,
  recordPenalty,
  type Command,
  type Game,
} from "../src";
import { economicConfig, testCharacter, tinyGeography } from "./fixtures";

const geo = tinyGeography();

function setup(): Game {
  const game = createNewGame({ config: economicConfig(), character: testCharacter }, geo);
  game.state.player.cashCents = 100_000_000;
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

describe("crime and law", () => {
  it("getting caught is more likely with more police attention", () => {
    const game = setup();
    const calm = detectionChance(game, 0.15);
    game.state.player.legal.heat = 80;
    expect(detectionChance(game, 0.15)).toBeGreaterThan(calm);
  });

  it("uncaught serious crimes become secrets, and build underworld reputation", () => {
    const game = setup();
    let secrets = 0;
    for (let i = 0; i < 40; i++) {
      game.state.player.legal.heat = 0;
      game.state.player.legal.pendingCase = null;
      game.state.player.activity = null;
      if (!commitCrime(game, "burglary", 0.0001)) secrets++;
    }
    expect(game.state.player.legal.secrets.length).toBeGreaterThan(0);
    expect(game.state.player.reputation.underworld).toBeGreaterThan(10);
    expect(secrets).toBeGreaterThan(30);
  });

  it("an arrest leads to custody and a decision; pleading guilty gives a conviction", () => {
    const game = setup();
    arrest(game, "shoplifting");
    expect(game.state.player.activity?.id).toBe("custody");
    expect(game.dispatch({ type: "activity.cancel" }).ok).toBe(false);
    run(game, { type: "legal.resolve", choice: "plead" });
    expect(game.state.player.legal.record).toHaveLength(1);
    expect(recordPenalty(game)).toBeLessThan(1);
  });

  it("serious repeat offenders go to prison, and are released when their time is served", () => {
    const game = setup();
    game.state.player.legal.record.push(
      { crime: "burglary", time: 0, sentence: "x" },
      { crime: "burglary", time: 0, sentence: "x" },
    );
    arrest(game, "burglary");
    run(game, { type: "legal.resolve", choice: "plead" });
    expect(game.state.player.legal.prisonUntil).not.toBeNull();
    expect(game.state.player.activity?.id).toBe("prison");
    const days = (game.state.player.legal.prisonUntil! - game.time) / 24;
    tickSafely(game, (days + 2) * 24);
    expect(game.state.player.legal.prisonUntil).toBeNull();
    expect(game.state.player.legal.probationUntil).not.toBeNull();
  });

  it("an undecided case goes to trial on its own", () => {
    const game = setup();
    arrest(game, "pickpocketing");
    tickSafely(game, 72);
    expect(game.state.player.legal.pendingCase).toBeNull();
  });

  it("gangs need underworld credibility", () => {
    const game = setup();
    expect(game.dispatch({ type: "crime.joinGang" }).ok).toBe(false);
    game.state.player.reputation.underworld = 20;
    run(game, { type: "crime.joinGang" });
    expect(game.state.player.legal.gangRank).toBe(1);
  });

  it("officials can embezzle, and scandals can cost them office", () => {
    const game = setup();
    ensurePolitics(game);
    const council = officesFor(game, game.state.player.cityId).find((o) => o.kind === "councilor")!;
    council.holders[0] = "player";
    expect(game.dispatch({ type: "crime.embezzle", amountCents: 1 }).ok).toBe(true);
    expect(game.dispatch({ type: "crime.embezzle", amountCents: 1 }).ok).toBe(false); // must lie low
    game.state.player.politics.approval = 10;
    game.state.world.countries.AAA!.ruleOfLaw = 0;
    for (let i = 0; i < 20 && playerOffices(game).length > 0; i++) {
      game.state.player.legal.pendingCase = null;
      exposeScandal(game, { crime: "embezzlement", time: game.time, severity: 4 });
    }
    expect(playerOffices(game)).toHaveLength(0);
  });
});
