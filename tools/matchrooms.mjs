#!/usr/bin/env node
/**
 * matchrooms — the golden record of P2: screenshots of the rooms taken from
 * the original running in DOSBox (sources/media/rooms/levelNN-roomRR.png)
 * against the same rooms drawn by the game's own drawer
 * (app/pop/roomRenderer.js through tools/lib/renderlib.mjs), pixel by pixel
 * in RGB. The report has the shape of the match tools — rooms checked,
 * pixels different — and the exit code is the number of rooms that differ.
 *
 * What is compared: lines 0-191 (the room; the status bar below is the
 * game's text and hit points, not the room), minus the rectangles listed in
 * sources/media/rooms/masks.json — the prince stands in every screenshot
 * and P2 does not draw him yet. The tool prints the bounding box of the
 * differences of every room, which is what goes into the mask once the eye
 * has confirmed it is the prince and nothing else. For every differing room
 * a picture ours | theirs | difference lands in build/matchrooms/.
 *
 * Screenshot sizes: 320x200, or an integer multiple of it (scaler normal2x,
 * normal3x); anything else (aspect-corrected 320x240, 640x480) is refused —
 * take the shots with aspect=false, see sources/media/rooms/README.md.
 *
 * usage: node tools/matchrooms.mjs [--dir sources/media/rooms] [--out build/matchrooms] [-v]
 */
import '../app/svision/tools/nodeEnv.mjs';   // must come first
import fs from 'node:fs';
import path from 'node:path';
import {decodePNG, encodeRGBAPNG} from '../app/svision/tools/retro/png.mjs';
import {loadLevel, renderRoom, ROOT as root} from './lib/renderlib.mjs';

const args = process.argv.slice(2);
const verbose = args.includes('-v');
function option(name, fallback) {
  const at = args.indexOf(name);
  return at >= 0 ? args[at+1] : fallback;
}
const dir = path.resolve(root, option('--dir', 'sources/media/rooms'));
const outDir = path.resolve(root, option('--out', 'build/matchrooms'));
const ROOM_LINES = 192;

const shots = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^level\d\d-room\d\d\.png$/.test(f)).sort() : [];
if (!shots.length) {
  console.log(`no screenshots in ${path.relative(root, dir)}/ (levelNN-roomRR.png) — see ${path.relative(root, dir)}/README.md for how to take them`);
  console.log('matchrooms.mjs: 0 místností, žádný zlatý záznam');
  process.exit(1);
}
const masksFile = path.join(dir, 'masks.json');
const masks = fs.existsSync(masksFile) ? JSON.parse(fs.readFileSync(masksFile, 'utf8')) : {};

const levels = new Map();
function level(number) {
  if (!levels.has(number)) {
    levels.set(number, loadLevel(number));
  }
  return levels.get(number);
} // level

/** the screenshot as 320x200 RGB, or null with a reason */
function normalise(png) {
  const fx = png.width/320, fy = png.height/200;
  if (fx !== Math.floor(fx) || fy !== Math.floor(fy) || fx < 1 || fy < 1) {
    return {error: `${png.width}x${png.height} is not a multiple of 320x200`};
  }
  const rgb = new Uint8Array(320*200*3);
  for (let y = 0; y < 200; y++) {
    for (let x = 0; x < 320; x++) {
      const s = ((y*fy)*png.width+x*fx)*4;
      const d = (y*320+x)*3;
      rgb[d] = png.rgba[s]; rgb[d+1] = png.rgba[s+1]; rgb[d+2] = png.rgba[s+2];
    }
  }
  return {rgb, scale: `${fx}x${fy}`};
} // normalise

function masked(name, x, y) {
  const list = masks[name] || [];
  for (const [mx, my, mw, mh] of list) {
    if (x >= mx && x < mx+mw && y >= my && y < my+mh) {
      return true;
    }
  }
  return false;
} // masked

let rooms = 0, pixels = 0, differing = 0;
fs.mkdirSync(outDir, {recursive: true});
for (const file of shots) {
  const m = /^level(\d\d)-room(\d\d)\.png$/.exec(file);
  const levelNumber = parseInt(m[1], 10), room = parseInt(m[2], 10);
  const name = file.replace('.png', '');
  const png = decodePNG(fs.readFileSync(path.join(dir, file)));
  const shot = normalise(png);
  if (shot.error) {
    console.log(`  SKIP ${name}: ${shot.error}`);
    continue;
  }
  const loaded = level(levelNumber);
  if (room < 1 || room > loaded.level.usedRooms) {
    console.log(`  SKIP ${name}: level ${levelNumber} has rooms 1..${loaded.level.usedRooms}`);
    continue;
  }
  const ours = renderRoom(loaded, room);
  const lut = loaded.lut;
  rooms++;
  let diff = 0, maskedOut = 0;
  let x0 = 320, y0 = 200, x1 = -1, y1 = -1;
  const picture = new Uint8Array(320*3*ROOM_LINES*4);
  for (let y = 0; y < ROOM_LINES; y++) {
    for (let x = 0; x < 320; x++) {
      const index = ours.bytes[y*320+x];
      const o = (y*960+x)*4, t = (y*960+320+x)*4, d = (y*960+640+x)*4, s = (y*320+x)*3;
      picture[o] = lut[index*3]; picture[o+1] = lut[index*3+1]; picture[o+2] = lut[index*3+2]; picture[o+3] = 255;
      picture[t] = shot.rgb[s]; picture[t+1] = shot.rgb[s+1]; picture[t+2] = shot.rgb[s+2]; picture[t+3] = 255;
      const same = lut[index*3] === shot.rgb[s] && lut[index*3+1] === shot.rgb[s+1] && lut[index*3+2] === shot.rgb[s+2];
      const inMask = masked(name, x, y);
      if (same) {
        const g = (shot.rgb[s]+shot.rgb[s+1]+shot.rgb[s+2])/12;
        picture[d] = g; picture[d+1] = g; picture[d+2] = g;
      } else if (inMask) {
        maskedOut++;
        picture[d] = 0; picture[d+1] = 0; picture[d+2] = 200;
      } else {
        diff++;
        picture[d] = 255; picture[d+1] = 0; picture[d+2] = 0;
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
      picture[d+3] = 255;
    }
  }
  pixels += diff;
  const scale = shot.scale === '1x1' ? '' : ` (screenshot ${png.width}x${png.height}, sampled ${shot.scale})`;
  if (diff) {
    differing++;
    fs.writeFileSync(path.join(outDir, name+'.png'), encodeRGBAPNG(960, ROOM_LINES, picture));
    console.log(`  DIFF ${name}: ${diff} pixels, box x ${x0}-${x1} y ${y0}-${y1} (${x1-x0+1}x${y1-y0+1})${maskedOut ? `, ${maskedOut} under the mask` : ''}${scale}`);
  } else if (verbose) {
    console.log(`  ok   ${name}${maskedOut ? ` (${maskedOut} pixels under the mask)` : ''}${scale}`);
  }
}
console.log(`matchrooms.mjs: ${rooms} místností, ${pixels} rozdílných pixelů (${differing} místností s rozdílem)${differing ? `, obrázky v ${path.relative(root, outDir)}/` : ''}`);
process.exit(Math.min(differing, 255));
