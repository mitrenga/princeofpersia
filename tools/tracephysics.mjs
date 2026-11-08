#!/usr/bin/env node
/**
 * tracephysics — runs the prince through an input script in the game worker
 * (headless, under Node) and writes what he did frame by frame: position,
 * frame, room, row, column, direction, action, sequence address, hit
 * points. The trace is our side of `matchphysics.mjs`; with `--png` it also
 * writes a strip of screen pictures for the eye.
 *
 * usage: node tools/tracephysics.mjs --script file.json [--level N] [--out build/trace.json]
 *                                    [--png build/trace.png] [--every 1] [--print] [--sound]
 *
 * Silent by default, as the golden records are made (POP_TRACE_SILENT);
 * `--sound` runs the sounds on the frame clock as the game does — the level 1
 * crouch then waits for the presentation music — and prints what starts.
 *
 * The script file: `{"level": 1, "seed": 49374, "inputs": ["30", "R20", "RU1", ...]}`
 * (see tools/lib/physlib.mjs for the shorthand), or a bare array of steps.
 */
import '../app/svision/tools/nodeEnv.mjs';   // must come first
import fs from 'node:fs';
import path from 'node:path';
import {encodeIndexedPNG} from '../app/svision/tools/retro/png.mjs';
import {headlessWorker, expandScript, runInputs, ROOT as root} from './lib/physlib.mjs';

const { VGAPalette } = await import('../app/svision/js/platform/canvas2D/vga/vgaPalette.js');

const args = process.argv.slice(2);
function option(name, fallback) {
  const at = args.indexOf(name);
  return at >= 0 ? args[at+1] : fallback;
}
const scriptFile = option('--script', null);
if (!scriptFile) {
  console.log('usage: node tools/tracephysics.mjs --script file.json [--level N] [--out file] [--png file] [--every N] [--print]');
  process.exit(2);
}
const script = JSON.parse(fs.readFileSync(path.resolve(root, scriptFile), 'utf8'));
const steps = Array.isArray(script) ? script : script.inputs;
const levelNumber = parseInt(option('--level', script.level || 1), 10);
const seed = script.seed === undefined ? 0xC0DE : script.seed;
const outFile = path.resolve(root, option('--out', 'build/trace.json'));
const pngFile = option('--png', null);
const every = parseInt(option('--every', '1'), 10);
const print = args.includes('--print');
const withSound = args.includes('--sound');

const {worker, frames} = headlessWorker(levelNumber, {seed, silent: !withSound});
const inputs = expandScript(steps);
const pictures = [];
const soundsByFrame = {};
const trace = runInputs(worker, inputs, (i, w) => {
  if (pngFile && i % every === 0) {
    pictures.push(w.screen.bytes.slice());
  }
  const last = frames[frames.length-1];
  if (last && last.id === 'frame' && last.sound) {
    soundsByFrame[i] = last.sound;
  }
});
Object.keys(soundsByFrame).forEach((i) => { trace[i].sound = soundsByFrame[i]; });

fs.mkdirSync(path.dirname(outFile), {recursive: true});
fs.writeFileSync(outFile, JSON.stringify({
  format: 'pop-physics-trace-1', source: 'princeofpersia tools/tracephysics.mjs',
  level: levelNumber, seed, silent: !withSound, inputs: steps, frames: trace
}, null, 0)+'\n');

if (print) {
  trace.forEach((t, i) => {
    const k = t.kid;
    const sound = t.sound ? `  sound ${t.sound.stop ? 'stop ' : ''}${t.sound.start >= 0 ? t.sound.start+(t.sound.loop ? ' loop' : '') : ''}` : '';
    console.log(`${String(i+1).padStart(4)} in ${t.x},${t.y},${t.shift}  room ${k.room} x ${String(k.x).padStart(3)} y ${String(k.y).padStart(3)} row ${k.row} col ${String(k.col).padStart(2)} dir ${k.direction} act ${k.action} frame ${String(k.frame).padStart(3)} seq ${k.seq.toString(16)} hp ${k.hp}${sound}`);
  });
}

if (pngFile) {
  const lut = new Uint8Array(768);
  for (let i = 0; i < 768; i++) {
    lut[i] = VGAPalette.to8bit(worker.palette.bytes[i]);
  }
  const columns = Math.min(8, pictures.length);
  const rows = Math.ceil(pictures.length/columns);
  const W = 320, H = 200;
  const strip = new Uint8Array(columns*W*rows*H);
  pictures.forEach((p, n) => {
    const ox = (n % columns)*W, oy = Math.floor(n/columns)*H;
    for (let y = 0; y < H; y++) {
      strip.set(p.subarray(y*W, (y+1)*W), (oy+y)*columns*W+ox);
    }
  });
  const file = path.resolve(root, pngFile);
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, encodeIndexedPNG(columns*W, rows*H, strip, lut));
  console.log(`${path.relative(root, file)}: ${pictures.length} pictures, every ${every} frames`);
}
const last = trace[trace.length-1].kid;
console.log(`tracephysics.mjs: level ${levelNumber}, ${trace.length} frames → ${path.relative(root, outFile)}; the prince ends in room ${last.room} at (${last.x}, ${last.y}) frame ${last.frame}, ${last.hp} hp`);
