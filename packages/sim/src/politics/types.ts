import type { GameTime } from "../core/calendar";
import type { CityId, CountryId, ProvinceId } from "../world/geography";

export type OfficeLevel = "city" | "region" | "national";
export type OfficeKind =
  "councilor" | "mayor" | "regionalCouncilor" | "governor" | "legislator" | "headOfGovernment";

/** "player" or a Person id. */
export type HolderId = string;

export interface Office {
  id: string;
  kind: OfficeKind;
  level: OfficeLevel;
  title: string;
  countryId: CountryId;
  cityId?: CityId;
  provinceId?: ProvinceId;
  seats: number;
  holders: HolderId[];
  /** Party of each seat's holder (parallel to holders). */
  holderParties: (string | null)[];
  termYears: number;
  /** Next election date, or null for appointed offices in non-democracies. */
  nextElection: GameTime | null;
  /** Monthly salary in cents. */
  salaryCents: number;
}

export interface Candidate {
  id: HolderId;
  partyId: string | null;
  /** Personal pull with voters beyond their party, -0.3..0.6. */
  appeal: number;
  incumbent: boolean;
}

export interface ElectionResult {
  id: HolderId;
  partyId: string | null;
  share: number;
  won: boolean;
}

export interface Election {
  id: string;
  officeId: string;
  date: GameTime;
  /** Candidates can file from this time... */
  filingOpens: GameTime;
  /** ...until this time. */
  filingCloses: GameTime;
  candidates: Candidate[];
  status: "upcoming" | "done";
  results?: ElectionResult[];
  /** For proportional elections: seats won per party. */
  partySeats?: Record<string, number>;
}

export type BillStatus = "voting" | "awaitingSignature" | "enacted" | "failed" | "vetoed";

export interface Bill {
  id: string;
  /** Which body votes: the office id of the legislature or council. */
  officeId: string;
  policyId: string;
  /** +1 raises the lever by one step, -1 lowers it. */
  direction: 1 | -1;
  /** "city:12", "region:40" or "national:FRA". */
  scope: string;
  proposerId: HolderId;
  proposedAt: GameTime;
  voteAt: GameTime;
  status: BillStatus;
  votes: { yes: number; no: number };
  /** The player's vote, if they sit in the voting body. */
  playerVote?: "yes" | "no";
}

export interface LawRecord {
  time: GameTime;
  scope: string;
  policyId: string;
  direction: 1 | -1;
  passedBy: HolderId;
}

/** Policy levers set by city and regional governments (national ones live on the country). */
export interface LocalPolicies {
  rentControl: number;
  shelterFunding: number;
  localMinimumWage: number;
  businessTax: number;
  policing: number;
}

export function defaultLocalPolicies(): LocalPolicies {
  return {
    rentControl: 0,
    shelterFunding: 0.3,
    localMinimumWage: 0,
    businessTax: 0,
    policing: 0.5,
  };
}

export interface PoliticsState {
  offices: Office[];
  elections: Election[];
  bills: Bill[];
  laws: LawRecord[];
  localPolicies: Record<string, LocalPolicies>;
  /** Cities whose city and regional offices have been set up. */
  setUpCities: CityId[];
  setUpCountries: CountryId[];
  nextId: number;
}

export function emptyPolitics(): PoliticsState {
  return {
    offices: [],
    elections: [],
    bills: [],
    laws: [],
    localPolicies: {},
    setUpCities: [],
    setUpCountries: [],
    nextId: 1,
  };
}

export interface Candidacy {
  electionId: string;
  /** Campaign hours put in. */
  effort: number;
  /** Money raised for the campaign. */
  fundsCents: number;
  /** Money spent on ads. */
  spentCents: number;
}

export interface PlayerPolitics {
  partyId: string | null;
  /** 0 member · 1 activist · 2 organizer · 3 local chair · 4 regional chair · 5 party leader. */
  rank: number;
  /** Standing inside the party, earned by volunteering, campaigning and winning. */
  standing: number;
  joinedAt: number;
  candidacy: Candidacy | null;
  /** Public approval while holding office, 0–100. */
  approval: number;
  /** Bills the player can still propose this month. */
  proposalsLeft: number;
}

export function emptyPlayerPolitics(): PlayerPolitics {
  return {
    partyId: null,
    rank: 0,
    standing: 0,
    joinedAt: 0,
    candidacy: null,
    approval: 50,
    proposalsLeft: 0,
  };
}

export const RANK_TITLES = [
  "Member",
  "Activist",
  "Organizer",
  "Local chair",
  "Regional chair",
  "Party leader",
];
