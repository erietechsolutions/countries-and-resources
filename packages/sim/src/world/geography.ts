/**
 * Static world geography: the shape of the map, independent of any economic or political data.
 *
 * Both map types produce this same structure: the real-world map is built offline from
 * Natural Earth data (tools/geodata), and the random map generator (M8) will build it at runtime.
 * Everything downstream (economy, politics, war) only ever sees this format.
 *
 * Geography is never stored inside save files; saves reference it by `id` and it is reloaded.
 */

/** A flat list of projected coordinates: [x0, y0, x1, y1, ...]. */
export type FlatRing = number[];

/** A polygon as a list of rings: the first is the outer boundary, any others are holes. */
export type GeoPolygon = FlatRing[];

export type CountryId = string;
export type ProvinceId = number;
export type CityId = number;

export interface GeoCountry {
  id: CountryId;
  name: string;
  provinceIds: ProvinceId[];
  capitalCityId: CityId | null;
  /** False for places like Antarctica where a character cannot start or live. */
  habitable: boolean;
}

export interface GeoProvince {
  id: ProvinceId;
  name: string;
  countryId: CountryId;
  /** Representative latitude/longitude in degrees (used for climate). */
  lat: number;
  lon: number;
  areaKm2: number;
  coastal: boolean;
  /** Land neighbors (shared border). */
  neighbors: ProvinceId[];
  /** Projected label/anchor point. */
  label: [number, number];
  /** Projected bounding box [minX, minY, maxX, maxY]. */
  bbox: [number, number, number, number];
  polygons: GeoPolygon[];
  /** Height above sea level, 0–1 (generated maps only; used for mountains). */
  elevation?: number;
}

export interface GeoCity {
  id: CityId;
  name: string;
  provinceId: ProvinceId;
  countryId: CountryId;
  x: number;
  y: number;
  /** 2 = national capital, 1 = regional capital, 0 = other. */
  capital: 0 | 1 | 2;
  /**
   * Relative size of the settlement on a log scale (roughly 3 = village, 7 = megacity).
   * Used only as a weight by world generators; real populations are not used in Economic modes.
   */
  importance: number;
  /**
   * Smaller towns (20,000+ people) from the extended dataset. They always exist in the world, but
   * the map and location lists only show them when the player turns on the "smaller towns" setting.
   */
  minor?: true;
}

export interface GeoBorders {
  /** Borders between different countries. */
  country: FlatRing[];
  /** Borders between provinces of the same country. */
  province: FlatRing[];
  /** Coastlines and other outer edges. */
  coast: FlatRing[];
}

export type WaterKind = "ocean" | "sea" | "bay" | "strait" | "lake";

/** A named body of water, labeled on the map. */
export interface GeoWaterLabel {
  name: string;
  kind: WaterKind;
  /** Projected label point, inside the body of water. */
  x: number;
  y: number;
  /** Largest font size (in map units) at which the name still fits inside the water. */
  size: number;
  /** Text angle in radians (0 = level), following long, narrow waters such as straits. */
  rotation: number;
}

export interface WorldGeography {
  id: string;
  name: string;
  /** Size of the projected coordinate space. */
  width: number;
  height: number;
  countries: GeoCountry[];
  provinces: GeoProvince[];
  cities: GeoCity[];
  borders: GeoBorders;
  /** Inland lakes drawn as water on top of the land. */
  lakes: GeoPolygon[];
  waterLabels: GeoWaterLabel[];
}

/** The geography file id for the real-world map. */
export const REAL_WORLD_GEOGRAPHY_ID = "real-world";
