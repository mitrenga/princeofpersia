/**
 * What the picture tools share: a level with its sprite sets and palette
 * loaded from data/ the way the game worker does it, and one room drawn by
 * the game's own drawer into a VGAVideoRAM. Imports the game code
 * (app/pop/), never copies it — the tools test what the game runs.
 *
 * Import `../app/svision/tools/nodeEnv.mjs` before this module.
 *
 * @module tools/lib/renderlib
 */
import fs from 'node:fs';
import path from 'node:path';

const { VGAVideoRAM } = await import('../../app/svision/js/platform/canvas2D/vga/vgaVideoRAM.js');
const { VGAPalette } = await import('../../app/svision/js/platform/canvas2D/vga/vgaPalette.js');
const { PoPLevel } = await import('../../app/pop/levelData.js');
const { Chtab } = await import('../../app/pop/chtab.js');
const { RoomRenderer } = await import('../../app/pop/roomRenderer.js');

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
export const pad2 = (n) => String(n).padStart(2, '0');

export function readData(relative) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', relative), 'utf8'));
} // readData

/**
 * The palette the game starts a level with: what the BIOS leaves in the DAC
 * after mode 13h, registers 6 and 12 rewritten by the game, the sets in
 * their rows (gameWorker.js `loadLevel`, SDLPoP `init_game_main`).
 * ★ Row 0 is to be measured against DOSBox in P2 — SDLPoP starts from zeros.
 */
export function levelPalette(chtabs) {
  const palette = VGAPalette.defaultPalette();
  palette.set(12, 0x38, 0x00, 0x0C);
  palette.set(6, 0x30, 0x26, 0x14);
  for (const chtab of Object.values(chtabs)) {
    chtab.install(palette);
  }
  return palette;
} // levelPalette

/**
 * Loads a level and everything drawing it needs.
 * @param {number} number - 0..15.
 * @param {Object} [options] - `optional: false` leaves the 1200+n graphics out.
 * @returns {{number, level, palace, chtabs, palette, renderer, lut}} `lut` is
 *          the palette as 8-bit r, g, b per register.
 */
export function loadLevel(number, options = {}) {
  const level = PoPLevel.fromJSON(readData(`levels/level${pad2(number)}.json`)).alterMods();
  const palace = PoPLevel.TYPE_OF_LEVEL[number] === 1;
  const chtabs = {
    environment: Chtab.fromData(readData(`gfx/${palace ? 'palace' : 'dungeon'}.json`), {optional: options.optional !== false}),
    wall: Chtab.fromData(readData(`gfx/${palace ? 'palaceWall' : 'dungeonWall'}.json`)),
    flame: Chtab.fromData(readData('gfx/flameSwordPotion.json')),
    sword: Chtab.fromData(readData('gfx/sword.json'))
  };
  const palette = levelPalette(chtabs);
  const lut = new Uint8Array(768);
  for (let i = 0; i < 768; i++) {
    lut[i] = VGAPalette.to8bit(palette.bytes[i]);
  }
  return {number, level, palace, chtabs, palette, lut, renderer: new RoomRenderer(level, chtabs, {levelNumber: number})};
} // loadLevel

/**
 * Draws one room into a fresh 320x200 memory.
 * @param {Object} loaded - What loadLevel gave.
 * @param {number} room - 1..24.
 * @returns {VGAVideoRAM}
 */
export function renderRoom(loaded, room) {
  const screen = new VGAVideoRAM();
  loaded.renderer.drawRoom(room, screen);
  return screen;
} // renderRoom
