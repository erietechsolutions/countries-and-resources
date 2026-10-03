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
- **Population** is spread over habitable land; city sizes, wages, rents and living costs follow
  from that.

## Saves

- Saves are stored in IndexedDB (browser or desktop webview), with a metadata store and a data
  store kept separate. They can be exported and imported as `.crsave.json` files.
- Every save carries a `version`. When `GameState` changes shape, bump `SAVE_VERSION` and add a
  migration in `save.ts`.
- An autosave is written at the start of each in-game month (it can be turned off in Settings).
