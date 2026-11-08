# Protokol model ↔ worker (R-007, první nasazení)

Worker je `app/gameWorker.js` slepený za běhu z ES modulů (`svision/js/moduleWorker.js`:
seznam v `GameModel.WORKER_SOURCES`, tytéž soubory v `config/compile.json`
`standalone`). Stejná třída `GameWorker` se importuje pod Node do nástrojů —
bez časovače, snímek po snímku přes `tick`.

Tick = **1 herní snímek = 1/12 s** (pevný krok, akumulátor podle
`performance.now()`, po probuzení záložky se nedohání víc než 12 snímků).
Obraz se posílá jen když se změnil; `tick` v headless režimu ho pošle vždy.

## model → worker

| zpráva | význam |
|---|---|
| `{id:'init', seed, silent?}` | seed generátoru (`PoPRandom`, LCG originálu) — od začátku (R-009); `silent` = žádný zvuk nehraje ani není slyšet hrát (nástroje; totéž co `POP_TRACE_SILENT` v patchi SDLPoP) |
| `{id:'level', number, level, gfx:{environment, wall, flame, sword, kid}, tables, sounds?, hitPoints?, headless?}` | obsah `data/levels/levelNN.json`, `data/gfx/*.json` a `data/exe/tables.json`; `sounds` = tabulka zvuků `{index: {kind, seconds, loop}}` (`SoundTable.toJSON()` — druh a délka, samply zůstávají v modelu); `hitPoints` = maximum životů, se kterým princ vstupuje (`hitp_beg_lev`, výchozí 3); worker složí paletu, postaví fyziku (`PrinceLogic`), vykreslí startovní místnost a (ne-headless) spustí hodiny |
| `{id:'controls', action, value}` | stav jedné akce `left/right/up/down/shift`; před snímkem se z nich složí `control_x/y/shift` jako `read_keyb_control` (nahoru má přednost před dolů, vlevo před vpravo) |
| `{id:'input', x, y, shift}` | nástroje: surové ovládání pro další snímky (x −1/0/1, y −1/0/1), obchází `controls` |
| `{id:'pause'}` / `{id:'continue'}` | hodiny běží, snímky ne |
| `{id:'reset'}` | zastaví a zahodí úroveň |
| `{id:'tick'}` | headless: přesně jeden snímek + `frame` |

## worker → model

| zpráva | význam |
|---|---|
| `{id:'frame', frame, level, room, kid, text, sound, vram: Uint8Array(64000), palette: Uint8Array(768), paletteVersion}` | celá videoram 13h a 256 registrů DAC (6bitové složky); model volá `VGAVideoRAMEntity.restore(vram)` a `palette.load()` jen při změně `paletteVersion` (mění se i zábleskem registru 0 při lektvaru/zranění). `kid` = stav princa a dlaždic kolem něj pro nástroje (`matchphysics`): `{x, y, frame, room, row, col, direction, action, seq, hp, sounds[], min, tick, trobs, mobs, door, tiles[30], mods[30]}` — hodiny, počty animovaných a padajících dlaždic, `leveldoor_open`, typy a modifikátory dlaždic místnosti princa (nuly pro místnost 0). `text` = hláška spodního řádku („5 MINUTES LEFT"), zatím ji nikdo nekreslí (P7). `sound` = výsledek `play_next_sound` toho snímku, `{start, stop, loop}` (start = číslo zvuku nebo −1, stop = utnout hrající, loop = sampl se opakuje do dalšího stop) nebo null, když se nic nemění; model ho dá `AudioManager.playFrame()` |
| `{id:'levelDone', level, next, hitPoints, remMin, remTick, sound}` | princ odešel dveřmi úrovně (nebo padl/vyběhl z úrovně 6/12) a hudba konce dohrála (`check_sound_playing`): worker přestal tikat, `sound` = `{stop: true}` (`stop_sounds`), model načte `next` s `hitPoints` (`play_level_2` vrací `next_level`) |
| `{id:'timeOver', level}` | hodina vypršela (`expired`); worker přestal tikat, cutscéna a restart jsou P7 |

Plán dalších zpráv: `inputScript` v `level` (testFlight, R-009), `gameOver` (P7).
