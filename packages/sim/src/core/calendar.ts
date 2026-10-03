/**
 * Game time is a whole number of hours since 1970-01-01 00:00 on the in-game calendar.
 * One simulation tick is one hour. The calendar has no time zones or daylight saving.
 */
export type GameTime = number;

export const HOURS_PER_DAY = 24;
const MS_PER_HOUR = 3_600_000;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export interface DateParts {
  year: number;
  /** 1–12 */
  month: number;
  /** 1–31 */
  day: number;
  /** 0–23 */
  hour: number;
  /** 0 = Sunday */
  weekday: number;
}

export function fromDate(year: number, month: number, day: number, hour = 0): GameTime {
  return Date.UTC(year, month - 1, day, hour) / MS_PER_HOUR;
}

/**
 * Converts a real-world Date (e.g. "now" when a save is created) to the start of that calendar
 * day in game time, using the date as the player sees it locally.
 */
export function gameDateFromRealDate(date: Date, hour = 0): GameTime {
  return fromDate(date.getFullYear(), date.getMonth() + 1, date.getDate(), hour);
}

export function toDateParts(time: GameTime): DateParts {
  const d = new Date(time * MS_PER_HOUR);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    weekday: d.getUTCDay(),
  };
}

export function monthName(month: number): string {
  return MONTHS[month - 1] ?? "?";
}

export function weekdayName(weekday: number): string {
  return WEEKDAYS[weekday] ?? "?";
}

/** "March 5, 2027" */
export function formatDate(time: GameTime): string {
  const p = toDateParts(time);
  return `${monthName(p.month)} ${p.day}, ${p.year}`;
}

/** "8:00 AM" */
export function formatTime(time: GameTime): string {
  const { hour } = toDateParts(time);
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:00 ${hour < 12 ? "AM" : "PM"}`;
}

export function isStartOfDay(time: GameTime): boolean {
  return toDateParts(time).hour === 0;
}

export function startOfDay(time: GameTime): GameTime {
  return time - toDateParts(time).hour;
}

/** Adds whole calendar years. February 29 becomes February 28 in non-leap years. */
export function addYears(time: GameTime, years: number): GameTime {
  const p = toDateParts(time);
  const year = p.year + years;
  const day = p.month === 2 && p.day === 29 && !isLeapYear(year) ? 28 : p.day;
  return fromDate(year, p.month, day, p.hour);
}

export function addDays(time: GameTime, days: number): GameTime {
  return time + days * HOURS_PER_DAY;
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Completed years between birth and now. */
export function ageInYears(birth: GameTime, now: GameTime): number {
  const b = toDateParts(birth);
  const n = toDateParts(now);
  let age = n.year - b.year;
  if (n.month < b.month || (n.month === b.month && n.day < b.day)) age--;
  return age;
}
