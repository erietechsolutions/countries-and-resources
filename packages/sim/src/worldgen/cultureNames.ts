import type { Rng } from "../core/rng";

/**
 * Invented naming cultures for generated worlds. Neighboring countries share a culture, so
 * their country, region and city names sound related.
 */
export interface Culture {
  id: string;
  onsets: string[];
  vowels: string[];
  codas: string[];
  countrySuffixes: string[];
  regionSuffixes: string[];
  citySuffixes: string[];
  cityPrefixes: string[];
}

export const CULTURES: Culture[] = [
  {
    id: "northern",
    onsets: ["k", "th", "sv", "br", "h", "r", "st", "g", "l", "fr", "sk", "v", "b"],
    vowels: ["a", "e", "i", "o", "u", "ei", "au", "y"],
    codas: ["n", "r", "rd", "ld", "sk", "nd", "rn", "lf", "", ""],
    countrySuffixes: ["ia", "land", "mark", "heim", "rike"],
    regionSuffixes: ["fjord", "dal", "mark", "land", ""],
    citySuffixes: ["vik", "borg", "by", "stad", "holm", "havn", "sund"],
    cityPrefixes: [],
  },
  {
    id: "southern",
    onsets: ["v", "l", "c", "m", "s", "t", "p", "r", "b", "d", "f", "g", "n"],
    vowels: ["a", "e", "i", "o", "u", "ia", "io", "ea"],
    codas: ["n", "s", "r", "l", "", "", ""],
    countrySuffixes: ["ia", "ora", "ano", "ica", "esa"],
    regionSuffixes: ["a", "ia", "ana", "ese", ""],
    citySuffixes: ["a", "o", "ia", "ano", "ella", "ona", "ino"],
    cityPrefixes: ["San ", "Porto ", "Santa ", "Villa "],
  },
  {
    id: "eastern",
    onsets: ["br", "dr", "kr", "v", "z", "sl", "pr", "m", "n", "gr", "ch", "zh", "t", "p"],
    vowels: ["a", "o", "e", "i", "y", "ia"],
    codas: ["v", "k", "sk", "n", "r", "d", "sh", ""],
    countrySuffixes: ["ia", "ovia", "enia", "ava"],
    regionSuffixes: ["sk", "ovo", "ia", "ina", ""],
    citySuffixes: ["grad", "ov", "sk", "ets", "ino", "nik", "ava"],
    cityPrefixes: ["Novo", "Stara "],
  },
  {
    id: "desert",
    onsets: ["q", "kh", "z", "s", "r", "m", "b", "j", "h", "t", "d", "n", "f"],
    vowels: ["a", "i", "u", "aa", "ei", "ou"],
    codas: ["r", "n", "d", "m", "sh", "l", "", ""],
    countrySuffixes: ["ia", "an", "ar", "istan", "iya"],
    regionSuffixes: ["iya", "an", "ar", ""],
    citySuffixes: ["abad", "ar", "ah", "esh", "un", "iz"],
    cityPrefixes: ["Al ", "El "],
  },
  {
    id: "steppe",
    onsets: ["t", "k", "b", "s", "a", "ch", "ul", "or", "y", "j", "q"],
    vowels: ["a", "u", "o", "e", "y"],
    codas: ["n", "r", "l", "k", "z", "sh", ""],
    countrySuffixes: ["istan", "stan", "ia", "ar"],
    regionSuffixes: ["ar", "stan", "tau", ""],
    citySuffixes: ["kent", "ar", "bek", "tau", "abad", "kul"],
    cityPrefixes: [],
  },
  {
    id: "far-eastern",
    onsets: ["k", "t", "s", "h", "m", "n", "ch", "sh", "l", "r", "y", "j", "w", "f"],
    vowels: ["a", "i", "u", "e", "o", "ao", "ei", "ua"],
    codas: ["n", "ng", "", "", ""],
    countrySuffixes: ["an", "o", "ia", "eng"],
    regionSuffixes: ["shu", "an", "ing", ""],
    citySuffixes: ["jo", "shi", "an", "ing", "ka", "ou", "hai"],
    cityPrefixes: [],
  },
  {
    id: "islander",
    onsets: ["k", "l", "m", "n", "p", "t", "v", "h", "w", ""],
    vowels: ["a", "e", "i", "o", "u", "ai", "au"],
    codas: [""],
    countrySuffixes: ["a", "i", "u", "ua"],
    regionSuffixes: ["a", "i", ""],
    citySuffixes: ["lua", "ki", "nui", "pa", "ola"],
    cityPrefixes: ["Port "],
  },
  {
    id: "western",
    onsets: ["br", "w", "h", "ch", "sh", "l", "m", "d", "gl", "st", "n", "c", "b", "f"],
    vowels: ["a", "e", "i", "o", "ea", "oo", "ay"],
    codas: ["n", "ll", "rd", "ck", "m", "th", "s", "nd", "r"],
    countrySuffixes: ["land", "ia", "shire", "mont"],
    regionSuffixes: ["shire", "land", "wood", "ton", ""],
    citySuffixes: ["ton", "ford", "field", "bury", "ham", "wick", "port", "wood"],
    cityPrefixes: ["New ", "East ", "West "],
  },
  {
    id: "equatorial",
    onsets: ["mb", "nd", "ng", "k", "t", "z", "l", "m", "b", "w", "s", "j"],
    vowels: ["a", "e", "i", "o", "u"],
    codas: ["", "", "", "n"],
    countrySuffixes: ["a", "i", "ia", "land", "we"],
    regionSuffixes: ["a", "i", "o", ""],
    citySuffixes: ["ni", "la", "ba", "we", "ga", "mbe", "ko"],
    cityPrefixes: [],
  },
];

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Collapses awkward letter runs left over from joining syllables. */
function tidy(s: string): string {
  return s
    .replace(/(.)\1\1+/g, "$1$1")
    .replace(/([aeiouy])\1/g, "$1")
    .replace(/([aeiouy]{2})[aeiouy]+/g, "$1")
    .replace(/([^aeiouy\s]{3})[^aeiouy\s]+/g, "$1");
}

