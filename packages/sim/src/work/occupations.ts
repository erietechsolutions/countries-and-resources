import type { CredentialId } from "../education/courses";
import type { SkillId } from "./skills";

export type Sector =
  | "hospitality"
  | "retail"
  | "logistics"
  | "construction"
  | "agriculture"
  | "manufacturing"
  | "office"
  | "healthcare"
  | "tech"
  | "education"
  | "security"
  | "transport";

export const SECTOR_LABELS: Record<Sector, string> = {
  hospitality: "Food & hospitality",
  retail: "Retail",
  logistics: "Logistics",
  construction: "Construction",
  agriculture: "Agriculture",
  manufacturing: "Manufacturing",
  office: "Business services",
  healthcare: "Healthcare",
  tech: "Technology",
  education: "Education",
  security: "Security",
  transport: "Transport",
};

export interface Shift {
  /** Hour of day the shift starts (0–23). */
  start: number;
  hours: number;
  /** Days of the week worked (0 = Sunday). */
  days: number[];
}

export type OccupationId = string;

export interface OccupationDef {
  id: OccupationId;
  title: string;
  sector: Sector;
  /** 0 = entry level. */
  tier: number;
  /** Pay relative to the local median wage (never below the legal minimum wage). */
  wageFactor: number;
  credentials: CredentialId[];
  skills: Partial<Record<SkillId, number>>;
  /** Minimum hygiene to get hired at an interview. */
  minHygiene: number;
  /** Requires a mailing address (not available to people sleeping rough). */
  needsAddress: boolean;
  shift: Shift;
  /** Skill experience gained per hour worked. */
  trains: Partial<Record<SkillId, number>>;
  /** Next job on the ladder, offered as a promotion within the same company. */
  promotesTo?: OccupationId;
}

const WEEKDAYS = [1, 2, 3, 4, 5];
const ROTATING = [0, 1, 4, 5, 6];
const LATE_WEEK = [3, 4, 5, 6, 0];

