import type { WorldGeography } from "../world/geography";
import { ensurePolitics } from "../politics/government";
import { ensureCompanies } from "../work/companies";
import { normalizeState } from "./normalize";
import { initCountryEconomy } from "../worldgen/economyInit";
import { generateMissingCities } from "../worldgen/proceduralWorld";
import { liveGeography } from "../world/territory";
import { toDateParts } from "./calendar";
import { commandHandlers, type Command, type CommandHandler, type CommandResult } from "./commands";
import { EventBus, type AlertLevel, type LogCategory } from "./events";
import { Rng } from "./rng";
import { MAX_LOG_ENTRIES, type GameState } from "./state";
import { defaultSystems, type System } from "./systems";

/** What systems and command handlers get to work with. */
export interface GameContext {
  readonly state: GameState;
  readonly geography: WorldGeography;
  readonly rng: Rng;
  readonly events: EventBus;
  log(category: LogCategory, message: string): void;
  /** Logs a message and raises it as a notification. */
  alert(level: AlertLevel, message: string, category?: LogCategory): void;
}

/**
 * Runs one game: advances time tick by tick, applies commands, and announces what happens
 * through `events`. It knows nothing about rendering or real time; the UI (or a server)
 * decides how fast to call `tick()`.
 */
export class Game implements GameContext {
  readonly events = new EventBus();
  readonly rng: Rng;
  /** This game's own copy of the map, with borders as they stand in this game. */
  readonly geography: WorldGeography;

  constructor(
    readonly state: GameState,
    geography: WorldGeography,
    private readonly systems: readonly System[] = defaultSystems,
  ) {
    if (state.world.geographyId !== geography.id) {
      throw new Error(
        `Save uses map "${state.world.geographyId}" but "${geography.id}" was provided.`,
      );
    }
    this.geography = liveGeography(geography, state.world);
    this.rng = new Rng(state.rngState);
    normalizeState(state);
    upgradeWorld(this);
    // Employers are generated the first time the player lives in a city.
    ensureCompanies(this, state.player.cityId);
    ensurePolitics(this);
    this.state.rngState = this.rng.state;
  }

  get time() {
    return this.state.time;
  }

  /** Advances the game by one hour per tick. Time stops while the player is dead. */
  tick(hours = 1): void {
    for (let i = 0; i < hours && this.state.player.alive; i++) this.step();
    this.state.rngState = this.rng.state;
  }

  dispatch(command: Command): CommandResult {
    const handler = commandHandlers[command.type] as
      CommandHandler<typeof command.type> | undefined;
    const reason = handler ? handler(this, command) : `Unknown command "${command.type}".`;
    this.state.rngState = this.rng.state;
    if (reason) {
      this.events.emit({ type: "commandRejected", command, reason });
      return { ok: false, reason };
    }
    this.events.emit({ type: "commandApplied", command });
    return { ok: true };
  }

  log(category: LogCategory, message: string): void {
    const entry = { time: this.state.time, category, message };
    this.state.log.push(entry);
    if (this.state.log.length > MAX_LOG_ENTRIES) {
      this.state.log.splice(0, this.state.log.length - MAX_LOG_ENTRIES);
    }
    this.events.emit({ type: "log", entry });
  }

  alert(level: AlertLevel, message: string, category: LogCategory = "life"): void {
    this.log(category, message);
    this.events.emit({ type: "alert", level, message });
  }

  private step(): void {
    this.state.time += 1;
    const time = this.state.time;
    const date = toDateParts(time);

    for (const s of this.systems) s.onHour?.(this);
    this.events.emit({ type: "hour", time });
    if (date.hour !== 0) return;

    for (const s of this.systems) s.onDay?.(this, date);
    this.events.emit({ type: "day", time });
    if (date.day !== 1) return;

    for (const s of this.systems) s.onMonth?.(this, date);
    this.events.emit({ type: "month", time });
    if (date.month !== 1) return;

    for (const s of this.systems) s.onYear?.(this, date);
    this.events.emit({ type: "year", time });
  }
}

/** Fills in world data that older saves lack and that needs the map to compute. */
function upgradeWorld(game: Game): void {
  generateMissingCities(game.geography, game.state.world, game.state.config.worldSeed);
  for (const geoCountry of game.geography.countries) {
    const country = game.state.world.countries[geoCountry.id];
    if (!country || country.economy) continue;
    const provinces = geoCountry.provinceIds.map((id) => game.state.world.provinces[id]!);
    initCountryEconomy(
      country,
      provinces,
      Rng.fromKey(game.state.config.worldSeed, `economy:${geoCountry.id}`),
    );
  }
}
