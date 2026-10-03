import { useEffect, useMemo, useState } from "react";
import {
  APPEARANCE_OPTIONS,
  buildWorld,
  createNewGame,
  defaultChoice,
  formatDate,
  formatMoney,
  gameDateFromRealDate,
  MODE_ORDER,
  MODES,
  NAME_LIMIT,
  NewGameError,
  randomName,
  randomSeed,
  Rng,
  validateCharacterInput,
  type AppearanceKey,
  type CharacterInput,
  type CityId,
  type Game,
  type GameConfig,
  type GameMode,
  type Gender,
  type MapType,
  type ProvinceId,
  type StartingHousing,
  type WorldGeography,
} from "@cr/sim";
import { Avatar } from "../components/Avatar";
import { CitySummary, CountryCard, ProvinceCard } from "../components/InfoCards";
import { OptionCards } from "../components/OptionCards";
import { geographyIdFor, loadGeography } from "../data/geography";
import { MapView, type FocusRequest } from "../map/MapView";
import { useSettings } from "../storage/settings";

type Step = "mode" | "start" | "location" | "character" | "review";
const STEPS: { id: Step; label: string }[] = [
  { id: "mode", label: "Mode" },
  { id: "start", label: "Start" },
  { id: "location", label: "Location" },
  { id: "character", label: "Character" },
  { id: "review", label: "Review" },
];

const GENDERS: { value: Gender; label: string }[] = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "nonbinary", label: "Non-binary" },
];

const APPEARANCE_LABELS: Record<AppearanceKey, string> = {
  skinTone: "Skin tone",
  hairColor: "Hair color",
  hairStyle: "Hair style",
  eyeColor: "Eye color",
  build: "Build",
};

const uiRandom = () => new Rng(randomSeed(Math.random));

function randomCharacter(): CharacterInput {
  const rng = uiRandom();
  const gender = rng.pick<Gender>(["female", "male", "nonbinary"]);
  const appearance = Object.fromEntries(
    (Object.keys(APPEARANCE_OPTIONS) as AppearanceKey[]).map((k) => [
      k,
      rng.pick(APPEARANCE_OPTIONS[k]),
    ]),
  ) as CharacterInput["appearance"];
  return { ...randomName(gender, rng), gender, appearance };
}

interface Props {
  onCancel(): void;
  onStart(game: Game): void;
}