export const OCCUPATIONS: OccupationDef[] = [
  // Entry level
  {
    id: "dishwasher",
    title: "Dishwasher",
    sector: "hospitality",
    tier: 0,
    wageFactor: 0.5,
    credentials: [],
    skills: {},
    minHygiene: 10,
    needsAddress: false,
    shift: { start: 16, hours: 8, days: LATE_WEEK },
    trains: { labor: 1, cooking: 0.4 },
    promotesTo: "lineCook",
  },
  {
    id: "fastFood",
    title: "Fast Food Worker",
    sector: "hospitality",
    tier: 0,
    wageFactor: 0.52,
    credentials: [],
    skills: {},
    minHygiene: 30,
    needsAddress: false,
    shift: { start: 11, hours: 8, days: ROTATING },
    trains: { service: 1, cooking: 0.5 },
    promotesTo: "shiftSupervisor",
  },
  {
    id: "cashier",
    title: "Cashier",
    sector: "retail",
    tier: 0,
    wageFactor: 0.55,
    credentials: [],
    skills: {},
    minHygiene: 40,
    needsAddress: true,
    shift: { start: 9, hours: 8, days: ROTATING },
    trains: { service: 1, sales: 0.4 },
    promotesTo: "shiftSupervisor",
  },
  {
    id: "warehouse",
    title: "Warehouse Worker",
    sector: "logistics",
    tier: 0,
    wageFactor: 0.62,
    credentials: [],
    skills: {},
    minHygiene: 15,
    needsAddress: false,
    shift: { start: 6, hours: 8, days: WEEKDAYS },
    trains: { labor: 1 },
    promotesTo: "forkliftOperator",
  },
  {
    id: "janitor",
    title: "Janitor",
    sector: "office",
    tier: 0,
    wageFactor: 0.55,
    credentials: [],
    skills: {},
    minHygiene: 20,
    needsAddress: false,
    shift: { start: 18, hours: 8, days: WEEKDAYS },
    trains: { labor: 0.8 },
  },
  {
    id: "laborer",
    title: "Construction Laborer",
    sector: "construction",
    tier: 0,
    wageFactor: 0.7,
    credentials: [],
    skills: {},
    minHygiene: 10,
    needsAddress: false,
    shift: { start: 7, hours: 9, days: WEEKDAYS },
    trains: { labor: 1.3 },
    promotesTo: "crewLead",
  },
  {
    id: "farmhand",
    title: "Farmhand",
    sector: "agriculture",
    tier: 0,
    wageFactor: 0.5,
    credentials: [],
    skills: {},
    minHygiene: 0,
    needsAddress: false,
    shift: { start: 6, hours: 9, days: [1, 2, 3, 4, 5, 6] },
    trains: { labor: 1.2, driving: 0.2 },
  },
  {
    id: "factoryWorker",
    title: "Factory Worker",
    sector: "manufacturing",
    tier: 0,
    wageFactor: 0.66,
    credentials: [],
    skills: {},
    minHygiene: 20,
    needsAddress: true,
    shift: { start: 7, hours: 8, days: WEEKDAYS },
    trains: { labor: 0.8, technical: 0.4 },
    promotesTo: "machineOperator",
  },
  {
    id: "server",
    title: "Server",
    sector: "hospitality",
    tier: 0,
    wageFactor: 0.55,
    credentials: [],
    skills: {},
    minHygiene: 55,
    needsAddress: true,
    shift: { start: 17, hours: 6, days: LATE_WEEK },
    trains: { service: 1.2, sales: 0.3 },
    promotesTo: "restaurantManager",
  },
  {
    id: "callCenter",
    title: "Call Center Agent",
    sector: "office",
    tier: 0,
    wageFactor: 0.65,
    credentials: ["highSchool"],
    skills: {},
    minHygiene: 30,
    needsAddress: true,
    shift: { start: 9, hours: 8, days: WEEKDAYS },
    trains: { service: 0.8, office: 0.5, sales: 0.4 },
    promotesTo: "officeAssistant",
  },
  {
    id: "securityGuard",
    title: "Security Guard",
    sector: "security",
    tier: 0,
    wageFactor: 0.68,
    credentials: ["securityLicense"],
    skills: {},
    minHygiene: 40,
    needsAddress: true,
    shift: { start: 22, hours: 8, days: ROTATING },
    trains: { service: 0.4, management: 0.1 },
  },
  {
    id: "salesAssociate",
    title: "Sales Associate",
    sector: "retail",
    tier: 0,
    wageFactor: 0.6,
    credentials: [],
    skills: { service: 1 },
    minHygiene: 55,
    needsAddress: true,
    shift: { start: 10, hours: 8, days: ROTATING },
    trains: { sales: 1, service: 0.6 },
    promotesTo: "salesRep",
  },

  // Skilled
  {
    id: "lineCook",
    title: "Line Cook",
    sector: "hospitality",
    tier: 1,
    wageFactor: 0.72,
    credentials: ["foodHandler"],
    skills: { cooking: 2 },
    minHygiene: 35,
    needsAddress: true,
    shift: { start: 15, hours: 8, days: LATE_WEEK },
    trains: { cooking: 1.2 },
    promotesTo: "headChef",
  },
  {
    id: "shiftSupervisor",
    title: "Shift Supervisor",
    sector: "retail",
    tier: 1,
    wageFactor: 0.8,
    credentials: [],
    skills: { service: 3, management: 1 },
    minHygiene: 50,
    needsAddress: true,
    shift: { start: 8, hours: 8, days: ROTATING },
    trains: { management: 1, service: 0.5 },
    promotesTo: "storeManager",
  },
  {
    id: "forkliftOperator",
    title: "Forklift Operator",
    sector: "logistics",
    tier: 1,
    wageFactor: 0.82,
    credentials: ["forklift"],
    skills: { labor: 2 },
    minHygiene: 20,
    needsAddress: true,
    shift: { start: 6, hours: 8, days: WEEKDAYS },
    trains: { labor: 0.6, driving: 0.6 },
    promotesTo: "warehouseSupervisor",
  },
  {
    id: "crewLead",
    title: "Construction Crew Lead",
    sector: "construction",
    tier: 1,
    wageFactor: 0.95,
    credentials: [],
    skills: { labor: 4, management: 1 },
    minHygiene: 20,
    needsAddress: true,
    shift: { start: 7, hours: 9, days: WEEKDAYS },
    trains: { labor: 0.6, management: 0.8 },
  },
  {
    id: "machineOperator",
    title: "Machine Operator",
    sector: "manufacturing",
    tier: 1,
    wageFactor: 0.85,
    credentials: [],
    skills: { technical: 2, labor: 2 },
    minHygiene: 20,
    needsAddress: true,
    shift: { start: 7, hours: 8, days: WEEKDAYS },
    trains: { technical: 1 },
  },
  {
    id: "officeAssistant",
    title: "Office Assistant",
    sector: "office",
    tier: 1,
    wageFactor: 0.82,
    credentials: ["highSchool"],
    skills: { office: 2 },
    minHygiene: 60,
    needsAddress: true,
    shift: { start: 9, hours: 8, days: WEEKDAYS },
    trains: { office: 1.2 },
    promotesTo: "bookkeeper",
  },
  {
    id: "salesRep",
    title: "Sales Representative",
    sector: "office",
    tier: 1,
    wageFactor: 1.0,
    credentials: [],
    skills: { sales: 3 },
    minHygiene: 65,
    needsAddress: true,
    shift: { start: 9, hours: 8, days: WEEKDAYS },
    trains: { sales: 1.2 },
    promotesTo: "salesManager",
  },
  {
    id: "truckDriver",
    title: "Truck Driver",
    sector: "transport",
    tier: 1,
    wageFactor: 1.05,
    credentials: ["cdl"],
    skills: { driving: 1 },
    minHygiene: 20,
    needsAddress: true,
    shift: { start: 5, hours: 10, days: [1, 2, 3, 4] },
    trains: { driving: 1.3 },
  },
  {
    id: "nursingAssistant",
    title: "Nursing Assistant",
    sector: "healthcare",
    tier: 1,
    wageFactor: 0.85,
    credentials: ["nursingAide"],
    skills: {},
    minHygiene: 60,
    needsAddress: true,
    shift: { start: 7, hours: 12, days: [1, 3, 5] },
    trains: { service: 0.8, technical: 0.4 },
  },
  {
    id: "itSupport",
    title: "IT Support Technician",
    sector: "tech",
    tier: 1,
    wageFactor: 1.05,
    credentials: ["itSupport"],
    skills: {},
    minHygiene: 50,
    needsAddress: true,
    shift: { start: 9, hours: 8, days: WEEKDAYS },
    trains: { technical: 1.2, service: 0.3 },
    promotesTo: "softwareDeveloper",
  },
  {
    id: "electricianApprentice",
    title: "Electrician Apprentice",
    sector: "construction",
    tier: 1,
    wageFactor: 0.9,
    credentials: ["electrical"],
    skills: {},
    minHygiene: 25,
    needsAddress: true,
    shift: { start: 7, hours: 8, days: WEEKDAYS },
    trains: { technical: 1.2, labor: 0.4 },
    promotesTo: "electrician",
  },

  // Professional and management
  {
    id: "headChef",
    title: "Head Chef",
    sector: "hospitality",
    tier: 2,
    wageFactor: 1.15,
    credentials: ["foodHandler"],
    skills: { cooking: 5, management: 2 },
    minHygiene: 50,
    needsAddress: true,
    shift: { start: 14, hours: 9, days: LATE_WEEK },
    trains: { cooking: 0.8, management: 0.8 },
  },
  {
    id: "restaurantManager",
    title: "Restaurant Manager",
    sector: "hospitality",
    tier: 2,
    wageFactor: 1.2,
    credentials: [],
    skills: { service: 4, management: 3 },
    minHygiene: 65,
    needsAddress: true,
    shift: { start: 12, hours: 9, days: LATE_WEEK },
    trains: { management: 1.2 },
  },
  {
    id: "storeManager",
    title: "Store Manager",
    sector: "retail",
    tier: 2,
    wageFactor: 1.25,
    credentials: [],
    skills: { management: 3, sales: 2 },
    minHygiene: 65,
    needsAddress: true,
    shift: { start: 8, hours: 9, days: WEEKDAYS },
    trains: { management: 1.2 },
  },
  {
    id: "warehouseSupervisor",
    title: "Warehouse Supervisor",
    sector: "logistics",
    tier: 2,
    wageFactor: 1.15,
    credentials: ["forklift"],
    skills: { labor: 3, management: 2 },
    minHygiene: 30,
    needsAddress: true,
    shift: { start: 6, hours: 9, days: WEEKDAYS },
    trains: { management: 1.2 },
  },
  {
    id: "bookkeeper",
    title: "Bookkeeper",
    sector: "office",
    tier: 2,
    wageFactor: 1.1,
    credentials: ["associateBusiness"],
    skills: { office: 3 },
    minHygiene: 60,
    needsAddress: true,
    shift: { start: 9, hours: 8, days: WEEKDAYS },
    trains: { office: 1 },
    promotesTo: "accountant",
  },
  {
    id: "salesManager",
    title: "Sales Manager",
    sector: "office",
    tier: 2,
    wageFactor: 1.5,
    credentials: [],
    skills: { sales: 5, management: 3 },
    minHygiene: 70,
    needsAddress: true,
    shift: { start: 9, hours: 9, days: WEEKDAYS },
    trains: { sales: 0.6, management: 1 },
  },
  {
    id: "electrician",
    title: "Electrician",
    sector: "construction",
    tier: 2,
    wageFactor: 1.35,
    credentials: ["electrical"],
    skills: { technical: 4 },
    minHygiene: 30,
    needsAddress: true,
    shift: { start: 7, hours: 8, days: WEEKDAYS },
    trains: { technical: 0.8 },
  },
  {
    id: "registeredNurse",
    title: "Registered Nurse",
    sector: "healthcare",
    tier: 2,
    wageFactor: 1.6,
    credentials: ["bachelorNursing"],
    skills: {},
    minHygiene: 70,
    needsAddress: true,
    shift: { start: 7, hours: 12, days: [0, 2, 4] },
    trains: { technical: 0.6, service: 0.6 },
  },
  {
    id: "accountant",
    title: "Accountant",
    sector: "office",
    tier: 2,
    wageFactor: 1.65,
    credentials: ["bachelorAccounting"],
    skills: { office: 3 },
    minHygiene: 70,
    needsAddress: true,
    shift: { start: 9, hours: 8, days: WEEKDAYS },
    trains: { office: 0.8, management: 0.3 },
  },
  {
    id: "softwareDeveloper",
    title: "Software Developer",
    sector: "tech",
    tier: 2,
    wageFactor: 2.0,
    credentials: [],
    skills: { technical: 6 },
    minHygiene: 40,
    needsAddress: true,
    shift: { start: 10, hours: 8, days: WEEKDAYS },
    trains: { technical: 1 },
    promotesTo: "engineeringManager",
  },
  {
    id: "teacher",
    title: "Teacher",
    sector: "education",
    tier: 2,
    wageFactor: 1.25,
    credentials: ["bachelorEducation"],
    skills: {},
    minHygiene: 65,
    needsAddress: true,
    shift: { start: 8, hours: 8, days: WEEKDAYS },
    trains: { service: 0.5, management: 0.5 },
  },
  {
    id: "engineeringManager",
    title: "Engineering Manager",
    sector: "tech",
    tier: 3,
    wageFactor: 2.8,
    credentials: [],
    skills: { technical: 7, management: 4 },
    minHygiene: 60,
    needsAddress: true,
    shift: { start: 10, hours: 9, days: WEEKDAYS },
    trains: { management: 1 },
  },
];

/** Bachelor's in computer science substitutes for experience when hiring developers. */
export const ALTERNATE_QUALIFICATIONS: Partial<Record<OccupationId, CredentialId>> = {
  softwareDeveloper: "bachelorComputerScience",
};

const byId = new Map(OCCUPATIONS.map((o) => [o.id, o]));

export function occupationById(id: OccupationId): OccupationDef {
  const occ = byId.get(id);
  if (!occ) throw new Error(`Unknown occupation "${id}"`);
  return occ;
}

export function occupationsInSector(sector: Sector): OccupationDef[] {
  return OCCUPATIONS.filter((o) => o.sector === sector);
}

export function formatShift(shift: Shift): string {
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const h = (x: number) => {
    const hour = x % 24;
    const h12 = hour % 12 === 0 ? 12 : hour % 12;
    return `${h12}${hour < 12 ? "am" : "pm"}`;
  };
  return `${shift.days.map((d) => names[d]).join(", ")} · ${h(shift.start)}–${h(shift.start + shift.hours)}`;
}
