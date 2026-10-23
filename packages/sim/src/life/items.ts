export type ItemId = "phone" | "bicycle" | "sleepingBag" | "interviewClothes" | "backpack";

export interface ItemDef {
  id: ItemId;
  name: string;
  description: string;
  /** Price as a multiple of the local median hourly wage. */
  priceWageMultiple: number;
}

export const ITEMS: ItemDef[] = [
  {
    id: "phone",
    name: "Prepaid phone",
    description: "Employers can call you back: better job search results. Needed for gig apps.",
    priceWageMultiple: 12,
  },
  {
    id: "bicycle",
    name: "Used bicycle",
    description: "Lets you do delivery gigs.",
    priceWageMultiple: 14,
  },
  {
    id: "sleepingBag",
    name: "Sleeping bag",
    description: "Less damage to your health when you sleep outside.",
    priceWageMultiple: 4,
  },
  {
    id: "interviewClothes",
    name: "Interview clothes",
    description: "Make a better impression: more job offers.",
    priceWageMultiple: 8,
  },
  {
    id: "backpack",
    name: "Backpack",
    description: "Keeps your things on you: thieves get less when you sleep rough.",
    priceWageMultiple: 3,
  },
];

export function itemById(id: ItemId): ItemDef {
  const item = ITEMS.find((i) => i.id === id);
  if (!item) throw new Error(`Unknown item "${id}"`);
  return item;
}
