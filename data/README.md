# data/ — the original's data in open form

Written by `tools/dumpdat.mjs` from the operator's `assets/original/*.DAT`
(DOS 1.0), following `tools/dumpdat.spec.json`; verified back against the
resources by `tools/checkdat.mjs`. Derived from copyrighted data — ask
before committing. `manifest.json` records the SHA-256 of every source file.

## gfx/<set>.json — one chtab

```
format       "pop-chtab-1"
name         the set (kid, guard, dungeon, palaceWall, …)
source       DAT file          resource   palette resource id (images follow it)
paletteRow   0-15: the set's 16 colours go to VGA registers row*16.., pixels are row*16+colour
palette      {nImages, rowBits, nColors, vga[48] (6-bit r,g,b), cga[16], ega[32]}
palettes     guard only: {dungeon, palace} — GUARD2.DAT / GUARD1.DAT
images       [ {id, width, height, depth, method, flags, pixels} | null ]  1-based number = index+1
optional     dungeon/palace only: {"n": image} — resources 1200+n replacing image n
```

`pixels` is base64 of width*height bytes, colour 0..15 (0 transparent), row
by row. `method` is the original's compression (0 raw, 1 rle, 2 rle by
columns, 3 lzg, 4 lzg by columns); `flags` the raw header word. Loaded by
`app/pop/chtab.js`. `gfx/<set>.png` is the same set as an indexed sprite
sheet for the eye — not read by anything.

## levels/levelNN.json

`format "pop-level-1"`: `rooms[24]` with `fg[30]`, `bg[30]` (raw bytes,
before the game's `alterMods`), `links {left,right,up,down}`, editor `x`,
`y`; `doorlinks {low, high, events}`; `start {room, pos, dir}`; `guards[24]`;
`fill {f1,f2,f3}` and `bytes` (2305, or 2304 for level 15) so the record
rebuilds byte for byte (`app/pop/levelData.js`).

## sounds/

`digi.json` + `digi/NN-name.wav` — 8-bit unsigned mono at the DAC rate
(11 000 Hz mostly); the same bytes are in the JSON as base64 `pcm`, which
is what the game loads (the `.data` endpoint serves JSON only; the WAV is
for the ear and the round-trip). `speaker.json` — PC speaker tunes (tempo,
notes [frequency, length]); `midi.json` + `midi/NN-name.mid` — AdLib music
as standard MIDI files, the same bytes in the JSON as base64 `midi` (which
is what the game loads); `instruments.json` — the AdLib instrument table of
the original (resource 1 of `PRINCE.DAT`): `count`, the `instruments` read
out for the eye and `bytes`, the resource as base64, which is what the
driver takes. Every entry has `seconds`, how long it plays
(digi: samples/rate; speaker: Σ length/tempo to the end mark, `app/pop/sounds.js`;
MIDI: from the tempo map, svision's `audio/midiFile.js`) — the game counts frames with it
(`check_sound_playing`). `typeByte`/`loop` keep the original's type byte
(bit 7 = loop). Names are ours (`dumpdat.spec.json`). Loaded by
`app/audioManager.js` and `app/pop/sounds.js`.

## exe/tables.json

Program data of PRINCE.EXE the physics runs on: `seqtbl` (base 0x196E,
2282 bytes base64 — the animation sequences), `seqOffsets` (115 start
addresses by sequence number), `frames.kid/guard/cuts` ([image, sword, dx,
dy, flags] per frame), `swords` ([image, dx, dy] per sword frame), and the
file offsets they were found at. Loaded by `app/pop/sequences.js` and
`app/pop/frames.js`.

## guardPalettes.json, misc/

`guardPalettes.json`: 7 sets of 16 colours the game recolours guards with.
`misc/prince-res2.json`: a resource of PRINCE.DAT nobody has identified
yet, kept as base64 (resource 1 used to be here too, until it turned out to
be the AdLib instrument table — `sounds/instruments.json`).
