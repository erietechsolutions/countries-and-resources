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

|                | Normal (Coming Soon)    | Economic                      | Hard Economic                 | Leader                         |
| -------------- | ----------------------- | ----------------------------- | ----------------------------- | ------------------------------ |
| Start date     | Jan 2022 or Jan 2024    | Real date the save is created | Real date the save is created | Real date the save is created  |
| World data     | Real US data            | Procedural                    | Procedural                    | Procedural                     |
| Map            | Real                    | Real or Random                | Real only                     | Real or Random                 |
| Start location | Any of the 50 US states | Anywhere                      | Anywhere                      | Capital of any country         |
| Money          | $2,000 or $0            | $2,000 or $0                  | $0 (locked)                   | None (the country's budget)    |
| Home           | Parents' or homeless    | Parents' or homeless          | Homeless (locked)             | None                           |
| Age            | 18                      | 18                            | 18                            | 50, already head of government |

Mode rules live in `packages/sim/src/modes/modes.ts`, in one place. The wizard renders them
directly: one option means the choice is locked, and `available: false` shows "Coming Soon".
`validateConfig` rejects anything a mode doesn't allow, regardless of what the UI sends.

### Leader mode

Leader mode (`leader/leader.ts`) runs the same engine without the player's personal life:
`systemsFor` leaves out needs and activities, jobs, personal finance, housing, family,
immigration, social life, player businesses, personal crime and life story events. The player
starts in the capital as head of government of the chosen country, leading its ruling party.
Approval follows the country (national mood, stability, the economy and war), and in Leader mode
the player's party gains or loses support with their approval, with some fatigue the longer it
rules. A sitting leader is automatically on the ballot for their own re-election. The rule ends
when the player no longer holds the office: a lost presidential election, a lost legislature, a
revolution, conquest, or death without a hereditary successor. `state.reign` records the
country's vital signs at the start, and the game shows the record against them.

## Living standards (0.3.0)

Daily survival is gone. The player picks a lifestyle (frugal, modest, comfortable, luxury) whose
daily cost is a multiple of local living costs (less at a parent's house or without a home).
It sets the health the player drifts toward (capped by age), their presentation (stored as
`needs.hygiene`, which employers check) and a happiness bonus. If money runs out the lifestyle
steps down, and below frugal the player "goes without" for the day, which hurts health,
presentation and mood. Food and energy are fixed. Nights start automatically at 11 PM when the
player is idle; work shifts and anything the player starts interrupt them. Critical health
(under 5) means hospital.

## Wealth (0.3.0)

`wealth/markets.ts` keeps a stock index per country (monthly returns from growth, the
business cycle, war and stability, with more volatility in poorer countries), commodity prices
(mean-reverting, with war shocks for energy and gold) and a rich list generated from the world
seed. `wealth/wealth.ts` holds the player's savings, offshore money, holdings, properties and
media outlets. Units of stocks and commodities are priced at $100 × the index or price level;
bonds pay their country's yield (inflation plus a risk premium) and can default. Gains are taxed
at half the income tax rate when sold. Property values follow city rents; a property is worth
about ten years of its rent, and rents out for about 1/160 of its value a month. Influence
spending works through existing systems: donations shift party popularity, lobbying calls
`createBill` with an NPC sponsor, and media outlets nudge a party's support each month.

## Statecraft (0.3.0)

`statecraft/statecraft.ts` adds the levers a head of government pulls directly, beyond laws.
A country's `statecraft` record is created only when its leader first changes something (or it
defaults), so AI countries run on normal settings, and the UI reads defaults through
`readStatecraft` without creating anything. Every army is created when a game loads for the same
reason: looking at a country must never change the simulation. Spending above normal and project
installments go into `runBudget`; interest follows a credit rating once a country has a
statecraft record. A country defaults when interest exceeds 35% of revenue (debt halved, five
years of recovery). Army power counts infantry, armor (×20), aircraft (×60), technology and the
best general. Landings across the sea need warships. Each month, disloyal generals in an unstable
country may stage a coup; unstable AI autocracies also see occasional coups.

## Grassroots politics and dating (0.3.1)

- A party's support in a city or region is its national popularity plus support built there
  (`politics.localSupport`, keyed "city:12|party"). Volunteering, ad campaigns, rallies and town
  halls add to the player's city, and 40% as much to its region. Gains shrink as support grows
  (no gain left near 25%), the built support fades 6% a month, and it nudges national popularity.
  Built support also counts in city and regional elections.
- To field candidates, a party needs 8% support in the city (city offices), 12% in the region
  (regional offices) or 25% nationally (national offices). Sitting officeholders seeking
  re-election are exempt. A candidate must campaign 20, 40 or 80 hours by election day (city,
  region, national) or is dropped from the ballot, with a warning two weeks before.
- Spark (`social/dating.ts`) offers fresh profiles each morning (5, or 12 with Premium). A like
  becomes a match with a chance based on presentation, happiness, fame, a job, lifestyle and
  Premium; a match is created as a Person the player can ask out.

## Income landlords and lenders accept (0.3.3)

`finance/income.ts` decides what counts as income. A job counts after 14 days. A business owner
sets a monthly salary, paid weekly on Fridays from the company's cash and taxed like wages; it
counts once it has been paid for 14 days without a miss (a missed payday or a change of amount
restarts the record), and only up to what the business earns (its recent average monthly
profit, or a third of its cash before it has a month of results). Rent from tenants counts too.
Landlords want 2.5× the rent, mortgages 2.5× the payment, and personal loans steady income;
payday lenders accept any paycheck, including an owner's salary. Running a business also counts
as working for parents, happiness and dating.

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

- Character creation offers male and female. Saves holding the former third option map it to
  one of the two, decided by a hash of the character's id.
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

## Life, business and politics (Phases 3–4)

- **People** (`social/`): NPCs are created when the player meets them and stay in the save.
  Relationships have a kind (acquaintance, friend, partner, family, rival) and a strength that
  fades without contact. Reputation is tracked with six groups, plus fame.
- **Businesses** (`business/`): player companies run monthly: revenue from local demand, price
  and brand, wages and rent. Running out of cash means bankruptcy.
- **Politics** (`politics/`): offices are created per country the first time politics is needed.
  Democracies hold elections, while other governments appoint office holders. When a country's
  government type changes, its offices gain or lose elections. Single-seat races have a party
  primary. Multi-seat councils use open lists, so a party's vote is split across its slate and
  the player competes with their own party's candidates for its seats. Player appeal comes from
  reputation, fame, campaign effort and ads, with diminishing returns. Legislatures are
  allocated by largest remainder, and in parliamentary systems the biggest party's leader
  becomes head of government. Office holders can propose bills that change policy levers.
- **Crime** (`crime/`): each crime has a detection chance that grows with police heat and the
  country's policing and falls with gang rank. An arrest opens a case that the player can plead,
  fight or try to bribe. Sentences scale with the record. Undetected crimes can become secrets
  that surface later as scandals.
- **Story events** (`events/storyEvents.ts`): each day has a small chance of an event whose
  `setup` returns data (or null when it doesn't apply). The game pauses for the choice. Choices
  can be blocked and can schedule follow-up events. If the player doesn't choose, the event
  resolves to its default choice after 3 days.
- **Rivals** (`ai/rivals.ts`): spawned from the strongest opponent in the player's race, a
  competitor of a successful business, or a crime boss. They act on a cooldown with utility-based
  moves scaled by hostility. Each year, ruling parties in other countries enact policies that
  match their ideology.

## Conflict and nation-building (Phase 5)

- **Borders change, the map file doesn't.** Each `Game` builds a live copy of the static map
  (`world/territory.ts`): a shallow copy that shares shapes and borders, with the save's
  `provinceOwners` and `foundedCountries` applied. Everything that asks which country a city is
  in keeps working unchanged. `transferProvince` is the one way borders move: it updates the
  live map, populations and capitals, drops the old country's city and regional offices (the new
  owner sets up its own), and moves the player's legal status if their home changes hands. A
  country's capital is its original one while it holds it, otherwise its largest city, so
  capitals come out the same after a reload. The map outlines regions that changed hands and
  re-places country names.
- **Militias** (`conflict/militia.ts`) fight local garrisons, whose strength comes from the
  region's population, the rule of law and stability, and grows as the government's crackdown
  escalates. Attacks take 3 days. Leading from the front adds strength but risks wounds or death.
  Holding regions brings recruits and taxes, and draws counterattacks. AI **uprisings** start in
  countries below 20 stability and face police and part of the national army. They are crushed,
  take the whole country (a junta takes over), or break away after a year holding a quarter of it.
- **Wars** (`conflict/war.ts`) fight one battle a week along the front: the stronger side (army
  size, quality, mobilization, stability, exhaustion) takes or liberates a region next to land it
  holds, or lands on a coast. The score is the share of each side's people under occupation.
  At peace, attackers keep occupied regions they claimed (everything they hold if the score is
  60+, or on capitulation); a breakaway state fights to survive and never annexes its parent.
  AI countries go to war over border regions when relations are bad and they are much stronger;
  at most 3 AI wars run at once. Relations default to ideological and governmental similarity
  and drift back after changes. Only the head of government can conduct the player's diplomacy.
- **New countries** (`conflict/nation.ts`) inherit their parent's economy and institutions,
  get new parties (plus the founder's own) and a government chosen by the founder. The parent
  may accept the split or fight a war of independence.
- **Aging and death** (`life/aging.ts`): health is capped from age 45, and the yearly chance of
  death rises steeply with age (worse in poor health or without healthcare). Time stops while
  the player is dead; `succession.choose` continues as an heir. Debts are settled from the
  estate, spouses pay no inheritance tax, and a distant relative is always available. In
  non-democracies, a head of government's heir inherits the office.
- `npx tsx tools/sim/worldHistory.ts [years] [seeds]` lets the AI world run and reports its wars,
  uprisings and new countries. Over 15 years expect roughly 1–5 wars and 0–2 new countries.

## Balance

`npm run balance` plays a rule-based bot through Hard Economic and Economic starts in 8 cities
with 3 seeds and prints a table. `tools/sim/balance.test.ts` keeps the basics true in CI: a
homeless start is survivable, work is findable but not instant, and starting at home is easier.

`npx tsx tools/sim/politicsCareer.ts [years]` gives bots political ambition in 6 democracies and
reports races, wins, primaries and party rank. A bot that always joins the most popular party and
campaigns flat out wins about 85% of its races over 6 years. That is the upper bound, and normal
play should do worse.
