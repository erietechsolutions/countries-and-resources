import { useMemo, useState } from "react";
import type { CityId, WorldGeography } from "@cr/sim";
import { useSettings } from "../storage/settings";

function normalize(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** A search box for cities and towns; picking a result calls onSelect. */
export function CitySearch({
  geography,
  onSelect,
}: {
  geography: WorldGeography;
  onSelect(cityId: CityId): void;
}) {
  const { showTowns } = useSettings();
  const [query, setQuery] = useState("");
  const index = useMemo(() => {
    const habitable = new Set(geography.countries.filter((c) => c.habitable).map((c) => c.id));
    const names = new Map(geography.countries.map((c) => [c.id, c.name]));
    return geography.cities
      .filter((c) => habitable.has(c.countryId) && (showTowns || !c.minor))
      .map((c) => ({
        c,
        key: normalize(c.name),
        where: `${geography.provinces[c.provinceId]!.name}, ${names.get(c.countryId)}`,
      }));
  }, [geography, showTowns]);
  const results = useMemo(() => {
    const q = normalize(query.trim());
    if (q.length < 2) return [];
    return index
      .filter((x) => x.key.includes(q))
      .sort(
        (a, b) =>
          Number(b.key.startsWith(q)) - Number(a.key.startsWith(q)) ||
          b.c.importance - a.c.importance,
      )
      .slice(0, 8);
  }, [query, index]);
  return (
    <div className="city-search">
      <input
        className="input"
        placeholder="Find a place…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Find a place"
      />
      {results.length > 0 && (
        <ul className="search-results">
          {results.map(({ c, where }) => (
            <li key={c.id}>
              <button
                onClick={() => {
                  setQuery("");
                  onSelect(c.id);
                }}
              >
                <strong>{c.name}</strong> <span className="muted small">{where}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
