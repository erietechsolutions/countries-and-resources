import { describe, expect, it } from "vitest";
import {
  advanceCountryEconomy,
  createNewGame,
  Game,
  generateWorld,
  loanOffers,
  OCCUPATIONS,
  parseSave,
  Rng,
  lifestyleDailyCost,
  SAVE_VERSION,
  startOfDay,
  toDateParts,
  type Command,
  type GameConfig,
  type Lifestyle,
} from "../src";
import { economicConfig, testCharacter, tinyGeography } from "./fixtures";

const geo = tinyGeography();

function newGame(overrides: Partial<GameConfig> = {}): Game {
  return createNewGame({ config: economicConfig(overrides), character: testCharacter }, geo);
}

function run(game: Game, command: Command) {
  const result = game.dispatch(command);
  if (!result.ok) throw new Error(`${command.type} refused: ${result.reason}`);
}

/** Moves the clock to the next time the given hour of day comes around. */
function skipTo(game: Game, hour: number) {
  while (toDateParts(game.time).hour !== hour) game.tick();
}

describe("living standards", () => {
  it("there is nothing to eat, sleep or wash: food and energy stay topped up", () => {
    const game = newGame();
    game.tick(48);
    const n = game.state.player.needs;
    expect(n.food).toBe(80);
    expect(n.energy).toBe(80);
    expect(game.dispatch({ type: "activity.start", activityId: "eat" }).ok).toBe(false);
  });

  it("living costs are paid daily, and better lifestyles cost more", () => {
    const daily = (lifestyle: Lifestyle) => {
      const game = newGame();
      run(game, { type: "lifestyle.set", lifestyle });
      return lifestyleDailyCost(game, lifestyle);
    };
    expect(daily("frugal")).toBeLessThan(daily("modest"));
    expect(daily("luxury")).toBeGreaterThan(daily("comfortable") * 2);
    const game = newGame();
    const before = game.state.player.cashCents;
    skipTo(game, 1);
    expect(game.state.player.cashCents).toBe(before - lifestyleDailyCost(game, "modest"));
  });

  it("running out of money means living cheaper, then going without", () => {
    const game = newGame();
    const p = game.state.player;
    run(game, { type: "lifestyle.set", lifestyle: "luxury" });
    p.cashCents = lifestyleDailyCost(game, "modest") + 1;
    skipTo(game, 1);
    expect(p.lifestyle).toBe("modest");
    p.cashCents = 0;
    game.tick(24);
    expect(p.daily.wentWithout).toBe(true);
  });

  it("health follows living conditions: the street wears you down", () => {
    const home = newGame();
    const street = newGame({ startingHousing: "homeless", startingCashCents: 0 });
    for (const g of [home, street]) {
      g.state.player.cashCents = 10_000_000;
      g.state.player.needs.health = 80;
      g.tick(24 * 10);
    }
    expect(home.state.player.needs.health).toBeGreaterThan(street.state.player.needs.health + 5);
    expect(home.state.player.needs.hygiene).toBeGreaterThan(street.state.player.needs.hygiene);
  });

  it("nights pass on their own", () => {
    const game = newGame();
    skipTo(game, 23);
    game.tick(1);
    expect(game.state.player.activity?.id).toBe("night");
    skipTo(game, 8);
    expect(game.state.player.activity).toBeNull();
  });

  it("failing health leads to the hospital and a bill where healthcare isn't free", () => {
    const game = newGame();
    game.state.world.countries.AAA!.healthcare = "none";
    const p = game.state.player;
    p.needs.health = 0;
    game.tick(1);
    expect(p.activity?.id).toBe("hospital");
    game.tick(72);
    expect(p.activity).toBeNull();
    expect(p.needs.health).toBeGreaterThanOrEqual(45);
    expect(p.finance.debts.some((d) => d.kind === "medical")).toBe(true);
  });
});

