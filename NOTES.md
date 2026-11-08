# NOTES.md — poznatky o formátech a vnitřnostech

Průběžné poznámky, které poslouží i dalším DOS projektům (Gobliiins).
Každý údaj má zdroj; `★` značí nález ověřený na skutečných datech nebo na
běžícím originálu, bez značky je to přepis ze SDLPoP, zatím neověřený.

Zdroj, není-li uvedeno jinak: `sources/reference/sdlpop/src/types.h`
a `seg009.c`, commit `3c5add5f`.

## DAT kontejner

Každý `*.DAT` je archiv „resources" s číselnými ID. Little-endian.

```
offset 0   u32  table_offset     kde začíná tabulka
offset 4   u16  table_size       délka tabulky v bajtech
...
table_offset:
           u16  res_count
           res_count × { u16 id, u32 offset, u16 size }     8 B na položku
```

Položka ukazuje na `offset`, kde leží **1 kontrolní bajt** a za ním `size`
bajtů dat. ★ Kontrolní bajt je doplněk součtu datových bajtů:
`(checksum + Σdata) & 0xFF == 0xFF`. Ověřeno na všech 1 720 resources
21 DAT souborů verze 1.0 (`tools/checkdat.mjs`, 2026-09-14). SDLPoP ho čte
a nekontroluje (`load_from_opendats_alloc`, `seg009.c:2958`).
★ `table_size == 2 + 8·count` u všech souborů. `POPCHT.DAT` (300 B) **není**
DAT kontejner — soubor cheatů.

★ Které ID kde leží (1.0): `PRINCE.DAT` 1, 2 (neidentifikováno, 289 a 91 B),
10 (palety stráží 7×48 B), 150–173 (plamen/meč/lektvar), 700–734 (meč);
`KID.DAT` 400–619; `GUARD.DAT` 751–784 **bez palety 750** — tu dodává
`GUARD1.DAT` (palác) nebo `GUARD2.DAT` (dungeon), každý je jediný resource 750
o 100 B; `FAT/SKEL/VIZIER/SHADOW.DAT` 750+; `V*.DAT` 200–351 (dlaždice),
360–377 (zeď), 1201–1343 (volitelná grafika, viz níž); `TITLE.DAT` 40–45,
50–55; `PV.DAT` 800–817, 850–888, 900–930, 950–961, 980–981;
`LEVELS.DAT` 2000–2015; zvuky 10000+n. Přehled včetně řádků palety
je `tools/dumpdat.spec.json`.

Tvar `data/`: jedna sada spritů (chtab) = jeden JSON s paletou a obrázky
(`data/gfx/<sada>.json`), ne `res<ID>` po souborech jako v SDLPoP —
hra načítá sadu naráz, ID zůstává u každého obrázku (`data/README.md`).

## Obrázky (sprity, dlaždice)

```
u16 height
u16 width
u16 flags      bity 12–14: hloubka−1 (1/2/4 bpp), bity 8–11: metoda komprese
byte data[]
```

