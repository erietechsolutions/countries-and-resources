import { describe, expect, it } from "vitest";
import {
  createNewGame,
  Game,
  meetPerson,
  relationshipWith,
  toDateParts,
  type Command,
  type GameConfig,
} from "../src";
import { economicConfig, testCharacter, tinyGeography } from "./fixtures";

const geo = tinyGeography();
const newGame = (o: Partial<GameConfig> = {}) =>
  createNewGame({ config: economicConfig(o), character: testCharacter }, geo);

function run(game: Game, command: Command) {
  const result = game.dispatch(command);
  if (!result.ok) throw new Error(`${command.type} refused: ${result.reason}`);
}

function skipTo(game: Game, hour: number) {
  while (toDateParts(game.time).hour !== hour) game.tick();
}

/** Keeps the character fed and rested so long simulations test the social system only. */
function tickSafely(game: Game, hours: number) {
  for (let h = 0; h < hours; h++) {
    const n = game.state.player.needs;
    n.food = Math.max(n.food, 60);
    n.energy = Math.max(n.energy, 60);
    n.hygiene = Math.max(n.hygiene, 60);
    game.tick();
  }
}

describe("relationships", () => {
  it("meeting people creates acquaintances, and hanging out builds friendship", () => {
    const game = newGame();
    const person = meetPerson(game, "test");
    const r = relationshipWith(game.state.player, person.id)!;
    expect(r.kind).toBe("acquaintance");
    r.affection = 45;
    for (let day = 0; day < 3; day++) {
      skipTo(game, 12);
      run(game, { type: "activity.start", activityId: "hangOut", targetId: person.id });
      tickSafely(game, 2);
    }
    expect(r.kind).toBe("friend");
  });

  it("targeted activities need a valid person", () => {
    const game = newGame();
    skipTo(game, 12);
    expect(game.dispatch({ type: "activity.start", activityId: "hangOut" }).ok).toBe(false);
    expect(
      game.dispatch({ type: "activity.start", activityId: "hangOut", targetId: "nobody" }).ok,
    ).toBe(false);
  });

  it("goes from dating to marriage to a baby", () => {
    const game = newGame();
    game.state.player.cashCents = 100_000_000;
    const person = meetPerson(game, "test");
    const r = relationshipWith(game.state.player, person.id)!;
    r.affection = 90;
    r.romance = 100;
    run(game, { type: "social.action", personId: person.id, action: "askOut" });
    expect(r.kind).toBe("dating");
    expect(
      game.dispatch({ type: "social.action", personId: person.id, action: "propose" }).ok,
    ).toBe(false);
    r.metAt -= 90 * 24;
    for (let i = 0; i < 10 && r.kind === "dating"; i++) {
      r.affection = 100;
      r.romance = 100;
      run(game, { type: "social.action", personId: person.id, action: "propose" });
    }
    expect(r.kind).toBe("engaged");
    run(game, { type: "social.action", personId: person.id, action: "marry" });
    expect(r.kind).toBe("spouse");
    for (let i = 0; i < 30 && !game.state.player.pregnancy; i++) {
      run(game, { type: "social.action", personId: person.id, action: "tryForBaby" });
    }
    expect(game.state.player.pregnancy).not.toBeNull();
    tickSafely(game, 24 * 275);
    expect(game.state.player.relationships.some((x) => x.kind === "child")).toBe(true);
    expect(game.state.player.pregnancy).toBeNull();
  });

  it("neglected partners eventually leave", () => {
    const game = newGame();
    const person = meetPerson(game, "test");
    const r = relationshipWith(game.state.player, person.id)!;
    r.kind = "dating";
    r.affection = 30;
    tickSafely(game, 24 * 40);
    expect(r.kind).toBe("ex");
  });

  it("volunteering builds community reputation", () => {
    const game = newGame();
    skipTo(game, 10);
    run(game, { type: "activity.start", activityId: "volunteer" });
    tickSafely(game, 3);
    expect(game.state.player.reputation.community).toBeGreaterThan(0);
  });

  it("older saves without social data still load", () => {
    const game = newGame();
    const state = JSON.parse(JSON.stringify(game.state));
    delete state.people;
    delete state.nextPersonId;
    delete state.player.relationships;
    delete state.player.reputation;
    delete state.player.pregnancy;
    const loaded = new Game(state, geo);
    expect(loaded.state.people).toEqual([]);
    expect(loaded.state.player.reputation.community).toBe(0);
    loaded.tick(48);
  });
});