describe("activities", () => {
  it("respect opening hours", () => {
    const game = newGame({ startingHousing: "homeless", startingCashCents: 0 });
    skipTo(game, 9);
    expect(game.dispatch({ type: "activity.start", activityId: "shelter" }).ok).toBe(false);
    skipTo(game, 18);
    run(game, { type: "activity.start", activityId: "shelter" });
    expect(game.state.player.activity?.id).toBe("shelter");
  });
});

/** Gives the player a ready job offer for an entry-level job and accepts it. */
function hire(game: Game, occupationId = "warehouse") {
  const company = game.state.world.companies[0]!;
  game.state.player.jobOffers.push({
    id: "test-offer",
    companyId: company.id,
    occupationId,
    wageCents: 1500,
    expiresAt: game.time + 72,
  });
  run(game, { type: "job.accept", offerId: "test-offer" });
}

describe("jobs", () => {
  it("every city has employers, and job searches produce offers", () => {
    const game = newGame();
    expect(game.state.world.companies.length).toBeGreaterThanOrEqual(10);
    const p = game.state.player;
    p.inventory.items.push("phone", "interviewClothes");
    let offers = 0;
    for (let day = 0; day < 10 && offers === 0; day++) {
      skipTo(game, 9);
      p.needs = { food: 90, energy: 90, hygiene: 90, health: 100, happiness: 80 };
      run(game, { type: "activity.start", activityId: "jobSearch" });
      game.tick(3);
      offers = p.jobOffers.length;
    }
    expect(offers).toBeGreaterThan(0);
  });

  it("shifts start automatically and pay out on Friday", () => {
    const game = newGame();
    hire(game);
    const p = game.state.player;
    const startCash = p.cashCents;
    // Keep the character fed and rested so nothing interrupts work.
    for (let h = 0; h < 24 * 8; h++) {
      p.needs.food = Math.max(p.needs.food, 60);
      p.needs.energy = Math.max(p.needs.energy, 60);
      game.tick();
    }
    expect(p.cashCents).toBeGreaterThan(startCash);
    expect(p.finance.ledger.some((t) => t.category === "wages")).toBe(true);
    expect(p.skills.labor).toBeGreaterThan(0);
  });

  it("missing shifts gets you fired", () => {
    const game = newGame();
    hire(game);
    run(game, { type: "job.setAutoWork", enabled: false });
    const p = game.state.player;
    for (let h = 0; h < 24 * 10 && p.job; h++) {
      p.needs.food = 80;
      p.needs.energy = 80;
      game.tick();
    }
    expect(p.job).toBeNull();
  });

  it("entry-level jobs exist for people with no credentials", () => {
    expect(
      OCCUPATIONS.filter((o) => o.tier === 0 && o.credentials.length === 0 && !o.needsAddress)
        .length,
    ).toBeGreaterThan(3);
  });
});

