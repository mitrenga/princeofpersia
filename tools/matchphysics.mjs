#!/usr/bin/env node
/**
 * matchphysics — the golden record of P3: traces of the prince recorded
 * from SDLPoP (built with tools/sdlpop-trace.patch, all FIX_ options off,
 * POP_TRACE_SILENT set; sources/media/physics/README.md) against our
 * physics fed the same controls frame by frame. For every frame the room,
 * x, y, frame number, row, column, direction, action, sequence address and
 * hit points of the prince have to be the same — and, since P4, the clock
 * (min, tick), the counts of animated and falling tiles (trobs, mobs), the
 * level door (door) and the tile types and modifiers of his room (tiles,
 * mods). Fields a trace lacks are not compared, so P3 traces still match.
 * The report has the shape of the match tools; the exit code is the number
 * of traces that differ.
 *
 * A trace is a JSON file `{level, frames: [{x, y, shift, kid: {...}}]}` or
 * the JSON-lines file the patched SDLPoP writes (one object per frame, the
 * level inside `kid.level`). Our own traces (tools/tracephysics.mjs) match
 * too, which is how the tool tests itself.
 *
 * usage: node tools/matchphysics.mjs [--dir sources/media/physics] [-v] [--stop-at-first]
 */
import '../app/svision/tools/nodeEnv.mjs';   // must come first
import fs from 'node:fs';
import path from 'node:path';
import {headlessWorker, runInputs, ROOT as root} from './lib/physlib.mjs';

const args = process.argv.slice(2);
const verbose = args.includes('-v');
function option(name, fallback) {
  const at = args.indexOf(name);
  return at >= 0 ? args[at+1] : fallback;
}
const dir = path.resolve(root, option('--dir', 'sources/media/physics'));
const FIELDS = ['room', 'x', 'y', 'frame', 'row', 'col', 'direction', 'action', 'seq', 'hp',
                'min', 'tick', 'trobs', 'mobs', 'door', 'tiles', 'mods'];
const same = (a, b) => Array.isArray(a) ? (Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i])) : a === b;

function readTrace(file) {
  const text = fs.readFileSync(file, 'utf8');
  if (file.endsWith('.jsonl')) {
    const frames = text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
    return {level: frames.length ? frames[0].kid.level : 1, frames};
  }
  const json = JSON.parse(text);
  return {level: json.level, frames: json.frames, seed: json.seed, silent: json.silent};
} // readTrace

const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.(json|jsonl)$/.test(f) && f !== 'masks.json').sort() : [];
if (!files.length) {
  console.log(`no traces in ${path.relative(root, dir)}/ — see ${path.relative(root, dir)}/README.md for how to record them with SDLPoP`);
  console.log('matchphysics.mjs: 0 záznamů, žádný zlatý záznam');
  process.exit(1);
}

let traces = 0, framesChecked = 0, differing = 0;
for (const file of files) {
  const golden = readTrace(path.join(dir, file));
  // silent unless our own trace says it was made with sound
  const {worker} = headlessWorker(golden.level, {seed: golden.seed, silent: golden.silent !== false});
  const inputs = golden.frames.map((f) => ({x: f.x, y: f.y, shift: !!f.shift}));
  const ours = runInputs(worker, inputs);
  traces++;
  let first = -1;
  const diffs = [];
  for (let i = 0; i < golden.frames.length; i++) {
    const g = golden.frames[i].kid, o = ours[i].kid;
    framesChecked++;
    const wrong = FIELDS.filter((k) => g[k] !== undefined && !same(g[k], o[k]));
    if (wrong.length) {
      if (first < 0) first = i;
      diffs.push({i, wrong, g, o});
      if (args.includes('--stop-at-first')) break;
    }
  }
  if (diffs.length) {
    differing++;
    const d = diffs[0];
    console.log(`  DIFF ${file}: level ${golden.level}, ${diffs.length} of ${golden.frames.length} frames differ, first at frame ${d.i+1}:`);
    console.log(`       input x ${golden.frames[d.i].x} y ${golden.frames[d.i].y} shift ${golden.frames[d.i].shift}`);
    for (const k of d.wrong) {
      if (Array.isArray(d.g[k])) {
        const at = d.g[k].findIndex((v, i) => v !== d.o[k][i]);
        console.log(`       ${k.padEnd(9)} tile ${at}: original ${String(d.g[k][at]).padStart(3)}   ours ${String(d.o[k][at]).padStart(3)}`);
      } else {
        console.log(`       ${k.padEnd(9)} original ${String(d.g[k]).padStart(5)}   ours ${String(d.o[k]).padStart(5)}`);
      }
    }
    if (verbose) {
      diffs.slice(1, 10).forEach((x) => console.log(`       also frame ${x.i+1}: ${x.wrong.join(', ')}`));
    }
  } else if (verbose) {
    console.log(`  ok   ${file}: level ${golden.level}, ${golden.frames.length} frames`);
  }
}
console.log(`matchphysics.mjs: ${traces} záznamů, ${framesChecked} snímků, ${differing} záznamů s rozdílem`);
process.exit(Math.min(differing, 255));
