import { useSyncExternalStore } from "react";

export interface Settings {
  /** Save to the autosave slot at the start of every in-game month. */
  autosave: boolean;
  showProvinceBorders: boolean;
  showCityLabels: boolean;
}

const KEY = "cr.settings";
const DEFAULTS: Settings = { autosave: true, showProvinceBorders: true, showCityLabels: true };

function read(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

let current = read();
const listeners = new Set<() => void>();

export function getSettings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Storage can be unavailable (private windows); settings then last for this session only.
  }
  listeners.forEach((l) => l());
}

export function useSettings(): Settings {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