describe("housing and family", () => {
  it("renting needs income or a co-signer, then charges rent monthly", () => {
    const game = newGame({ startingHousing: "homeless", startingCashCents: 0 });
    const p = game.state.player;
    p.cashCents = 1_000_000_00;
    expect(game.dispatch({ type: "housing.rent", unit: "room" }).ok).toBe(false);
    hire(game);
    p.job!.wageCents = 100_000;
    expect(game.dispatch({ type: "housing.rent", unit: "room" }).ok).toBe(false); // too new at the job
    p.job!.startedAt -= 31 * 24;
    run(game, { type: "housing.rent", unit: "room" });
    expect(p.housing.kind).toBe("renting");
    const rent = p.housing.kind === "renting" ? p.housing.rentCents : 0;
    const before = p.cashCents;
    while (toDateParts(game.time).day !== 1 || toDateParts(game.time).hour !== 1) game.tick();
    expect(
      p.finance.ledger.some(
        (t) => t.category === "rent" && t.amountCents === -rent && t.time > game.time - 2,
      ),
    ).toBe(true);
    expect(p.cashCents).toBeLessThan(before + 100_000_000);
  });

  it("unpaid rent leads to eviction", () => {
    const game = newGame();
    const p = game.state.player;
    p.housing = {
      kind: "renting",
      unit: "studio",
      rentCents: 50_000,
      since: game.time,
      missedPayments: 0,
    };
    p.cashCents = 0;
    game.tick(24 * 70);
    expect(p.housing.kind).toBe("homeless");
  });

  it("idle adults living at home eventually get kicked out", () => {
    const game = newGame();
    for (const m of game.state.family) m.relationship = 20;
    const p = game.state.player;
    for (let h = 0; h < 24 * 60 && p.housing.kind === "parents"; h++) {
      p.needs.food = 80;
      p.needs.energy = 80;
      game.tick();
    }
    expect(p.housing.kind).toBe("homeless");
  });

  it("homeless players start estranged from their family", () => {
    const game = newGame({ startingHousing: "homeless", startingCashCents: 0 });
    expect(game.state.family.length).toBeGreaterThan(0);
    for (const m of game.state.family) expect(m.relationship).toBeLessThan(30);
    expect(game.dispatch({ type: "housing.moveBackHome" }).ok).toBe(false);
  });
});

describe("money", () => {
  it("payday loans need a job and roll over into collections when unpaid", () => {
    const game = newGame({ startingCashCents: 0 });
    expect(loanOffers(game)[0]!.available).toBe(false);
    hire(game);
    const offer = loanOffers(game)[0]!;
    expect(offer.available).toBe(true);
    run(game, { type: "loan.take", kind: "payday", amountCents: 10_000 });
    run(game, { type: "job.quit" });
    game.state.player.cashCents = 0;
    for (let h = 0; h < 24 * 50; h++) {
      game.state.player.cashCents = 0;
      game.state.player.needs.food = 80;
      game.state.player.needs.energy = 80;
      game.tick();
    }
    const debts = game.state.player.finance.debts;
    expect(debts.some((d) => d.kind === "collections")).toBe(true);
    expect(game.state.player.finance.creditScore!).toBeLessThan(620);
  });

  it("shop purchases and course enrollment cost money", () => {
    const game = newGame();
    const p = game.state.player;
    p.cashCents = 10_000_000;
    run(game, { type: "shop.buy", item: "phone" });
    expect(p.inventory.items).toContain("phone");
    expect(game.dispatch({ type: "shop.buy", item: "phone" }).ok).toBe(false);
    run(game, { type: "education.enroll", course: "foodHandler" });
    run(game, { type: "activity.start", activityId: "study" });
    game.tick(3);
    run(game, { type: "activity.start", activityId: "study" });
    game.tick(3);
    expect(p.credentials).toContain("foodHandler");
    expect(p.education).toBeNull();
  });
});

describe("economy", () => {
  it("cycles through recessions and recoveries with sane numbers over 40 years", () => {
    const world = generateWorld(geo, 7);
    const country = world.countries.AAA!;
    const rng = new Rng(1);
    const phases = new Set<string>();
    for (let m = 0; m < 480; m++) {
      advanceCountryEconomy(country, rng);
      phases.add(country.economy.phase);
      expect(Number.isFinite(country.economy.priceIndex)).toBe(true);
      expect(country.unemployment).toBeGreaterThan(0);
      expect(country.unemployment).toBeLessThan(0.5);
    }
    expect(phases).toEqual(new Set(["expansion", "recession", "recovery"]));
    expect(country.economy.priceIndex).toBeGreaterThan(1);
  });

  it("monthly updates move city prices and keep the game deterministic", () => {
    const a = newGame();
    const b = newGame();
    const rent0 = a.state.world.cities[0]!.rentCents;
    a.tick(24 * 100);
    b.tick(24 * 100);
    expect(a.state).toEqual(b.state);
    expect(a.state.world.cities[0]!.rentCents).not.toBe(rent0);
  });
});

