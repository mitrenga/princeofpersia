# assets/original/ — the original data files of the game

**Nothing in this directory is committed** (`.gitignore`: `assets/original/*`).
The data of Prince of Persia is copyrighted; what belongs in the repository
is the tools that unpack it and the formats written down in `NOTES.md`.

## What goes here

The files of a legally owned copy of the DOS release, **version 1.0** (1990).
The game is not sold digitally (not on GOG or Steam, Ubisoft never re-released
this version); the realistic source is a second-hand floppy set or the 1996
"Prince of Persia Collection" CD — the CD usually carries 1.3/1.4, so check
the version (below). The set actually in use is described in
`sources/docs/original_files.md`.

```
PRINCE.DAT      program + fonts, cursor, menu pictures
KID.DAT         the prince's sprites
VDUNGEON.DAT    dungeon tiles
VPALACE.DAT     palace tiles
GUARD.DAT       guard sprites       GUARD1.DAT, GUARD2.DAT: guard palettes
FAT.DAT  SKEL.DAT  SHADOW.DAT  VIZIER.DAT   the other characters
PV.DAT          princess and vizier pictures (cutscenes)
TITLE.DAT       title screens
LEVELS.DAT      15 levels (0-14; the game plays 1-13, 0 is the demo, 14 the vizier)
DIGISND1.DAT  DIGISND2.DAT  DIGISND3.DAT   digitised sounds
IBM_SND1.DAT  IBM_SND2.DAT                  PC speaker sounds
MIDISND1.DAT  MIDISND2.DAT                  music (AdLib)
PRINCE.EXE      to identify the version (see below)
```

Put them here as they are in the installation, without renaming. The tool
`tools/dumpdat.mjs` (P1) looks for them right here.

## Checking the version

The hashes go into `sources/docs/original_files.md` once the files are
available — they tell the edition apart (1.0 / 1.3 / 1.4), which decides the
shape of the sound DATs and a few differences in the levels (SDLPoP
`seg009.c`, `load_sound` distinguishes 1.0/1.1 from 1.3/1.4).

```
strings assets/original/PRINCE.EXE | grep 'PRINCE OF PERSIA'   # prints "V1.0"
sha256sum -c sources/docs/original_files.sha256               # same set as documented
```
