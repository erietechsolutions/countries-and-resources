# Countries & Resources

A single-player (multiplayer planned) life simulation and nation-building game. You start as an
18-year-old with little or nothing and rise through work, business, politics or revolution,
eventually founding and running your own country.

Runs in the browser today; desktop builds for Linux and Windows (Tauri) arrive in M7.

## Running the game

Requires Node.js 20 or newer (this machine has it through nvm: `nvm use`).

```sh
npm install        # first time only
npm run dev        # play at http://localhost:5173 with live reload
npm start          # production build, served at http://localhost:4173
```

Opening `dist/web/index.html` directly from disk does not work, because browsers block loading
the map data from `file://` pages. Use `npm start` (or any static file server) instead.

## Development

```sh
npm test           # simulation + map data tests
npm run typecheck  # TypeScript checks for all packages
npm run lint
npm run geodata    # rebuild data/geography/real-world.json from Natural Earth
```

## Project layout

```
packages/sim/   Headless game engine: no UI or browser code (enforced by lint), so it can run
                on a multiplayer server later. Seeded RNG, calendar, commands, systems,
                world generation, saves.
packages/ui/    React + PixiJS client: menus, new-game wizard, world map, game screen.
data/           Static game content served to the client (map geography today).
tools/geodata/  Pipeline that builds the real-world map from Natural Earth data.
docs/           Design decisions and the roadmap.
```

See [docs/design.md](docs/design.md) for how the pieces fit together and
[docs/roadmap.md](docs/roadmap.md) for what is built and what comes next.

Map data © [Natural Earth](https://www.naturalearthdata.com) (public domain).
