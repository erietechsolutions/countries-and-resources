import { useSyncExternalStore } from "react";
import type { Command, CommandResult, Game } from "@cr/sim";

export type Speed = 0 | 1 | 2 | 5;
export const SPEEDS: Speed[] = [1, 2, 5];

/** In-game hours that pass per real second at each speed. 1x ≈ 12 seconds per day. */
const HOURS_PER_SECOND: Record<Speed, number> = { 0: 0, 1: 2, 2: 4, 5: 10 };
/** Stops a long pause in rendering (e.g. a background tab) from fast-forwarding days at once. */
const MAX_TICKS_PER_FRAME = 24;

/**
 * Drives a Game in real time. The simulation itself has no notion of real time; this class
 * decides how many ticks to run per animation frame and tells React when something changed.
 */
export class GameRunner {
  private speedValue: Speed = 0;
  private lastSpeed: Speed = 1;
  private frame = 0;
  private lastTimestamp = 0;
  private carry = 0;
  private version = 0;
  private listeners = new Set<() => void>();

  constructor(readonly game: Game) {}

  get speed(): Speed {
    return this.speedValue;
  }

  start(): void {
    if (this.frame) return;
    this.lastTimestamp = performance.now();
    this.frame = requestAnimationFrame(this.loop);
  }

  stop(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  setSpeed(speed: Speed): void {
    if (speed !== 0) this.lastSpeed = speed;
    this.speedValue = speed;
    this.carry = 0;
    this.notify();
  }

  togglePause(): void {
    this.setSpeed(this.speedValue === 0 ? this.lastSpeed : 0);
  }

  dispatch(command: Command): CommandResult {
    const result = this.game.dispatch(command);
    this.notify();
    return result;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;

  notify(): void {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  private loop = (timestamp: number) => {
    const elapsed = Math.min(timestamp - this.lastTimestamp, 1000);
    this.lastTimestamp = timestamp;
    if (this.speedValue > 0) {
      this.carry += (elapsed / 1000) * HOURS_PER_SECOND[this.speedValue];
      const ticks = Math.min(Math.floor(this.carry), MAX_TICKS_PER_FRAME);
      if (ticks > 0) {
        this.carry -= ticks;
        if (this.carry > MAX_TICKS_PER_FRAME) this.carry = 0;
        this.game.tick(ticks);
        this.notify();
      }
    }
    this.frame = requestAnimationFrame(this.loop);
  };
}

/** Re-renders the calling component whenever the game state changes. */
export function useRunnerVersion(runner: GameRunner): number {
  return useSyncExternalStore(runner.subscribe, runner.getVersion);
}
