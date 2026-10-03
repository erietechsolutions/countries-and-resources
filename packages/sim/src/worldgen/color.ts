/** Converts HSL (h in degrees, s and l in 0–1) to a 0xRRGGBB number. */
export function hslToHex(h: number, s: number, l: number): number {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to255 = (v: number) => Math.round(v * 255);
  return (to255(f(0)) << 16) | (to255(f(8)) << 8) | to255(f(4));
}

/**
 * Political map palette: muted, distinguishable hues. Neighbors are assigned different entries,
 * and each country gets a small lightness variation so the map does not look flat.
 */
export const POLITICAL_HUES = [8, 32, 52, 95, 140, 170, 195, 220, 255, 285, 315, 340];