/** "Kora" → "Koran", "Vesk" → "Veskian": adjective forms for ocean names. */
function adjective(root: string): string {
  return /[aeiouy]$/.test(root) ? `${root}n` : `${root}ian`;
}

function root(culture: Culture, rng: Rng, minSyl: number, maxSyl: number): string {
  let out = "";
  const n = rng.int(minSyl, maxSyl);
  for (let i = 0; i < n; i++) {
    out += rng.pick(culture.onsets) + rng.pick(culture.vowels);
    if (i === n - 1 || rng.chance(0.3)) out += rng.pick(culture.codas);
  }
  return out;
}

/** Generates names, guaranteeing each is unique within one world. */
export class NameGenerator {
  private used = new Set<string>();

  constructor(private rng: Rng) {}

  private unique(make: () => string, maxLength = 13): string {
    for (let i = 0; i < 30; i++) {
      const name = make();
      if (name.length >= 3 && name.length <= maxLength && !this.used.has(name)) {
        this.used.add(name);
        return name;
      }
    }
    let n = 2;
    const base = make();
    while (this.used.has(`${base} ${n}`)) n++;
    this.used.add(`${base} ${n}`);
    return `${base} ${n}`;
  }

  country(culture: Culture): string {
    return this.unique(() =>
      capitalize(tidy(root(culture, this.rng, 1, 2) + this.rng.pick(culture.countrySuffixes))),
    );
  }

  region(culture: Culture): string {
    return this.unique(() =>
      capitalize(tidy(root(culture, this.rng, 1, 3) + this.rng.pick(culture.regionSuffixes))),
    );
  }

  city(culture: Culture): string {
    return this.unique(() => {
      const core = capitalize(
        tidy(
          root(culture, this.rng, 1, this.rng.chance(0.7) ? 1 : 2) +
            this.rng.pick(culture.citySuffixes),
        ),
      );
      if (!culture.cityPrefixes.length || !this.rng.chance(0.12)) return core;
      const prefix = this.rng.pick(culture.cityPrefixes);
      // "San Remo" keeps its capital; joined prefixes like "Novo" + "grad" do not.
      return prefix.endsWith(" ") ? `${prefix}${core}` : `${prefix}${core.toLowerCase()}`;
    });
  }

  sea(culture: Culture, kind: "ocean" | "sea" | "bay"): string {
    const core = capitalize(tidy(root(culture, this.rng, 1, 2)));
    if (kind === "ocean")
      return this.unique(
        () => `${adjective(capitalize(tidy(root(culture, this.rng, 1, 2))))} Ocean`,
        22,
      );
    if (kind === "bay")
      return this.unique(() => `Bay of ${capitalize(tidy(root(culture, this.rng, 1, 2)))}`, 22);
    return this.unique(
      () =>
        this.rng.chance(0.5)
          ? `${core} Sea`
          : `Sea of ${capitalize(tidy(root(culture, this.rng, 1, 2)))}`,
      22,
    );
  }
}
