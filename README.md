# Countries & Resources

A single-player (multiplayer planned) life simulation and nation-building game. You start as an
18-year-old with little or nothing and rise through work, business, politics or revolution,
eventually founding and running your own country.

Runs in the browser, or as a desktop app for Linux and Windows (built with Tauri).

## Running the game

Requires Node.js 20 or newer (this machine has it through nvm: `nvm use`).

```sh
npm install        # first time only
npm run dev        # play at http://localhost:5173 with live reload
npm start          # production build, served at http://localhost:4173
```

Opening `dist/web/index.html` directly from disk does not work, because browsers block loading
the map data from `file://` pages. Use `npm start` (or any static file server) instead.

## Desktop app (Linux and Windows)

The desktop app wraps the same game in a native window using [Tauri](https://tauri.app).

**One-time setup on Fedora** (Rust is already installed):

```sh
sudo dnf install webkit2gtk4.1-devel librsvg2-devel libappindicator-gtk3-devel dbus-devel
```

Run these from a regular terminal (e.g. Konsole), not VS Code's built-in terminal: the Flatpak
version of VS Code runs inside a sandbox that can't see system libraries.

```sh
nvm use                 # Node 24
npm run desktop:dev     # open the game in a desktop window with live reload
npm run desktop:build   # build installers (.rpm, .deb, .AppImage) into
                        # apps/desktop/src-tauri/target/release/bundle/
```

**On CachyOS / Arch** the one-time setup is
`sudo pacman -S --needed webkit2gtk-4.1 base-devel curl wget file openssl librsvg libappindicator-gtk3 xdotool patchelf rustup nodejs-lts-krypton npm`
followed by `rustup default stable`.

**Windows installers** have to be built on Windows. Either run `npm run desktop:build` on a
Windows PC (with Rust and Node installed), or push the project to GitHub and let
`.github/workflows/desktop.yml` build Linux and Windows installers automatically (run it from the
Actions tab, or push a tag like `v0.2.0`).

## Releases and updates

Releases are built by GitHub Actions and published on the repository's Releases page: a Linux
AppImage (plus .deb and .rpm) and Windows installers. Installed copies check that page from the
main menu and offer to update themselves. Updates are signed, so only builds made with the
project's private key are accepted.

To publish a new version:

1. Bump `version` in the root `package.json` (the desktop app reads it from there), then run
   `npm install` so the lockfile matches.
2. Commit, then tag and push: `git tag v0.3.0 && git push origin main v0.3.0`.
3. The **Desktop builds** workflow builds, signs and publishes the release (about 15 minutes).

The workflow needs two repository secrets: `TAURI_SIGNING_PRIVATE_KEY` (the contents of
`~/.tauri/countries-and-resources.key`) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (empty). Keep a
backup of that key: without it, existing installs can't receive updates.

## Development

```sh
npm test           # simulation + map data tests
npm run typecheck  # TypeScript checks for all packages
npm run lint
npm run geodata    # rebuild data/geography/real-world.json from Natural Earth
npm run balance    # bots play 180 days in 8 cities; prints a difficulty report
npx tsx tools/sim/politicsCareer.ts 6   # bots try a 6-year political career
npx tsx tools/sim/worldHistory.ts 15    # the AI world runs 15 years: wars, uprisings, new countries
```

## Project layout

```
packages/sim/   Headless game engine: no UI or browser code (enforced by lint), so it can run
                on a multiplayer server later. Seeded RNG, calendar, commands, systems,
                world generation, saves.
packages/ui/    React + PixiJS client: menus, new-game wizard, world map, game screen.
apps/desktop/   Tauri desktop wrapper (Rust shell, icons, installer config).
data/           Static game content served to the client (map geography today).
tools/geodata/  Pipeline that builds the real-world map from Natural Earth data.
tools/sim/      Balance and politics bots and their reports.
docs/           Design decisions and the roadmap.
```

See [docs/design.md](docs/design.md) for how the pieces fit together and
[docs/roadmap.md](docs/roadmap.md) for what is built and what comes next.

Map data © [Natural Earth](https://www.naturalearthdata.com) (public domain). Towns © [GeoNames](https://www.geonames.org) ([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)).
