# Design decisions

## Architecture

- **The simulation is headless.** `packages/sim` never imports UI or browser APIs (ESLint
  enforces this). The UI reads state and sends commands. The same engine will run on a
  multiplayer server.
- **Determinism.** All randomness comes from the seeded `Rng`; the simulation never reads the
  wall clock. The same seed and the same commands always produce the same game. A test checks
  that a game resumed from a save evolves identically to the original.
- **Keyed random streams.** World generation uses `Rng.fromKey(seed, "country:FRA")` and similar,
  so adding a new random property to one thing doesn't reshuffle everything else.
- **Commands.** Every state change goes through a validated, serializable `Command`, whether it
  comes from the player, the AI, or (later) a network client.
- **Systems.** Simulation logic lives in `System`s with hourly, daily, monthly and yearly hooks.
- **Time.** One tick is one in-game hour. The UI's `GameRunner` decides how many ticks run per
  real second (1x ≈ 12 s per day, 2x ≈ 6 s, 5x ≈ 2.4 s).
- **Money** is always stored as whole cents.

## Geography vs. world state

- `WorldGeography` is the static map: countries, provinces, neighbors, coastlines, cities and
  shapes. It is loaded from `data/geography/*.json` and is **never stored in saves**; saves
  reference it by id.
- `WorldState` is everything that changes: economies, governments, parties, population. It is
  stored in saves.
- The real-world map has ~7,300 main cities (Natural Earth) plus ~17,700 towns of 20,000+
  people (GeoNames), marked `minor`. Towns always exist in the simulation; the "Smaller towns"
  setting only controls whether the map and location lists show them. New towns are appended
  after existing cities so city ids in saves never change, and older saves get data for added
  towns generated on load. Temperance, Michigan is included by request despite its size.
- Both map types (real-world now, random in M8) produce the same `WorldGeography` structure, so
  nothing downstream knows which map it is on.

## Game modes

|                | Normal (Coming Soon)    | Economic                                      | Hard Economic                 |
| -------------- | ----------------------- | --------------------------------------------- | ----------------------------- |
| Start date     | Jan 2022 or Jan 2024    | Real date the save is created                 | Real date the save is created |
| World data     | Real US data            | Procedural                                    | Procedural                    |
| Map            | Real                    | Real or Random (Random: Coming Soon until M8) | Real only                     |
| Start location | Any of the 50 US states | Anywhere                                      | Anywhere                      |
| Money          | $2,000 or $0            | $2,000 or $0                                  | $0 (locked)                   |
| Home           | Parents' or homeless    | Parents' or homeless                          | Homeless (locked)             |
| Age            | 18                      | 18                                            | 18                            |

Mode rules live in `packages/sim/src/modes/modes.ts`, in one place. The wizard renders them
directly: one option means the choice is locked, and `available: false` shows "Coming Soon".
`validateConfig` rejects anything a mode doesn't allow, regardless of what the UI sends.

## Economic-mode world generation

On the real map, only geography comes from real data: borders, latitude, coastlines, and city
positions with their relative sizes. Everything economic and political is generated:

- **Development** (0–1) is random but smoothed across neighboring countries so rich and poor
  regions cluster, then spread back out by rank.
- **Government type** is weighted by development. Parties follow from the government type:
  democracies have 2–6, one-party states have 1, and juntas and absolute monarchies have only
  banned opposition parties.
- **Biomes** come from latitude plus noise, smoothed with neighbors. Resources are drawn per
  biome, and coastal provinces add fish.
- **Population**: each country's people are split into rural (spread over usable land) and urban
  (shared among its cities by their relative size on the map). A region's population is its rural
  share plus its cities, so big cities stay big even in tiny regions like Brussels. Countries full
  of large settlements get a population floor. Wages, rents and living costs follow from size and
  development.

## Saves

- Saves are stored in IndexedDB (browser or desktop webview), with a metadata store and a data
  store kept separate. They can be exported and imported as `.crsave.json` files.
- Every save carries a `version`. When `GameState` changes shape, bump `SAVE_VERSION` and add a
  migration in `save.ts`.
- An autosave is written at the start of each in-game month (it can be turned off in Settings).

## Life simulation (Phase 2)

- **Needs** run 0–100. Food, energy and hygiene decay every hour (the current activity scales the
  decay); health suffers when they bottom out; happiness drifts toward a target set by housing,
  work, debt and unmet needs. Energy at 0 forces a collapse; health at 0 forces a 3-day hospital
  stay, billed according to the country's healthcare system.
- **Activities** (`life/activities.ts`) are the player's verbs. Each one is data: duration,
  cost, opening hours, need effects, and start/hour/finish hooks. The UI lists them straight from
  that table and shows why an action is unavailable. Work shifts start automatically
  (interrupting things like sleep) unless the player turns that off.
- **Prices** are derived from each city's living costs, rent and median wage, which the economy
  updates monthly. Items and tuition cost a multiple of the local median hourly wage, so they feel
  the same in rich and poor places.
- **Jobs**: employers are generated per city when the player first lives there. A job search
  (once a day) applies to 3 random openings the player qualifies for; hiring odds depend on
  unemployment, hygiene, a phone, interview clothes, mood and being homeless. Many jobs need a
  mailing address; staying at a shelter provides one for 14 days.
- **Housing**: landlords want income of 2.5× rent and 30 days at a job, or parents willing to
  co-sign. Two missed rent payments mean eviction.
- **Economy** (`economy/economy.ts`) runs monthly for every country: business cycle phases,
  growth, unemployment, inflation, goods prices with supply shocks, wage and price indexes, and
  social classes whose satisfaction moves stability. Companies in cities the player has lived in
  grow, shrink, lay off workers, go bankrupt, and get founded.

## Balance

`npm run balance` plays a rule-based bot through Hard Economic and Economic starts in 8 cities
with 3 seeds and prints a table. `tools/sim/balance.test.ts` keeps the basics true in CI: a
homeless start is survivable, work is findable but not instant, and starting at home is easier.
