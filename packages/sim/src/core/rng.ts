/**
 * Seeded, serializable random number generator (mulberry32).
 *
 * The simulation must never use Math.random(): every random outcome comes from a seeded Rng so
 * that the same seed and the same commands always produce the same game. That determinism is what
 * makes replays, bug reproduction and lockstep multiplayer possible.
 */
export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  /**
   * An independent stream derived from a seed and a key, e.g. Rng.fromKey(seed, "country:FRA").
   * Keyed streams keep generation stable: adding a new random field to one country does not
   * shift the random numbers every other country receives.
   */
  static fromKey(seed: number, key: string): Rng {
    return new Rng(mix32((seed >>> 0) ^ hashString(key)));
  }

  get state(): number {
    return this.s;
  }

  set state(value: number) {
    this.s = value >>> 0;
  }

  /** Float in [0, 1). */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max], inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("Rng.pick called with an empty array");
    return items[Math.floor(this.next() * items.length)]!;
  }

  /** Picks an item with probability proportional to its weight. */
  weighted<T>(items: readonly (readonly [T, number])[]): T {
    const total = items.reduce((sum, [, w]) => sum + Math.max(0, w), 0);
    if (total <= 0) throw new Error("Rng.weighted called with no positive weights");
    let roll = this.next() * total;
    for (const [item, w] of items) {
      roll -= Math.max(0, w);
      if (roll < 0) return item;
    }
    return items[items.length - 1]![0];
  }

  /** Normally distributed value (Box–Muller). */
  normal(mean = 0, sd = 1): number {
    const u = 1 - this.next();
    const v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [items[i], items[j]] = [items[j]!, items[i]!];
    }
    return items;
  }
}

/** 32-bit FNV-1a string hash. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mix32(x: number): number {
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}

/** A new random seed, for UI use when the player has not typed one. */
export function randomSeed(source: () => number): number {
  return Math.floor(source() * 0xffffffff) >>> 0;
}
