import type { Rng } from "../core/rng";

/** Seeded 2D gradient noise (Perlin-style) with fractal layering. Output roughly in [-1, 1]. */
export class Noise2D {
  private perm: Uint8Array;
  private grads: Float64Array;

  constructor(rng: Rng) {
    const p = Array.from({ length: 256 }, (_, i) => i);
    rng.shuffle(p);
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255]!;
    this.grads = new Float64Array(512);
    for (let i = 0; i < 256; i++) {
      const a = rng.next() * Math.PI * 2;
      this.grads[i * 2] = Math.cos(a);
      this.grads[i * 2 + 1] = Math.sin(a);
    }
  }

  private dot(ix: number, iy: number, x: number, y: number): number {
    const g = this.perm[(this.perm[ix & 255]! + iy) & 511]! & 255;
    return this.grads[g * 2]! * (x - ix) + this.grads[g * 2 + 1]! * (y - iy);
  }

  noise(x: number, y: number): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
    const u = fade(x - x0);
    const v = fade(y - y0);
    const a = this.dot(x0, y0, x, y) + u * (this.dot(x0 + 1, y0, x, y) - this.dot(x0, y0, x, y));
    const b =
      this.dot(x0, y0 + 1, x, y) +
      u * (this.dot(x0 + 1, y0 + 1, x, y) - this.dot(x0, y0 + 1, x, y));
    return (a + v * (b - a)) * 1.41;
  }

  /** Fractal Brownian motion: several octaves of noise at increasing frequency. */
  fbm(x: number, y: number, octaves = 5, lacunarity = 2, gain = 0.5): number {
    let sum = 0;
    let amp = 1;
    let freq = 1;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * this.noise(x * freq, y * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }
}
