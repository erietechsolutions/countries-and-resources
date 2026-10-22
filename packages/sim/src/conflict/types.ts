import type { GameTime } from "../core/calendar";
import type { CountryId, ProvinceId } from "../world/geography";
import type { GovernmentType } from "../world/types";

export type MilitiaOrders = "train" | "raid" | "hold" | "lieLow";

export const ORDER_LABELS: Record<MilitiaOrders, string> = {
  train: "Train",
  raid: "Raid and extort",
  hold: "Dig in",
  lieLow: "Lie low",
};

export const ORDER_DESCRIPTIONS: Record<MilitiaOrders, string> = {
  train: "Drill your fighters. Training improves; the police take a little notice.",
  raid: "Shake down businesses and raid depots for money. Draws a crackdown and angers locals.",
  hold: "Fortify the regions you hold. Much harder to dislodge.",
  lieLow: "Stay quiet. The crackdown fades, but so does morale.",
};

/** An armed group led by the player. */
export interface Militia {
  name: string;
  foundedAt: GameTime;
  /** The country it fights in. */
  countryId: CountryId;
  /** Where it was founded and recruits from. */
  baseProvinceId: ProvinceId;
  fighters: number;
  /** 0–100 */
  equipment: number;
  /** 0–100 */
  training: number;
  /** 0–100 */
  morale: number;
  orders: MilitiaOrders;
  /** Regions under the militia's control. */
  held: { provinceId: ProvinceId; since: GameTime }[];
  /** An attack under way. */
  operation: { provinceId: ProvinceId; resolveAt: GameTime; lead: boolean } | null;
  /** 0–100: how hard the government is hunting the militia. */
  crackdown: number;
  /** Fighters that can still be recruited this month. */
  recruitsLeft: number;
}

/** A rebel movement run by the AI in an unstable country. */
export interface Insurgency {
  id: string;
  name: string;
  countryId: CountryId;
  fighters: number;
  /** 0–1: arms and experience. */
  quality: number;
  held: ProvinceId[];
  since: GameTime;
}

export type WarKind = "conquest" | "independence";

export interface Battle {
  time: GameTime;
  provinceId: ProvinceId;
  winner: CountryId;
}

export interface War {
  id: string;
  name: string;
  kind: WarKind;
  /** The first attacker and defender lead their sides; others are allies. */
  attackers: CountryId[];
  defenders: CountryId[];
  /** Provinces the attackers are fighting for. */
  claims: ProvinceId[];
  startedAt: GameTime;
  /** Provinces held by the other side's troops: province id -> occupying country. */
  occupied: Record<ProvinceId, CountryId>;
  /** -100..100: positive means the attackers are winning. */
  score: number;
  status: "active" | "ended";
  endedAt?: GameTime;
  outcome?: string;
  /** Most recent battles, newest last. */
  battles: Battle[];
}

/** A vote on independence for the region the player governs. */
export interface Referendum {
  provinceId: ProvinceId;
  countryId: CountryId;
  /** Name and government the new country would have. */
  name: string;
  government: GovernmentType;
  voteAt: GameTime;
  /** Set once the votes are counted. */
  yesShare?: number;
  /** The parent country refused to accept a "yes" vote; the region may declare anyway. */
  rejected?: boolean;
  /** Until when a rejected result can still be acted on. */
  expiresAt?: GameTime;
}

export interface ConflictState {
  militia: Militia | null;
  insurgencies: Insurgency[];
  wars: War[];
  /** -100..100 between pairs of countries ("AAA|BBB", sorted). Missing pairs use a default. */
  relations: Record<string, number>;
  /** Pairs of allied countries ("AAA|BBB", sorted). */
  alliances: string[];
  referendum: Referendum | null;
  nextId: number;
}

export function emptyConflict(): ConflictState {
  return {
    militia: null,
    insurgencies: [],
    wars: [],
    relations: {},
    alliances: [],
    referendum: null,
    nextId: 1,
  };
}

export function pairKey(a: CountryId, b: CountryId): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
