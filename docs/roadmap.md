# Roadmap

Each milestone ends with something playable.

## Phase 1: Foundation ✅

- [x] **M0 – Project setup**: npm workspaces, TypeScript, Vite, React, Vitest, ESLint, Prettier
- [x] **M1 – Menus, modes and core loop**: main menu, mode selection (Normal: Coming Soon),
      new-game wizard with locked options, character creation, hourly tick loop with
      pause/1x/2x/5x, command system, event bus, versioned saves with autosave, import and export
- [x] **M2 – Real-world map data**: Natural Earth pipeline (251 countries, 4,596 provinces,
      7,308 cities), procedural economies, governments and parties, location search
- [x] **M3 – World map view**: PixiJS map with pan and zoom, political, terrain, resources,
      wealth and stability modes, country and city labels, province, country and city info,
      map-based location picker

## Phase 2: First playable game ✅

- [x] **M4 – Character and survival**: needs (food, energy, hygiene, health, happiness),
      activities with opening hours and costs, collapse and hospital stays, parents with
      personalities and patience, estranged family for homeless starts, shelters, soup kitchens,
      food banks, street sleeping risks
- [x] **M5 – Jobs, skills and personal finance**: 36 occupations in 12 sectors, NPC employers,
      daily job search, offers, shifts and auto-work, missed shifts and firing, Friday paydays with
      income tax, promotions, 8 skills, 12 courses and credentials, shop items, renting (deposits,
      income and tenure checks, co-signers, eviction), payday and personal loans, medical debt,
      collections, credit score
- [x] **M6 – Economy foundation**: business cycles, growth, unemployment, inflation, goods prices
      with supply shocks, wages and city prices that follow the economy, social classes driving
      stability, companies that hire, lay off, go bankrupt and get founded, healthcare systems and
      social services
- [x] **M7 – First release build**: Tauri desktop app (Linux packages built locally once system
      libraries are installed, Windows via GitHub Actions), app icon, first-game tutorial,
      notifications and auto-pause, balance bot with automated difficulty tests

## Phase 3: Life and business ✅

- [x] **M8 – Random world map**: terrain, Voronoi provinces, generated countries and names
- [x] **M9 – Relationships and reputation**: NPCs met through work, school and activities;
      friends, partners and family; reputation with community, workers, business,
      establishment, activists and the underworld, plus fame
- [x] **M10 – Player companies**: founding, hiring, pricing, marketing, brand and
      bankruptcy
- [x] **M11 – Moving and immigration**: moving between cities, visas and citizenship

## Phase 4: Politics and power ✅

- [x] **M12 – Local politics**: parties, party ranks, city councils and mayors, filing,
      campaigning, fundraising, ads and elections
- [x] **M13 – Regional and national government**: regional councils, governors, legislatures
      (proportional seats), heads of government, bills, 14 policy levers and budgets
- [x] **M14 – Crime, corruption and law**: petty and organized crime, gangs, embezzlement and
      bribery, police heat, arrests, trials (plead, fight or bribe), fines, probation, prison,
      criminal records and scandals
- [x] **M15 – Events and narrative**: 23 story events with choices, some of which lead to
      follow-up events
- [x] **M16 – AI rivals**: political, business and criminal rivals who attack, poach and tip off
      the police; AI governments change policy in other countries

## Phase 5: Conflict and nation-building ✅

- [x] **M17 – Militias and territory control**: raise a militia, recruit, arm and train fighters,
      give orders (train, raid, dig in, lie low), seize regions, levy "revolutionary taxes",
      government crackdowns and arrests for insurrection; AI uprisings in unstable countries that
      can be crushed, overthrow the government or break away
- [x] **M18 – War and diplomacy**: armies, mobilization and war exhaustion, relations and
      alliances, AI wars over border regions, weekly battles with occupation, peace treaties that
      move borders, wartime economies; heads of government can improve relations, form alliances,
      declare war, make peace and set defense spending; Conflict map mode
- [x] **M19 – Founding new countries**: declare independence from militia-held territory, or
      win an independence referendum as a regional governor; choose the name and government;
      wars of independence; the founder becomes head of government of the new state
- [x] **M20 – Aging, death and succession**: health declines with age, age-based mortality,
      deadly collapses for older players, deaths in battle; parents and other people grow old and
      die (with inheritances); on death, continue as an adult child, a spouse or a distant
      relative, who inherits the estate (after inheritance tax), businesses and militia, and the
      throne in non-democracies

## Phase 6: Expansion

- [x] **Leader mode**: start as head of government of any country, without daily life;
      Government, Politics, Military and Region tabs; approval from how the country does;
      re-elections, lost majorities, revolutions and conquest end the rule, with a record of
      your time in office
- [x] **Country strategy in depth** (any head of government): budget priorities, credit
      ratings, debt interest and defaults, big projects, nationalization and tariffs; armor, air
      force, navy, conscription, research and generals with coups; war goals, stances and
      objectives, ceasefires, naval landings, forts and occupation resistance; non-aggression
      pacts, trade deals, sanctions, foreign aid and spy operations; Military map mode
- [x] **Economy-focused life**: living standards replace eating, sleeping and washing; nights
      pass on their own; savings, offshore accounts, stocks, government bonds and commodities on
      world markets; real estate with mortgages and tenants; party donations, lobbying and media
      outlets; supply chains, government contracts and stock market listings for businesses; net
      worth and a rich list
- [x] Character creation offers male and female
- [x] **0.3.1**: Spark, an in-game dating app; gender shown next to every name; parties grow
      city by city (volunteering, ads, rallies from 3%, town halls from 5%); fielding candidates
      needs 8% support in a city, 12% in a region and 25% nationally; candidates must campaign
      (20, 40 or 80 hours) or be dropped from the ballot
- [x] **0.3.3**: business owners pay themselves a salary (weekly, from the business); landlords,
      banks and lenders count steady income from a job, a business salary or tenants after 14
      days; running a business counts as working
- [ ] **M21 – Normal mode** (US data for 2022 and 2024, 50 states)
- [ ] **M22 – Modding support**
- [ ] **M23 – Multiplayer foundations**
- [ ] **M24 – Multiplayer gameplay**
