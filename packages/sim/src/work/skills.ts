export type SkillId =
  "labor" | "service" | "cooking" | "office" | "technical" | "sales" | "management" | "driving";

export const SKILLS: { id: SkillId; label: string }[] = [
  { id: "labor", label: "Manual labor" },
  { id: "service", label: "Customer service" },
  { id: "cooking", label: "Cooking" },
  { id: "office", label: "Office work" },
  { id: "technical", label: "Technical" },
  { id: "sales", label: "Sales" },
  { id: "management", label: "Management" },
  { id: "driving", label: "Driving" },
];

/** Skill experience is counted in hours of practice. */
export type SkillXp = Record<SkillId, number>;

export function emptySkills(): SkillXp {
  return {
    labor: 0,
    service: 0,
    cooking: 0,
    office: 0,
    technical: 0,
    sales: 0,
    management: 0,
    driving: 0,
  };
}

/** Level n needs 25·n² hours: level 1 = 25h, 2 = 100h, 3 = 225h, 5 = 625h, 8 = 1,600h. */
export function skillLevel(xp: number): number {
  return Math.floor(Math.sqrt(Math.max(0, xp) / 25));
}

export function xpForLevel(level: number): number {
  return 25 * level * level;
}

export const MAX_SKILL_LEVEL = 10;
