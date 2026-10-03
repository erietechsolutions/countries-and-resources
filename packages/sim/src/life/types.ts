import type { GameTime } from "../core/calendar";
import type { CredentialId } from "../education/courses";
import type { CityId } from "../world/geography";
import type { OccupationId } from "../work/occupations";

/** All needs run 0–100, where 100 is fully satisfied. */
export interface Needs {
  food: number;
  energy: number;
  hygiene: number;
  health: number;
  happiness: number;
}
export type NeedId = keyof Needs;

export type UnitType = "room" | "studio" | "oneBed" | "twoBed";

export type Housing =
  | { kind: "parents" }
  | { kind: "homeless" }
  | { kind: "renting"; unit: UnitType; rentCents: number; since: GameTime; missedPayments: number };

export type HousingKind = Housing["kind"];

export type Personality = "supportive" | "easygoing" | "strict";

export interface FamilyMember {
  id: string;
  firstName: string;
  lastName: string;
  relation: "mother" | "father";
  personality: Personality;
  /** 0–100. */
  relationship: number;
  /** Household income relative to the local median (0.4 = poor, 2.5 = well off). */
  wealth: number;
  cityId: CityId;
}

export interface Employment {
  companyId: string;
  occupationId: OccupationId;
  wageCents: number;
  startedAt: GameTime;
  /** 0–100: rises with good shifts, falls with tired, dirty or missed shifts. */
  performance: number;
  /** Times of recent missed shifts (only the last 30 days count). */
  missedShifts: GameTime[];
  /** Hours worked since the last payday, paid out on Fridays. */
  unpaidHours: number;
  lastPromotionAt: GameTime;
}

export interface JobOffer {
  id: string;
  companyId: string;
  occupationId: OccupationId;
  wageCents: number;
  expiresAt: GameTime;
}

export interface Enrollment {
  courseId: CredentialId;
  progressHours: number;
  enrolledAt: GameTime;
}

export type DebtKind = "payday" | "personal" | "medical" | "collections";

export interface Debt {
  id: string;
  kind: DebtKind;
  label: string;
  balanceCents: number;
  openedAt: GameTime;
  /** Payday loans: when the full balance is due. */
  dueAt: GameTime | null;
  /** Personal loans: fixed monthly installment. */
  monthlyPaymentCents: number;
  /** Yearly interest rate (0.25 = 25%), charged monthly. */
  apr: number;
  missedPayments: number;
  rollovers: number;
}

export type LedgerCategory =
  | "wages"
  | "gig"
  | "gift"
  | "rent"
  | "food"
  | "shopping"
  | "tuition"
  | "loan"
  | "debtPayment"
  | "medical"
  | "theft"
  | "deposit"
  | "other";

export interface Transaction {
  time: GameTime;
  amountCents: number;
  category: LedgerCategory;
  description: string;
}

export interface Finance {
  ledger: Transaction[];
  debts: Debt[];
  /** 300–850, or null with no credit history yet. */
  creditScore: number | null;
  nextDebtId: number;
}

export interface ActivityState {
  id: string;
  startedAt: GameTime;
  endsAt: GameTime;
  /** Optional choice made when starting, e.g. meals to buy. */
  amount?: number;
  /** The person this activity is with (hanging out, dates, calls). */
  targetId?: string;
}

export interface DailyFlags {
  /** Calendar day these flags belong to (game time at midnight). */
  day: GameTime;
  chores: boolean;
  familyTalk: boolean;
  foodBank: boolean;
  jobSearch: boolean;
}