export function NewGameWizard({ onCancel, onStart }: Props) {
  const [step, setStep] = useState<Step>("mode");
  const [mode, setMode] = useState<GameMode>("economic");
  const [mapType, setMapType] = useState<MapType>("real");
  const [cash, setCash] = useState(200_000);
  const [housing, setHousing] = useState<StartingHousing>("parents");
  const [seed, setSeed] = useState(() => randomSeed(Math.random));
  const [cityId, setCityId] = useState<CityId | null>(null);
  const [character, setCharacter] = useState<CharacterInput>(randomCharacter);
  const [geography, setGeography] = useState<WorldGeography | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);

  const def = MODES[mode];

  useEffect(() => {
    let cancelled = false;
    setGeography(null);
    loadGeography(geographyIdFor(mapType))
      .then((g) => !cancelled && setGeography(g))
      .catch(
        (e: unknown) => !cancelled && setLoadError(e instanceof Error ? e.message : String(e)),
      );
    return () => {
      cancelled = true;
    };
  }, [mapType]);

  const chooseMode = (m: GameMode) => {
    const d = MODES[m];
    setMode(m);
    setMapType(defaultChoice(d.mapTypes));
    setCash(defaultChoice(d.startingCash));
    setHousing(defaultChoice(d.startingHousing));
  };

  /** The world as it will be generated, so the location picker can show real numbers. */
  const world = useMemo(() => {
    if (!geography) return null;
    const preview: GameConfig = {
      mode,
      mapType,
      geographyId: geography.id,
      worldSeed: seed,
      startTime: 0,
      startingCashCents: cash,
      startingHousing: housing,
      startCityId: 0,
    };
    return buildWorld(preview, geography);
    // Only the mode's data source and the seed affect the generated world.
  }, [geography, seed, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const characterErrors = validateCharacterInput(character);
  const stepIndex = STEPS.findIndex((s) => s.id === step);
  const canAdvance =
    (step === "mode" && def.available) ||
    step === "start" ||
    (step === "location" && cityId !== null) ||
    (step === "character" && characterErrors.length === 0);

  const start = () => {
    if (!geography || !world || cityId === null) return;
    const config: GameConfig = {
      mode,
      mapType,
      geographyId: geography.id,
      worldSeed: seed,
      // Economic modes start on the real date the save is created.
      startTime: gameDateFromRealDate(new Date()),
      startingCashCents: cash,
      startingHousing: housing,
      startCityId: cityId,
    };
    try {
      onStart(createNewGame({ config, character }, geography, world));
    } catch (e) {
      setProblems(e instanceof NewGameError ? e.problems : [String(e)]);
    }
  };

  return (
    <div className="page wizard">
      <header className="page-head">
        <button className="btn" onClick={onCancel}>
          ← Main Menu
        </button>
        <h2>New Game</h2>
        <ol className="stepper">
          {STEPS.map((s, i) => (
            <li
              key={s.id}
              className={i === stepIndex ? "current" : i < stepIndex ? "done" : undefined}
            >
              <span className="step-num">{i + 1}</span>
              {s.label}
            </li>
          ))}
        </ol>
      </header>

      <div className={step === "location" ? "page-body full" : "page-body"}>
        {step === "mode" && <ModeStep mode={mode} onChoose={chooseMode} />}
        {step === "start" && (
          <div className="narrow">
            <h3 className="step-title">Starting conditions</h3>
            <p className="muted">
              You start at 18 years old on{" "}
              <strong>{formatDate(gameDateFromRealDate(new Date()))}</strong>, the day this save is
              created.
            </p>
            <OptionCards<MapType>
              label="World map"
              lockedReason={`Locked in ${def.name}`}
              options={def.mapTypes}
              value={mapType}
              onChange={setMapType}
            />
            <OptionCards<number>
              label="Starting money"
              lockedReason={`Locked in ${def.name}`}
              options={def.startingCash}
              value={cash}
              onChange={setCash}
            />
            <OptionCards<StartingHousing>
              label="Starting home"
              lockedReason={`Locked in ${def.name}`}
              options={def.startingHousing}
              value={housing}
              onChange={setHousing}
            />
            <fieldset className="option-group">
              <legend>World seed</legend>
              <div className="row">
                <input
                  className="input mono"
                  inputMode="numeric"
                  value={seed}
                  aria-label="World seed"
                  onChange={(e) => {
                    const v = Number(e.target.value.replace(/\D/g, "").slice(0, 10));
                    setSeed(Math.min(v, 0xffffffff));
                  }}
                />
                <button className="btn" onClick={() => setSeed(randomSeed(Math.random))}>
                  🎲 Randomize
                </button>
              </div>
              <p className="muted small">
                The seed decides every country's economy, government and parties. Share it to play
                the same world.
              </p>
            </fieldset>
          </div>
        )}
        {step === "location" &&
          (geography && world ? (
            <LocationStep geography={geography} world={world} cityId={cityId} onCity={setCityId} />
          ) : (
            <div className="center muted">{loadError ?? "Loading the world map…"}</div>
          ))}
        {step === "character" && (
          <CharacterStep character={character} onChange={setCharacter} errors={characterErrors} />
        )}
        {step === "review" && geography && world && cityId !== null && (
          <div className="narrow review">
            <h3 className="step-title">Ready to begin</h3>
            <div className="review-grid">
              <Avatar appearance={character.appearance} size={120} />
              <dl>
                <dt>Name</dt>
                <dd>
                  {character.firstName} {character.lastName}, age 18
                </dd>
                <dt>Mode</dt>
                <dd>{def.name}</dd>
                <dt>World</dt>
                <dd>
                  {def.mapTypes.find((m) => m.value === mapType)?.label} · seed{" "}
                  <span className="mono">{seed}</span>
                </dd>
                <dt>Start date</dt>
                <dd>{formatDate(gameDateFromRealDate(new Date()))}</dd>
                <dt>Money</dt>
                <dd>{formatMoney(cash)}</dd>
                <dt>Home</dt>
                <dd>{def.startingHousing.find((h) => h.value === housing)?.label}</dd>
              </dl>
            </div>
            <CitySummary geo={geography} world={world} cityId={cityId} />
            {problems.length > 0 && (
              <ul className="error-text">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <footer className="wizard-foot">
        <button
          className="btn"
          disabled={stepIndex === 0}
          onClick={() => setStep(STEPS[stepIndex - 1]!.id)}
        >
          Back
        </button>
        {step === "review" ? (
          <button className="btn primary large" onClick={start}>
            Start Game
          </button>
        ) : (
          <button
            className="btn primary"
            disabled={!canAdvance}
            onClick={() => setStep(STEPS[stepIndex + 1]!.id)}
          >
            {step === "location" && cityId === null ? "Choose a city to continue" : "Next"}
          </button>
        )}
      </footer>
    </div>
  );
}

function ModeStep({ mode, onChoose }: { mode: GameMode; onChoose(m: GameMode): void }) {
  return (
    <div className="mode-cards">
      {MODE_ORDER.map((id) => {
        const m = MODES[id];
        const facts = [
          m.startDate === "historical"
            ? `Start: ${m.historicalStartDates?.map((d) => d.label).join(" or ")}`
            : "Start: the day you create the save",
          m.worldData === "historical"
            ? "Real-world economic data"
            : "Generated economies and politics",
          m.startRegion === "unitedStates"
            ? "Start in any of the 50 US states"
            : "Start anywhere in the world",
          `Money: ${m.startingCash.map((c) => c.label).join(" or ")}`,
          `Home: ${m.startingHousing.map((h) => h.label).join(" or ")}`,
          `Map: ${m.mapTypes.map((t) => t.label).join(" or ")}`,
        ];
        return (
          <button
            key={id}
            className={`mode-card${mode === id ? " selected" : ""}${m.available ? "" : " disabled"}`}
            disabled={!m.available}
            aria-pressed={mode === id}
            onClick={() => onChoose(id)}
          >
            {!m.available && <span className="ribbon">{m.unavailableLabel}</span>}
            <span className="mode-name">{m.name}</span>
            <span className="mode-tagline">{m.tagline}</span>
            <span className="mode-desc">{m.description}</span>
            <ul>
              {facts.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </button>
        );
      })}
    </div>
  );
}

interface LocationProps {
  geography: WorldGeography;
  world: NonNullable<ReturnType<typeof buildWorld>>;
  cityId: CityId | null;
  onCity(id: CityId | null): void;
}

function normalize(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function LocationStep({ geography, world, cityId, onCity }: LocationProps) {
  const initialCity = cityId !== null ? geography.cities[cityId] : undefined;
  const [provinceId, setProvinceId] = useState<ProvinceId | null>(initialCity?.provinceId ?? null);
  const [query, setQuery] = useState("");
  const [focus, setFocus] = useState<FocusRequest | null>(
    initialCity ? { x: initialCity.x, y: initialCity.y, zoom: 8, key: 0 } : null,
  );
  const { showTowns } = useSettings();
  const habitable = useMemo(
    () => new Set(geography.countries.filter((c) => c.habitable).map((c) => c.id)),
    [geography],
  );
  const searchIndex = useMemo(
    () => ({
      cities: geography.cities
        .filter((c) => habitable.has(c.countryId) && (showTowns || !c.minor))
        .map((c) => ({ c, key: normalize(c.name) })),
      countries: geography.countries
        .filter((c) => c.habitable)
        .map((c) => ({ c, key: normalize(c.name) })),
    }),
    [geography, habitable, showTowns],
  );

  const results = useMemo(() => {
    const q = normalize(query.trim());
    if (q.length < 2) return null;
    const countries = searchIndex.countries
      .filter((x) => x.key.includes(q))
      .slice(0, 4)
      .map((x) => x.c);
    const cities = searchIndex.cities
      .filter((x) => x.key.includes(q))
      .sort(
        (a, b) =>
          Number(b.key.startsWith(q)) - Number(a.key.startsWith(q)) ||
          b.c.importance - a.c.importance,
      )
      .slice(0, 10)
      .map((x) => x.c);
    return { countries, cities };
  }, [query, searchIndex]);

  const province = provinceId !== null ? geography.provinces[provinceId] : undefined;
  const countryId = province?.countryId ?? null;

  const selectCity = (id: CityId, zoom = 8) => {
    const city = geography.cities[id]!;
    if (!habitable.has(city.countryId)) return;
    onCity(id);
    setProvinceId(city.provinceId);
    setFocus({ x: city.x, y: city.y, zoom, key: Date.now() });
  };

  const surprise = () => {
    const rng = uiRandom();
    const options = searchIndex.cities.map((x) => [x.c.id, x.c.importance - 2.5] as const);
    selectCity(rng.weighted(options));
  };

  return (
    <div className="location-step">
      <aside className="side-panel">
        <div className="search">
          <input
            className="input"
            placeholder="Search cities and countries…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search locations"
          />
          <button className="btn" onClick={surprise} title="Pick a random city">
            🎲
          </button>
        </div>
        {results && (
          <ul className="search-results">
            {results.countries.map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => {
                    setQuery("");
                    if (c.capitalCityId !== null) {
                      const cap = geography.cities[c.capitalCityId]!;
                      setProvinceId(cap.provinceId);
                      setFocus({ x: cap.x, y: cap.y, zoom: 3, key: Date.now() });
                    }
                  }}
                >
                  <strong>{c.name}</strong> <span className="muted small">Country</span>
                </button>
              </li>
            ))}
            {results.cities.map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => {
                    setQuery("");
                    selectCity(c.id);
                  }}
                >
                  <strong>{c.name}</strong>{" "}
                  <span className="muted small">
                    {geography.provinces[c.provinceId]!.name},{" "}
                    {geography.countries.find((k) => k.id === c.countryId)?.name}
                  </span>
                </button>
              </li>
            ))}
            {results.countries.length + results.cities.length === 0 && (
              <li className="muted small">No matches.</li>
            )}
          </ul>
        )}
        {cityId !== null ? (
          <section className="card highlight">
            <h4>Your starting city</h4>
            <CitySummary geo={geography} world={world} cityId={cityId} />
          </section>
        ) : (
          <p className="hint">
            Search, or click the map to explore. Then pick the city where your story begins.
          </p>
        )}
        {provinceId !== null && (
          <ProvinceCard
            geo={geography}
            world={world}
            provinceId={provinceId}
            selectedCityId={cityId}
            onSelectCity={(id) => selectCity(id, 0)}
            cityActionLabel="Start here"
          />
        )}
        {countryId && <CountryCard geo={geography} world={world} countryId={countryId} />}
      </aside>
      <MapView
        geography={geography}
        world={world}
        selection={{ provinceId, countryId, cityId }}
        focus={focus}
        onProvinceClick={setProvinceId}
        onCityClick={(id) => selectCity(id, 0)}
      />
    </div>
  );
}

function CharacterStep({
  character,
  onChange,
  errors,
}: {
  character: CharacterInput;
  onChange(c: CharacterInput): void;
  errors: string[];
}) {
  const set = (patch: Partial<CharacterInput>) => onChange({ ...character, ...patch });
  return (
    <div className="narrow character-step">
      <h3 className="step-title">Who are you?</h3>
      <div className="character-grid">
        <div className="portrait">
          <Avatar appearance={character.appearance} size={180} />
          <button className="btn" onClick={() => onChange(randomCharacter())}>
            🎲 Randomize everything
          </button>
        </div>
        <div className="form">
          <div className="row">
            <label className="field">
              <span>First name</span>
              <input
                className="input"
                maxLength={NAME_LIMIT}
                value={character.firstName}
                onChange={(e) => set({ firstName: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Last name</span>
              <input
                className="input"
                maxLength={NAME_LIMIT}
                value={character.lastName}
                onChange={(e) => set({ lastName: e.target.value })}
              />
            </label>
            <button
              className="btn align-end"
              title="Random name"
              onClick={() => set(randomName(character.gender, uiRandom()))}
            >
              🎲
            </button>
          </div>
          <div className="field">
            <span>Gender</span>
            <div className="segmented" role="radiogroup" aria-label="Gender">
              {GENDERS.map((g) => (
                <button
                  key={g.value}
                  role="radio"
                  aria-checked={character.gender === g.value}
                  className={character.gender === g.value ? "active" : undefined}
                  onClick={() => set({ gender: g.value })}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>
          <div className="appearance-grid">
            {(Object.keys(APPEARANCE_OPTIONS) as AppearanceKey[]).map((key) => (
              <label key={key} className="field">
                <span>{APPEARANCE_LABELS[key]}</span>
                <select
                  className="input"
                  value={character.appearance[key]}
                  onChange={(e) =>
                    set({
                      appearance: {
                        ...character.appearance,
                        [key]: e.target.value,
                      } as CharacterInput["appearance"],
                    })
                  }
                >
                  {APPEARANCE_OPTIONS[key].map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          {errors.length > 0 && <p className="error-text small">{errors.join(" ")}</p>}
        </div>
      </div>
    </div>
  );
}
