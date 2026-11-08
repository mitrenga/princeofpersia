# princeofpersia

Browser remake of **Prince of Persia** (DOS, 1990) on the svision library,
VGA platform 320x200 in 256 colours. The brief and the fidelity target are in
`ZADANI.md`, the milestones in `MILNIKY.md`, the format findings in
`NOTES.md` (all three in Czech, as the project's working documents are).

## Status

M0 (sources) and P1 (data extraction) done; P2 (rendering), P3 (the
prince's physics) and P4 (the tile mechanisms) coded and verified under
Node, each waiting for its golden record: DOSBox screenshots of rooms
(`sources/media/rooms/README.md`) and traces from a patched SDLPoP
(`sources/media/physics/README.md`). The application boots and the prince
runs, jumps, climbs and falls through the levels under the original's
physics; gates, buttons, loose floors, spikes, chompers and the level door
work and the clock runs; the sounds play as the original ordered them
(P6, samples only — the AdLib music waits for a decision on how to play
it); guards (P5) are not there yet.

## Original data

The game needs the data files of a legally owned copy of the DOS 1.0
release. Put them into `assets/original/` — the list and the version check
are in `assets/original/README.md`. They never enter the repository; what
does is `data/`, the unpacked open form (ask before committing it).

## Running

Like every svision project: `index.php` → `app/svision/php/main.php`,
`config/config.php` with `$devMode = true` serves the sources as they are,
no build step. The game runs in a web worker glued at run time from the
modules listed in `config/compile.json` (`standalone`) — see
`app/WORKER-PROTOCOL.md`.

Keys: the original's — cursor keys or the numeric keypad (7/9 jump, 1/3
step down), Shift for the careful step, grabbing and picking up; `+` / `-`
change the level and `B` boots again (debugging, until P7). Any key skips
the boot.

## Tools

All tools run under Node from the project root and import the game code
directly (`app/svision/tools/nodeEnv.mjs` first).

| tool | what it does |
|---|---|
| `node tools/dumpdat.mjs [--only gfx\|levels\|sounds\|tables]` | unpacks `assets/original/*.DAT` into `data/` following `tools/dumpdat.spec.json` |
| `node tools/checkdat.mjs [-v] [--encode]` | round trip: `data/` back to bytes against the resources, checksums, decoders; `--encode` also measures our packers |
| `node tools/renderlevel.mjs [--level N] [--out png] [--rooms dir]` | draws a level with the game's room drawer into `build/levelNN.png`, optionally one PNG per room |
| `node tools/matchrooms.mjs [--dir sources/media/rooms] [-v]` | DOSBox screenshots of rooms against our drawing, pixel by pixel; masks for the prince in `masks.json`; difference pictures in `build/matchrooms/` |
| `node tools/tracephysics.mjs --script tools/scripts/x.json [--print] [--png file]` | runs the prince through an input script headless and writes what he did, optionally as a strip of pictures |
| `node tools/matchphysics.mjs [--dir sources/media/physics] [-v]` | SDLPoP traces (recorded with `tools/sdlpop-trace.patch`) against our physics, frame by frame |

`tools/lib/datlib.mjs` holds the DAT container, image, palette and sound
codecs; `tools/lib/renderlib.mjs` loads a level the way the worker does;
`tools/lib/physlib.mjs` drives the game worker headless.
The shared PNG encoder and decoder live in `svision/tools/retro/png.mjs`.

## Sources

`sources/README.md` — where from, when, with which hash. The SDLPoP and
Apple II reference sources are in `sources/reference/`, stripped of game data.

## ⚠ Open issue — game data (data/)

The game's data in `data/` is derived from the original and is **not in git**
(`.gitignore`): every machine generates it from the operator's copy with the
project's `dump*` tools. Before the project moves on, decide and document:

1. **Storage** — where the data lives on the server, in what format and size,
   how it is produced from the original and how its completeness and
   correctness are verified (`SHA256SUMS`, `check*`).
2. **Versioning** — how a data set is tied to the version of the game and of
   the tools that produced it, when the files themselves are not versioned
   (a manifest with hashes and the dump version).
3. **Loading** — how the game loads it (all at once or on demand, through
   `appData` or directly), and what happens when a file is missing.
4. **Caching** — the browser and the service worker (precache or on demand,
   invalidation by version); `localStorage` is only a cache of server data
   and may be wiped at any time.

Raised 2026-11-08 for every project whose data is outside git.
