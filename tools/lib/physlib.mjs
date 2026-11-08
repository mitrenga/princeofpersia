/**
 * What the physics tools share: the game worker run headless under Node
 * with a level, its graphics and the tables of the executable, driven one
 * frame at a time by raw controls. Imports the game code (app/), never
 * copies it.
 *
 * Import `../app/svision/tools/nodeEnv.mjs` before this module.
 *
 * ## Input scripts
 *
 * A script is a list of steps `{frames, x, y, shift}`: hold these controls
 * for so many frames (x: -1 left, 0 none, 1 right; y: -1 up, 1 down;
 * shift true/false). Shorthand: a string per step, `"20"` (nothing for 20
 * frames), `"R30"` (right), `"L5"`, `"U1"` (up), `"D2"` (down), `"S"`
 * (shift) combined like `"RU1"` or `"RS10"`.
 *
 * @module tools/lib/physlib
 */
import fs from 'node:fs';
import path from 'node:path';

const { GameWorker } = await import('../../app/gameWorker.js');
const { SoundTable } = await import('../../app/pop/sounds.js');

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
export const pad2 = (n) => String(n).padStart(2, '0');
export const readData = (relative) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', relative), 'utf8'));

/**
 * A headless worker with a level loaded, the frame messages collected.
 * @param {number} levelNumber
 * @param {Object} [options] - `seed` (0xC0DE); `silent` (true: no sound is
 *        ever heard playing, as the golden records are made; false: the
 *        sounds run on the frame clock as in the game).
 * @returns {{worker: GameWorker, frames: Object[]}}
 */
export function headlessWorker(levelNumber, options = {}) {
  const palace = [0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 1, 1, 0, 0, 1, 0][levelNumber] === 1;
  const frames = [];
  const worker = new GameWorker((m) => frames.push(m));
  // silent unless asked otherwise: the golden records are made with POP_TRACE_SILENT
  worker.handleMessage({id: 'init', seed: options.seed === undefined ? 0xC0DE : options.seed, silent: options.silent !== false});
  worker.handleMessage({
    id: 'level', number: levelNumber, headless: true,
    level: readData(`levels/level${pad2(levelNumber)}.json`),
    gfx: {
      environment: readData(`gfx/${palace ? 'palace' : 'dungeon'}.json`),
      wall: readData(`gfx/${palace ? 'palaceWall' : 'dungeonWall'}.json`),
      flame: readData('gfx/flameSwordPotion.json'),
      sword: readData('gfx/sword.json'),
      kid: readData('gfx/kid.json')
    },
    tables: readData('exe/tables.json'),
    sounds: SoundTable.fromData(readData('sounds/digi.json'), readData('sounds/speaker.json'), readData('sounds/midi.json')).toJSON()
  });
  return {worker, frames};
} // headlessWorker

/**
 * Expands a script into one `{x, y, shift}` per frame.
 * @param {Array} script - Steps, objects or shorthand strings.
 * @returns {Object[]}
 */
export function expandScript(script) {
  const out = [];
  for (const step of script) {
    let s = step;
    if (typeof step === 'string') {
      const m = /^([LRUDS]*)(\d+)?$/i.exec(step.trim());
      if (!m) {
        throw new Error('bad script step: '+step);
      }
      const letters = m[1].toUpperCase();
      s = {
        frames: m[2] === undefined ? 1 : parseInt(m[2], 10),
        x: letters.includes('L') ? -1 : (letters.includes('R') ? 1 : 0),
        y: letters.includes('U') ? -1 : (letters.includes('D') ? 1 : 0),
        shift: letters.includes('S')
      };
    }
    for (let i = 0; i < (s.frames === undefined ? 1 : s.frames); i++) {
      out.push({x: s.x | 0, y: s.y | 0, shift: !!s.shift});
    }
  }
  return out;
} // expandScript

/**
 * Runs the worker through the controls, one frame each, and returns what
 * the prince did.
 * @param {GameWorker} worker
 * @param {Object[]} inputs - `{x, y, shift}` per frame.
 * @param {Function} [onFrame] - Called with (index, frameMessage) after every frame.
 * @returns {Object[]} `{x, y, shift, kid}` per frame.
 */
export function runInputs(worker, inputs, onFrame) {
  const trace = [];
  inputs.forEach((input, i) => {
    worker.handleMessage({id: 'input', x: input.x, y: input.y, shift: input.shift});
    worker.handleMessage({id: 'tick'});
    const state = worker.kidState();
    trace.push({x: input.x, y: input.y, shift: input.shift ? 1 : 0, kid: state});
    if (onFrame) {
      onFrame(i, worker);
    }
  });
  return trace;
} // runInputs