describe("save migration", () => {
  it("upgrades a Phase 1 (version 1) save", () => {
    const game = newGame({ startingHousing: "homeless", startingCashCents: 0 });
    const s = JSON.parse(JSON.stringify(game.state));
    // Shape of a version 1 save.
    const v1 = {
      config: s.config,
      time: s.time,
      rngState: s.rngState,
      world: {
        geographyId: s.world.geographyId,
        provinces: s.world.provinces,
        cities: s.world.cities,
        countries: Object.fromEntries(
          Object.entries(s.world.countries).map(([id, c]) => {
            const {
              economy: _e,
              pops: _p,
              healthcare: _h,
              socialServices: _s,
              ...rest
            } = c as Record<string, unknown>;
            return [id, rest];
          }),
        ),
      },
      player: {
        id: "player",
        firstName: "Old",
        lastName: "Save",
        gender: "female",
        appearance: s.player.appearance,
        birthTime: s.player.birthTime,
        cashCents: 0,
        housing: "homeless",
        cityId: 0,
        citizenship: ["AAA"],
        health: 85,
      },
      log: [],
    };
    const file = {
      format: "countries-and-resources-save",
      version: 1,
      savedAt: "2026-10-03T00:00:00Z",
      summary: {},
      state: v1,
    };
    const upgraded = parseSave(JSON.stringify(file));
    expect(upgraded.version).toBe(SAVE_VERSION);
    const loaded = new Game(upgraded.state, geo);
    expect(loaded.state.player.housing).toEqual({ kind: "homeless" });
    expect(loaded.state.player.needs.health).toBe(85);
    expect(loaded.state.world.countries.AAA!.economy.priceIndex).toBe(1);
    expect(loaded.state.world.companies.length).toBeGreaterThan(0);
    expect(loaded.state.family.length).toBeGreaterThan(0);
    loaded.tick(48);
    expect(startOfDay(loaded.time)).toBeGreaterThan(0);
  });
});

describe("warnings", () => {
  it("warn once when health falls into the danger zone", () => {
    // Sleeping rough with no money for even the basics.
    const game = newGame({ startingHousing: "homeless", startingCashCents: 0 });
    const alerts: string[] = [];
    game.events.on("alert", (e) => alerts.push(e.message));
    game.state.player.needs.health = 20.5;
    game.tick(48);
    expect(alerts.filter((a) => a.includes("health is failing"))).toHaveLength(1);
  });
});

describe("map updates", () => {
  it("fills in cities added to the map after a save was made", () => {
    const game = newGame();
    const state = JSON.parse(JSON.stringify(game.state));
    state.world.cities = state.world.cities.slice(0, 2); // pretend city 2 didn't exist yet
    const loaded = new Game(state, geo);
    expect(loaded.state.world.cities).toHaveLength(geo.cities.length);
    expect(loaded.state.world.cities[2]!.rentCents).toBeGreaterThan(0);
  });
});

describe("save format v2", () => {
  it("loads a Phase 2 save into the current game", () => {
    const game = newGame();
    const s = JSON.parse(JSON.stringify(game.state));
    for (const key of [
      "people",
      "nextPersonId",
      "businesses",
      "nextBusinessId",
      "politics",
      "story",
      "rivals",
    ])
      delete s[key];
    for (const key of [
      "relationships",
      "reputation",
      "pregnancy",
      "residency",
      "visas",
      "visaApplication",
      "politics",
      "legal",
    ])
      delete s.player[key];
    const file = {
      format: "countries-and-resources-save",
      version: 2,
      savedAt: "2026-10-03T00:00:00Z",
      summary: {},
      state: s,
    };
    const loaded = new Game(parseSave(JSON.stringify(file)).state, geo);
    expect(loaded.state.player.legal.record).toEqual([]);
    expect(loaded.state.politics.offices.length).toBeGreaterThan(0);
    loaded.tick(24 * 40);
  });
});
