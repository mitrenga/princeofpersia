#!/usr/bin/env node
/**
 * renderlevel — draws every room of a level as the game would show it and
 * writes the whole level as one PNG map (rooms side by side, placed by
 * their links), optionally one PNG per room too. The rooms are drawn by
 * the game's own drawer (app/pop/roomRenderer.js) into a VGAVideoRAM and
 * coloured with a VGAPalette composed the way the original composes it, so
 * the picture is what the remake will put on the screen — that is what P2
 * will hold against DOSBox screenshots (tools/matchrooms.mjs).
 *
 * usage: node tools/renderlevel.mjs [--level N] [--out build/levelNN.png]
 *                                  [--rooms build/rooms] [--no-optional]
 */
import '../app/svision/tools/nodeEnv.mjs';   // must come first
import fs from 'node:fs';
import path from 'node:path';
import {encodeIndexedPNG} from '../app/svision/tools/retro/png.mjs';

import {loadLevel, renderRoom, pad2, ROOT as root} from './lib/renderlib.mjs';

const args = process.argv.slice(2);
function option(name, fallback) {
  const at = args.indexOf(name);
  return at >= 0 ? args[at+1] : fallback;
}
const levelNumber = parseInt(option('--level', '1'), 10);
const outFile = path.resolve(root, option('--out', `build/level${pad2(levelNumber)}.png`));
const roomsDir = option('--rooms', null);
const optional = !args.includes('--no-optional');

// ------------------------------------------------------- the level, its sets
// (the palette, the sets and the drawer are made exactly as gameWorker.js
// makes them — tools/lib/renderlib.mjs imports the game code for that)

const loaded = loadLevel(levelNumber, {optional});
const level = loaded.level;
const palace = loaded.palace;

// ----------------------------------------------------------------- placement
// Rooms go where their links lead from the start room; a room whose place
// is already taken (the maps of the game are not always planar) and rooms
// no link reaches end up in an extra row at the bottom.

const used = Math.min(level.usedRooms, 24);
const place = new Map();      // room → {x, y}
const taken = new Map();      // "x,y" → room
const queue = [level.startRoom];
place.set(level.startRoom, {x: 0, y: 0});
taken.set('0,0', level.startRoom);
const leftovers = [];
while (queue.length) {
  const room = queue.shift();
  const at = place.get(room);
  const links = level.roomlinks[room-1];
  const steps = [[links.left, -1, 0], [links.right, 1, 0], [links.up, 0, -1], [links.down, 0, 1]];
  for (const [next, dx, dy] of steps) {
    if (!next || next > used || place.has(next) || leftovers.includes(next)) {
      continue;
    }
    const key = `${at.x+dx},${at.y+dy}`;
    if (taken.has(key)) {
      leftovers.push(next);
      continue;
    }
    place.set(next, {x: at.x+dx, y: at.y+dy});
    taken.set(key, next);
    queue.push(next);
  }
}
for (let room = 1; room <= used; room++) {
  if (!place.has(room) && !leftovers.includes(room)) {
    leftovers.push(room);
  }
}
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
for (const at of place.values()) {
  minX = Math.min(minX, at.x); maxX = Math.max(maxX, at.x);
  minY = Math.min(minY, at.y); maxY = Math.max(maxY, at.y);
}
leftovers.forEach((room, i) => {
  place.set(room, {x: minX+i, y: maxY+1});
  maxX = Math.max(maxX, minX+i);
});
if (leftovers.length) {
  maxY++;
}
const columns = maxX-minX+1;
const rows = maxY-minY+1;

// ------------------------------------------------------------------- drawing

const ROOM_W = 320, ROOM_H = 192;
const map = new Uint8Array(columns*ROOM_W*rows*ROOM_H);
const lut = loaded.lut;
if (roomsDir) {
  fs.mkdirSync(path.resolve(root, roomsDir), {recursive: true});
}
let drawn = 0;
for (const [room, at] of [...place.entries()].sort((a, b) => a[0]-b[0])) {
  const screen = renderRoom(loaded, room);
  drawn++;
  const ox = (at.x-minX)*ROOM_W, oy = (at.y-minY)*ROOM_H;
  for (let y = 0; y < ROOM_H; y++) {
    map.set(screen.bytes.subarray(y*ROOM_W, (y+1)*ROOM_W), (oy+y)*columns*ROOM_W+ox);
  }
  if (roomsDir) {
    const file = path.resolve(root, roomsDir, `level${pad2(levelNumber)}-room${pad2(room)}.png`);
    fs.writeFileSync(file, encodeIndexedPNG(320, 200, screen.bytes, lut));
  }
}
fs.mkdirSync(path.dirname(outFile), {recursive: true});
fs.writeFileSync(outFile, encodeIndexedPNG(columns*ROOM_W, rows*ROOM_H, map, lut));

const layout = [];
for (let y = minY; y <= maxY; y++) {
  const line = [];
  for (let x = minX; x <= maxX; x++) {
    const room = taken.get(`${x},${y}`) || leftovers.find((r) => place.get(r).x === x && place.get(r).y === y);
    line.push(room ? String(room).padStart(2) : ' .');
  }
  layout.push('  '+line.join(' '));
}
console.log(`level ${levelNumber} (${palace ? 'palace' : 'dungeon'}): ${drawn} rooms, ${columns}x${rows} cells, start room ${level.startRoom}`);
console.log(layout.join('\n'));
if (leftovers.length) {
  console.log(`  placed in the extra bottom row (no free cell along their links): ${leftovers.join(', ')}`);
}
console.log(`${path.relative(root, outFile)}: ${columns*ROOM_W}x${rows*ROOM_H}${roomsDir ? `, rooms in ${roomsDir}/` : ''}`);
