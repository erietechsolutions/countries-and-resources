import type { Gender } from "../character/character";
import type { GameTime } from "../core/calendar";
import type { CityId } from "../world/geography";
import type { Ideology } from "../world/types";

export type Trait =
  | "kind"
  | "ambitious"
  | "funny"
  | "loyal"
  | "greedy"
  | "shy"
  | "charming"
  | "hotheaded"
  | "honest"
  | "cunning";

export const TRAIT_LABELS: Record<Trait, string> = {
  kind: "Kind",
  ambitious: "Ambitious",
  funny: "Funny",
  loyal: "Loyal",
  greedy: "Greedy",
  shy: "Shy",
  charming: "Charming",
  hotheaded: "Hotheaded",
  honest: "Honest",
  cunning: "Cunning",
};

/** A notable non-player person: friends, partners, coworkers, politicians, rivals. */
export interface Person {
  id: string;
  firstName: string;
  lastName: string;
  gender: Gender;
  birthTime: GameTime;
  cityId: CityId;
  /** What they do for a living (display only for most people). */
  occupation: string;
  /** Monthly income in cents. */
  incomeCents: number;
  traits: Trait[];
  ideology: Ideology;
  alive: boolean;
  /** Special roles drive extra behavior (politicians, rivals, bosses...). */
  role?: "politician" | "rival" | "crimeBoss" | "journalist" | "mentor";
}

export type RelationshipKind =
  | "acquaintance"
  | "friend"
  | "bestFriend"
  | "dating"
  | "engaged"
  | "spouse"
  | "ex"
  | "child"
  | "rival";

export const RELATIONSHIP_LABELS: Record<RelationshipKind, string> = {
  acquaintance: "Acquaintance",
  friend: "Friend",
  bestFriend: "Best friend",
  dating: "Dating",
  engaged: "Engaged",
  spouse: "Spouse",
  ex: "Ex",
  child: "Child",
  rival: "Rival",
};

export interface Relationship {
  personId: string;
  kind: RelationshipKind;
  /** 0–100: how much they like you. */
  affection: number;
  /** 0–100: romantic interest. */
  romance: number;
  metAt: GameTime;
  lastContact: GameTime;
  /** How you met, for flavor ("at work", "at a bar"...). */
  context: string;
}

export type RepGroup =
  "community" | "workers" | "business" | "establishment" | "activists" | "underworld";

export const REP_GROUPS: { id: RepGroup; label: string; description: string }[] = [
  { id: "community", label: "Community", description: "Your neighbors and local residents." },
  { id: "workers", label: "Workers", description: "Working people and unions." },
  { id: "business", label: "Business", description: "Employers, investors and owners." },
  {
    id: "establishment",
    label: "Establishment",
    description: "Officials, elites and institutions.",
  },
  { id: "activists", label: "Activists", description: "Campaigners, volunteers and reformers." },
  { id: "underworld", label: "Underworld", description: "Criminals and the people who know them." },
];

/** -100 to 100 for each group, plus overall fame (0–100). */
export type Reputation = Record<RepGroup, number> & { fame: number };

export function emptyReputation(): Reputation {
  return {
    community: 0,
    workers: 0,
    business: 0,
    establishment: 0,
    activists: 0,
    underworld: 0,
    fame: 0,
  };
}

export interface Pregnancy {
  partnerId: string;
  dueAt: GameTime;
}
