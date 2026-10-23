import type { Rng } from "../core/rng";
import type { Gender } from "./character";

// Small starter lists for random name suggestions. Culture-specific name sets come later.
const FIRST: Record<Gender, string[]> = {
  male: [
    "James",
    "Mateo",
    "Liam",
    "Omar",
    "Kenji",
    "Ivan",
    "Noah",
    "Arjun",
    "Lucas",
    "Kwame",
    "Diego",
    "Ethan",
    "Yusuf",
    "Leo",
    "Marcus",
  ],
  female: [
    "Olivia",
    "Sofia",
    "Amara",
    "Mei",
    "Elena",
    "Priya",
    "Emma",
    "Fatima",
    "Chloe",
    "Zara",
    "Isabel",
    "Hana",
    "Ava",
    "Nadia",
    "Grace",
  ],
};
export const LAST_NAMES = [
  "Smith",
  "Garcia",
  "Chen",
  "Okafor",
  "Novak",
  "Silva",
  "Kim",
  "Patel",
  "Müller",
  "Rossi",
  "Haddad",
  "Johnson",
  "Tanaka",
  "Kowalski",
  "Mensah",
  "Nguyen",
  "Lopez",
  "Brown",
  "Ivanova",
  "Walker",
];

export function randomName(gender: Gender, rng: Rng): { firstName: string; lastName: string } {
  return { firstName: rng.pick(FIRST[gender]), lastName: rng.pick(LAST_NAMES) };
}
