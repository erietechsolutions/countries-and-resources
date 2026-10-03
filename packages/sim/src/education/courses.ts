/** Credentials gate better jobs. Everyone starts with a high school diploma. */
export type CredentialId =
  | "highSchool"
  | "foodHandler"
  | "forklift"
  | "securityLicense"
  | "cdl"
  | "nursingAide"
  | "itSupport"
  | "electrical"
  | "associateBusiness"
  | "bachelorNursing"
  | "bachelorComputerScience"
  | "bachelorAccounting"
  | "bachelorEducation";

export interface CourseDef {
  id: CredentialId;
  title: string;
  kind: "certificate" | "trade" | "associate" | "bachelor";
  /** Total study hours to finish. */
  hours: number;
  /** Tuition as a multiple of the local median hourly wage (paid on enrollment). */
  tuitionWageMultiple: number;
  requires: CredentialId[];
  description: string;
}

export const COURSES: CourseDef[] = [
  {
    id: "foodHandler",
    title: "Food Handler Certificate",
    kind: "certificate",
    hours: 6,
    tuitionWageMultiple: 2,
    requires: [],
    description: "Required for most kitchen jobs above dishwasher.",
  },
  {
    id: "securityLicense",
    title: "Security Guard License",
    kind: "certificate",
    hours: 24,
    tuitionWageMultiple: 10,
    requires: [],
    description: "Licensed to work as a security guard.",
  },
  {
    id: "forklift",
    title: "Forklift Certification",
    kind: "certificate",
    hours: 18,
    tuitionWageMultiple: 14,
    requires: [],
    description: "Operate forklifts in warehouses and yards.",
  },
  {
    id: "cdl",
    title: "Commercial Driver's License",
    kind: "trade",
    hours: 160,
    tuitionWageMultiple: 180,
    requires: [],
    description: "Drive trucks and buses professionally.",
  },
  {
    id: "nursingAide",
    title: "Nursing Assistant Certificate",
    kind: "certificate",
    hours: 120,
    tuitionWageMultiple: 80,
    requires: ["highSchool"],
    description: "Entry into healthcare as a nursing assistant.",
  },
  {
    id: "itSupport",
    title: "IT Support Certificate",
    kind: "certificate",
    hours: 200,
    tuitionWageMultiple: 120,
    requires: ["highSchool"],
    description: "Help desk and IT support roles.",
  },
  {
    id: "electrical",
    title: "Electrician Trade Program",
    kind: "trade",
    hours: 600,
    tuitionWageMultiple: 350,
    requires: ["highSchool"],
    description: "Become an apprentice, then a licensed electrician.",
  },
  {
    id: "associateBusiness",
    title: "Associate Degree in Business",
    kind: "associate",
    hours: 900,
    tuitionWageMultiple: 500,
    requires: ["highSchool"],
    description: "Office, bookkeeping and supervisory careers.",
  },
  {
    id: "bachelorNursing",
    title: "Bachelor of Nursing",
    kind: "bachelor",
    hours: 2200,
    tuitionWageMultiple: 1600,
    requires: ["highSchool"],
    description: "Become a registered nurse.",
  },
  {
    id: "bachelorComputerScience",
    title: "Bachelor of Computer Science",
    kind: "bachelor",
    hours: 2200,
    tuitionWageMultiple: 1700,
    requires: ["highSchool"],
    description: "Software development careers.",
  },
  {
    id: "bachelorAccounting",
    title: "Bachelor of Accounting",
    kind: "bachelor",
    hours: 2000,
    tuitionWageMultiple: 1500,
    requires: ["highSchool"],
    description: "Accounting and finance careers.",
  },
  {
    id: "bachelorEducation",
    title: "Bachelor of Education",
    kind: "bachelor",
    hours: 2000,
    tuitionWageMultiple: 1300,
    requires: ["highSchool"],
    description: "Become a teacher.",
  },
];

export const CREDENTIAL_LABELS: Record<CredentialId, string> = {
  highSchool: "High school diploma",
  ...Object.fromEntries(COURSES.map((c) => [c.id, c.title])),
} as Record<CredentialId, string>;

export function courseById(id: CredentialId): CourseDef | undefined {
  return COURSES.find((c) => c.id === id);
}