★ Bit 15 flags je nastavený u všech 1 209 čtyřbitových obrázků a nulový u
všech 33 jednobitových (hodnoty `0xB400` … `0xB000` vs. `0x0100` … `0x0400`);
SDLPoP ho ignoruje. Význam neznámý; `dumpdat` ho uchovává v `flags`.
★ Komprimovaný proud je vždy spotřebovaný do posledního bajtu a rozbalí se
na přesně `stride·height` bajtů (1 242 obrázků, 0 rozdílů). ★ U tří obrázků
1×1 px (`vizier` 777/778, `PV` 902) má nevyužitá půlka bajtu nenulové bity.
★ Prázdný slot chtabu je resource o ≤ 2 bajtech (SDLPoP `load_from_opendats_metadata`
ho bere jako „není"): `VDUNGEON.DAT` má 63 obrázků ze 151, `VPALACE.DAT` 64.

Metody komprese (`decompr_img`, `seg009.c:792`):

| cmeth | metoda |
|---|---|
| 0 | RAW, zleva doprava |
| 1 | RLE, zleva doprava |
| 2 | RLE, shora dolů (po sloupcích, `stride`) |
| 3 | LZG, zleva doprava |
| 4 | LZG, shora dolů |

Výstup je bitmapa s `stride` bajty na řádek, pixely po 1/2/4 bitech MSB
první; barva je index do palety resource (16 barev na chtab). Průhledná je
barva 0. Varianty „shora dolů" zapisují rozbalené bajty po sloupcích
(bajt n → řádek n mod height, sloupec n div height). LZG: kruhový buffer
1 KB, vynulovaný, zápis začíná 0x42 B před koncem; bajt příznaků po 8
položkách LSB první (1 = literál, 0 = kopie 16 bitů big-endian: 10 bitů
absolutní pozice v bufferu, 6 bitů délka−3).

★ Naše zpětné balení (greedy) dává stejné bajty jen u části obrázků
(RLE 15/46, RLE-sloupce 11/126, LZG 15/158, LZG-sloupce 12/453, RAW 33/36;
`checkdat.mjs --encode`) a většinou kratší — původní packer nebyl greedy
nejdelší shoda. Není to chyba dekodéru (rozbalení našeho balení dává stejné
pixely, 1 242/1 242), jen jiný, rovnocenný zápis. Round-trip se proto měří
na pixelech a na plném spotřebování proudu, ne na bajtech komprese.

### Volitelná grafika 1200+n

★ `V*.DAT` obsahují resources `1200+n`, které **nahrazují obrázek n** sady
200 (`load_more_opt_graf`, `seg000.c:13FC`): chompery 101–123, bodce
127–143, skelet 30–31, velký pilíř 86–91; palác navíc mříže 1–13 a zrcadlo/
dveře 75–83. V základní sadě jsou ty sloty prázdné. Originál je podle
zakomentovaných podmínek načítal jen pro úrovně, které je potřebují; SDLPoP
vždy. `Chtab.fromData` je aplikuje vždy (`optional: false` vypne).

## Palety

`dat_pal_type` (100 B včetně `n_images` v `dat_shpl_type`):

```
u16  row_bits
u8   n_colors
rgb  vga[16]      6bitové složky (0–63) → VGAPalette.load()
u8   cga[16]
u8   ega[32]
```

Jedna paleta na „chtab" (sada spritů jedné postavy nebo dlaždic). Obrázek
s ID `n` v chtabu používá paletu resource `palette_resource_id`, obrázky
jsou `palette_resource_id + 1 + image`. ★ `row_bits` je v souboru 0 u všech
sad; hra ho dosadí při načtení (`1 << řádek`) a paletu zapíše do registrů
`řádek·16 … +15`, pixely na obrazovku jako `řádek·16 + barva`
(`set_loaded_palette`, `seg009.c:9CAC`). Řádky (SDLPoP `seg000/001.c`):

| řádek | sada | resource |
|---|---|---|
| 0 | výchozí BIOS 13h; hra přepíše 6 (hnědá zdi paláce) a 12 (červená krve) | — |
| 1 | font (jen SDLPoP) | — |
| 2 | meč v ruce | PRINCE 700 |
| 3 | plamen, meč na zemi, lektvary | PRINCE 150 |
| 5 | dlaždice | V* 200 |
| 6 | zeď | V* 360 |
| 7 | princ | KID 400 |
| 8 | stráž (přebarvení z PRINCE 10 podle `guards_color`) | GUARD… 750 |
| 9, 10 | princezna / vezír v příběhu | PV 800, 850/900 |
| 11, 12 | titulky | TITLE 40, 50 |
| 13, 14 | pokoj princezny, postel | PV 950, 980 |

Řádek 0 před prvním `set_pal`: SDLPoP startuje z nulové tabulky, remake
z `VGAPalette.defaultPalette()` (BIOS) — ★ rozhodne screenshot z DOSBoxu v P2.

## Úrovně (`LEVELS.DAT`, resource 2000–2015)

`level_type`, **2305 B** — ★ kromě úrovně 15 (kopírovací ochrana), která má
v souboru 2304 B; poslední výplňový bajt chybí a originál čte, co je
(`load_from_opendats_to_area`, `MIN(size, length)`). `PoPLevel` si délku
pamatuje (`byteLength`), round-trip všech 16 úrovní 0 rozdílů.

```
byte fg[720]         24 místností × 30 dlaždic (10 × 3): typ dlaždice
byte bg[720]         modifikátor dlaždice
byte doorlinks1[256] tlačítka → dveře, dolní bajty
byte doorlinks2[256] horní bajty
link roomlinks[24]   sousedi: left, right, up, down (4 B na místnost)
byte used_rooms
byte roomxs[24], roomys[24]
byte fill_1[15]
byte start_room, start_pos; sbyte start_dir
byte fill_2[4]
byte guards_tile[24], guards_dir[24], guards_x[24],
     guards_seq_lo[24], guards_skill[24], guards_seq_hi[24], guards_color[24]
byte fill_3[18]
```

Typ dlaždice (`fg`, dolních 5 bitů) + modifikátor (`bg`) → co se kreslí a
jak se chová: `sdlpop/doc/tiles.md` a princed.org „Legacy combos". Místnost
je 10 × 3 dlaždice, dlaždice 32 × 63 px; spodní hrana podlahy řádku `r` je
na y = 63·r + 65, řádek 192–199 je stavový pruh. Po načtení hra modifikátory
přepíše (`load_alter_mod`): brána 1 → 188 (otevřená) jinak 0, uvolněná
podlaha → 0, lektvar `<<= 3`, zeď: 1 → bit 7 („bez modré linky"), bity 0–1 =
zeď vpravo/vlevo. V remaku `PoPLevel.alterMods()`.
★ `roomxs/roomys` (souřadnice editoru) mají u úrovně 1 pro místnosti 13, 18
a 24 hodnotu 255, ač jsou použité — `renderlevel` proto skládá mapu
z `roomlinks`, ne z nich. Door events: `doorlinks1` = dlaždice (5 b), dolní
2 bity místnosti (bity 5–6), bit 7 = poslední; `doorlinks2` = časovač (5 b),
horní 3 bity místnosti (`seg007.c`).

### Kreslení místnosti (`seg008.c`, remake `app/pop/roomRenderer.js`)

Řádky zdola (2, 1, 0), sloupce 0–9; každá dlaždice se skládá z kusů
`tile_table` do tří seznamů — pozadí, střed (objekty), popředí — a mezi ně
jdou plné obdélníky (wipes). Pořadí malování: wipes 0 → pozadí → střed →
wipes 1 → popředí (`draw_tables`). Horní 3 řádky ukazují spodní řadu místnosti
nad. Vzor cihel zdi je seedovaný `room + řádek·10 + sloupec` do LCG
`seed·214013 + 2531011` (`prandom`), barvy palácových cihel seedem `room`
(registry 0x61–0x64 / 0x66–0x69). Blittery: 0 kopie, 2 OR, 3 XOR (stín),
9 černá silueta, 0x10 průhledná 0, 0x40+c silueta barvou c (absolutní
registr). ★ OR a XOR remake zatím kreslí jako průhlednou kopii (SDLPoP
stejně) — na černém podkladu totéž; ověří P2 proti DOSBoxu.

## Sekvence animací

Postavy jsou řízené „bytecode" sekvencí (`seqtbl.c`, přepis v
`doc/internals_sequence-table.txt`): instrukce jako `act`, `jmp`, `dx`, `dy`,
`snd`, `frame`. Snímek = 1/12 s (1/10 s při souboji). Fyzika 1:1 znamená
reprodukovat tuhle tabulku a interpret, ne animovat podle dojmu.

## Zvuk

`internals_sounds.csv`: 58 indexovaných zvuků. Tři nosiče:

| DAT | co |
|---|---|
| `DIGISND1–3.DAT` | digitalizované samply — `PCMSample` ve svision |
| `IBM_SND1–2.DAT` | PC speaker |
| `MIDISND1–2.DAT` | AdLib — standardní MIDI, hraje vlastní OPL2 (R-029) |

Resource = **bajt typu** + data. ★ Bity 0–2 typ (0 speaker, 1 digi, 2 MIDI),
**bit 7 = smyčka** (`sfLoop`): nastavený u zvuku 15 (level door sliding)
v `IBM_SND1` i `DIGISND3`. Formáty (`types.h`):

```
speaker  u16 tempo, pak noty { u16 frekvence, u8 délka }   0/1 = pauza, 0x12 = konec
digi 1.0 u16 rate, u16 count, u16 ?, u8 sample_size(8), u8 samples[]   (11 000 Hz, u8)
digi 1.3 u16 rate, u8 sample_size, u16 count, u16 ?, u16 ?, samples[]
midi     standardní soubor MIDI („MThd"…)
```

★ **Nástroje AdLib jsou resource 1 v `PRINCE.DAT`** (dřív vedený jako
neidentifikovaný): bajt počtu a pak 16 B na nástroj — `blockLow`,
`blockHigh` (ovladač je nepoužívá, výška jde z noty), `FB_conn`, dvakrát
operátor `{mul, ksl_tl, a_d, s_r, waveform}` a `percussion` + 2 B nic.
Ověřeno na datech: 18 nástrojů, 1+18×16 = 289 B přesně. Je to prostě
registrová sada jednoho dvouoperátorového hlasu (`types.h instrument_type`,
`midi.c init_midi` — SDLPoP ji načítá z „posledního otevřeného DATu"
funkcí `load_from_opendats_alloc(1, "bin")`). MIDI kanál *n* startuje na
nástroji *n*, program change s tím hýbe. `dumpdat` ji píše do
`data/sounds/instruments.json`, hraje se přes
`app/svision/js/audio/chip/adlibMidi.js`.

★ Ovladač hraje noty **o oktávu níž**, než MIDI říká (nota 69 = A4 tedy
zní jako 220 Hz), a posouvá je sysexem `F0 .. 34 00|01 00 <půltóny> F7`.
Hlasitost nosiče se míchá z nástroje a velocity:
`((ksl_tl&0x3F)+64)·225/(velocity+161)`, ořez 64..127, mínus 64; modulátor
si drží vlastní úroveň (`seg009:6C3C`). Hlasů je devět a berou se
round-robin od naposledy použitého — nikdy hned ten právě uvolněný, aby si
nota neuťala dozvuk. Žádná z 22 skladeb o hlas nepřijde.

★ **Modulátor rozhoupe nosnou o skoro čtyři otáčky fáze, ne o jednu.**
Čip o radiánech nic neví: výstup operátoru je číslo v ±4084 a nosná ho
přičte ke svému desetibitovému čítači fáze, kde celá otáčka je 1024
(`opl3.c OPL3_SlotGenerate`, `OPL3_EnvelopeCalcExp` — maximum
`(exprom[255]|0x400)<<1 = 4084`). Modulační index je tedy `4084/1024`
otáčky na jednotku výstupu; s jednou otáčkou zůstane nosná skoro čistý
sinus, vyšší harmonické zmizí a všechno zní dutě a basově (hlášeno
operátorem 2026-09-15, `OPL2.FM_INDEX`). Ten poměr potvrzuje zpětná vazba:
posun `9-fb` v `OPL3_SlotCalcFB` se po téže normalizaci převede přesně na
`π · 2^(fb−5)` na výstupu ±1. Stejnou cestou se našel off-by-one v KSL:
`kslrom[fnum>>6] − 8·(8−block)`, ne `7−block` (1,5 dB navíc na každém
operátoru s key scalingem, což je v PoP skoro každý).

Načítání (`load_sounds`, `load_opt_sounds`, `seg000.c`): otevřené DATy se
hledají od naposledy otevřeného, tj. MIDI → DIGI → IBM; zvuk se bere
z prvního, který ho má. ★ `DIGISND2.DAT` (44–49, 51: skelet, zrcadlo,
chomper, bodce, dveře princezny) načítá až `load_opt_sounds` s `IBM_SND2`
a `MIDISND2` — SDLPoP má jeho otevření v `load_sounds` zakomentované
a hraje ty zvuky ze speakeru; originál se Sound Blasterem je hraje
digitalizovaně. `sound_pcspeaker_exists` (`seg000.c`) umlčí speakerovou
verzi zvuků 1, 11, 19–22 (jen typový bajt) — `play_sound` zvuk typu
speaker s nulou v tabulce vůbec nezařadí.

Řazení (`play_sound` / `play_next_sound`): během snímku si hra jen pamatuje
nejhlasitější žádost (`sound_prio_table`, **nižší číslo = hlasitější**;
hudba 0x01, kroky 0xA0), na konci snímku (`draw_game_frame`) ji spustí, když
nic nehraje nebo hrající zvuk je v `sound_interruptible` a není hlasitější.
Jeden zvuk naráz. `check_sound_playing` čte hra ve fyzice: podřep na úrovni
1 čeká na hudbu 25, pírko (`is_feather_fall`) končí s hudbou 39, úroveň
skončí až po dohrání 41, `play_level` čeká před startem. Remake to počítá
na snímcích z délky zvuku (`app/pop/sounds.js`), ne z přehrávače.

★ Verze 1.0 potvrzená tvarem: všech 31 digi resources má `sample_size` na
bajtu 7. Zvuk 48 má `count = 0x0708`, takže osmička je i na bajtu 3 —
SDLPoP by ho sám o sobě označil za nejednoznačný (`determine_wave_version`
si proto pamatuje první jednoznačnou odpověď); `dumpdat.spec.json` má
`digiLayout: "1.0"`. ★ Nepoužité zvuky (1, 11, 19–22, 31, 34, 42) jsou
v `IBM_SND1.DAT` jen bajt typu. ★ `count == délka samplů` u všech 31.
Rozložení 1.0: DIGISND1 20 zvuků, DIGISND2 7, DIGISND3 4; IBM_SND1 44,
IBM_SND2 13; MIDISND1 16, MIDISND2 6. Round-trip WAV → resource 0 rozdílů.

## Časování

Hra běží na 12 snímků/s (`frame` = 1/12 s). Hodiny (`show_time`,
`seg008.c`): `rem_min` 60, `rem_tick` 719, jeden tik na snímek, 720 tiků
= minuta; stojí, když je princ mrtvý, na úrovni 13 po Jaffarově smrti
(`leveldoor_open != 0`) a na úrovni 15. Hlášky po 5 minutách a každou
z posledních 5, v poslední minutě každou sekundu (24 snímků, „1 SECOND
LEFT" 12). Vypršení (`rem_min == 0`) se nepočítá na úrovních 13–15.
Souboj běží 1/10 s (`fight_speed` 6 vs `base_speed` 5 tiků časovače) —
P5.

## Mechanismy dlaždic (`seg007.c`, remake `PrinceLogic` druhá půlka)

**Trob** = animovaná dlaždice `{tilepos, room, type}`; `type < 0` = smazat.
Každý snímek `process_trobs` → `animate_tile` pracuje s kopií modifikátoru
a na konci ji zapíše do **právě adresované** místnosti (`get_room_address`;
místnost 0 adresu nemění) — `animate_leveldoor` na úrovni 4 mezitím zavolá
`get_tile(4,4,0)` kvůli zrcadlu, takže modifikátor dveří (43) skončí
v místnosti 4. Chyba originálu, remake ji reprodukuje.

| dlaždice | modifikátor | průběh |
|---|---|---|
| brána 4 | otevřenost 0–188, 238 čeká na zavření, 0xFF trvale | typ 0 −1/snímek (zvuk 4 při `&3==3`), 1/2 +4 (zvuk 5 při `&7==0`), 3–8 zabouchnutí −20·(typ−2) se zrychlením, zvuk 6/7 |
| tlačítko 6/15 | index první události v `doorlinks` | `trigger_button`: časovač události (5 b v `doorlinks2`) na 5, trob odpočítává; 31 = zaseknutá; smrt na tlačítku: otvírač → podlaha + trvalé otevření (typ `debris`), zavírač → `stuck` |
| uvolněná 11 | 0x80–0x84 třesení, 1–11 odpočet, bit 5 **typu** = nikdy nepadá | po 11 → `remove_loose` (prázdná, modifikátor = typ úrovně) + mob; zvuky 20–22 podle `LOOSE_SOUND`, nikdy dvakrát týž, +1 vyplýtvaný `prandom` |
| bodce 2 | 0→…→5→0x8F→…→0x80→6→…→9→0; 0xFF vypnuté | zvuk 49 při startu; `is_spike_harmful` 1/2 |
| chomper 18 | 1–15 snímek, bit 7 krev | rytmus řady 15,12,9,6,13,10,7,14,11,8; zvuk 47 na 2; konec po 6, když princ odešel |
| pochodeň 19/30 | 0–8 plamen | `prandom(255)` každý snímek — **spotřebovává PRNG** (i pochodně sloupce 9 místnosti vlevo) |
| lektvar 10 | bity 3–7 druh, 0–2 bublina 1–7 | |
| meč 22 | odpočet, pak `(prandom(255)&0x3F)+0x28` | |
| dveře úrovně 16 | 0–43 otevření | typ 3–6 zabouchnutí 5/17/99, zvuk 14/15; při 43 `leveldoor_open = 1`, úroveň 4 postaví zrcadlo |

**Mob** = padající podlaha `{xh, y, room, speed, type, row}`, `y` bajt
(přetéká: −192 při přechodu do místnosti dole → 250+), `speed` sbyte
(−1 smazat, −2 dopadl). Zrychlení 3 do 29; hranice pater `Y_SOMETHING`
[−1, 62, 125, 188, 25]; dopad → zvuk 2, `do_knock` (otřese uvolněné
v řadě), dlaždice → suť 14 / pochodeň se sutí 30, tlačítko pod ní
stiskne (`loose_land` padá `switch`em bez `break`, otvírač se stane sutí
a otevře trvale). Zásah princa: −1 HP (`seq 52`) nebo smrt (`seq 22`),
běh snímky 5–14 chrání kromě úrovně 13.

★ `obj_x` je znaménkový `short` (P3 měl `u16`): princ za levým okrajem
(x < 58) má záporné `obj_x`, kolizní box `char_x_left = obj_x/2 + 58`.
★ Brána ve sloupci 9 se kreslí až v sousední místnosti vpravo (mříže jsou
„pravá část" dlaždice); ve své místnosti je vidět jen sloupek.
