import type { GameTime } from "./calendar";
import type { Command } from "./commands";

export type LogCategory = "system" | "life" | "work" | "money" | "economy" | "politics";
export type AlertLevel = "good" | "bad" | "info";

export interface LogEntry {
  time: GameTime;
  category: LogCategory;
  message: string;
}

/** Everything the simulation announces to the outside world (UI, autosave, network). */
export type SimEvent =
  | { type: "hour"; time: GameTime }
  | { type: "day"; time: GameTime }
  | { type: "month"; time: GameTime }
  | { type: "year"; time: GameTime }
  | { type: "log"; entry: LogEntry }
  /** Something the player should notice right away (shown as a notification). */
  | { type: "alert"; level: AlertLevel; message: string }
  /** The player's current activity ended (finished, cancelled or interrupted). */
  | { type: "activityEnded"; activityId: string; reason: "finished" | "cancelled" | "interrupted" }
  /** A story event needs the player's decision. */
  | { type: "storyEvent"; eventId: string }
  | { type: "playerDied" }
  | { type: "reignEnded" }
  | { type: "commandApplied"; command: Command }
  | { type: "commandRejected"; command: Command; reason: string };

export type SimEventType = SimEvent["type"];
export type SimEventOf<T extends SimEventType> = Extract<SimEvent, { type: T }>;

type Handler = (event: SimEvent) => void;

export class EventBus {
  private handlers = new Map<SimEventType | "*", Set<Handler>>();

  /** Subscribes to one event type. Returns an unsubscribe function. */
  on<T extends SimEventType>(type: T, handler: (event: SimEventOf<T>) => void): () => void {
    return this.add(type, handler as Handler);
  }

  /** Subscribes to every event. Returns an unsubscribe function. */
  onAny(handler: (event: SimEvent) => void): () => void {
    return this.add("*", handler);
  }

  emit(event: SimEvent): void {
    this.handlers.get(event.type)?.forEach((h) => h(event));
    this.handlers.get("*")?.forEach((h) => h(event));
  }

  private add(key: SimEventType | "*", handler: Handler): () => void {
    let set = this.handlers.get(key);
    if (!set) {
      set = new Set();
      this.handlers.set(key, set);
    }
    set.add(handler);
    return () => set.delete(handler);
  }
}
