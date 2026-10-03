import type { WorldGeography } from "../world/geography";
import { toDateParts } from "./calendar";
import { commandHandlers, type Command, type CommandHandler, type CommandResult } from "./commands";
import { EventBus, type LogCategory } from "./events";
import { Rng } from "./rng";
import { MAX_LOG_ENTRIES, type GameState } from "./state";
import { defaultSystems, type System } from "./systems";

/** What systems and command handlers get to work with. */
export interface GameContext {
  readonly state: GameState;
  readonly geography: WorldGeography;
  readonly rng: Rng;
  log(category: LogCategory, message: string): void;
}

/**
 * Runs one game: advances time tick by tick, applies commands, and announces what happens
 * through `events`. It knows nothing about rendering or real time; the UI (or a server)
 * decides how fast to call `tick()`.
 */
export class Game implements GameContext {
  readonly events = new EventBus();
  readonly rng: Rng;

  constructor(
    readonly state: GameState,
    readonly geography: WorldGeography,
    private readonly systems: readonly System[] = defaultSystems,
  ) {
    if (state.world.geographyId !== geography.id) {
      throw new Error(
        `Save uses map "${state.world.geographyId}" but "${geography.id}" was provided.`,
      );
    }
    this.rng = new Rng(state.rngState);
  }

  get time() {
    return this.state.time;
  }

  /** Advances the game by one hour per tick. */
  tick(hours = 1): void {
    for (let i = 0; i < hours; i++) this.step();
    this.state.rngState = this.rng.state;
  }

  dispatch(command: Command): CommandResult {
    const handler = commandHandlers[command.type] as CommandHandler<typeof command.type>;
    const reason = handler ? handler.validate(this, command) : `Unknown command "${command.type}".`;
    if (reason) {
      this.events.emit({ type: "commandRejected", command, reason });
      return { ok: false, reason };
    }
    handler.apply(this, command);
    this.state.rngState = this.rng.state;
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
