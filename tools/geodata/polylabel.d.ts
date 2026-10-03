declare module "polylabel" {
  /** Returns the pole of inaccessibility of a polygon, with the distance to its nearest edge. */
  export default function polylabel(
    polygon: number[][][],
    precision?: number,
  ): [number, number] & { distance: number };
}
