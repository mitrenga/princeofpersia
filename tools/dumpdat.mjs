#!/usr/bin/env node
/**
 * dumpdat — unpacks the original DAT files of Prince of Persia (DOS 1.0)
 * from assets/original/ into open formats in data/, following
 * tools/dumpdat.spec.json:
 *
 *   data/gfx/<set>.json       one chtab: palette + images as base64 pixels
 *                             (0..15 per byte, width*height) — what the game
 *                             loads (app/pop/chtab.js)
 *   data/gfx/<set>.png        the same as an indexed sprite sheet, for the eye
 *   data/levels/levelNN.json  the 16 levels (app/pop/levelData.js)
 *   data/sounds/digi/*.wav    digitised sounds, 8-bit unsigned mono
 *   data/sounds/speaker.json  PC speaker tunes (tempo + notes)
 *   data/sounds/midi/*.mid    AdLib music as standard MIDI files
 *   data/guardPalettes.json   the 7 guard colour sets
 *   data/misc/*.json          resources nobody has identified yet
 *   data/exe/tables.json      the animation sequences and frame tables out
 *                             of PRINCE.EXE (app/pop/sequences.js, frames.js)
 *   data/manifest.json        which source files (sha256) this came from
 *
 * The parsers of the level record come from the game (app/pop/), so what
 * ends up in data/ is what the game's own code reads back; the container
 * and image codecs are in tools/lib/datlib.mjs. Nothing from the original
 * files is committed but this output — and even that is derived from the
 * operator's copy, so ask before committing data/.
 *
 * usage: node tools/dumpdat.mjs [spec.json] [--only gfx|levels|sounds|tables|exe]
 */
import '../app/svision/tools/nodeEnv.mjs';   // must come first: the import headers read window.srcVersion
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {DATFile, decodeImage, parsePalette, parseSound, toBase64} from './lib/datlib.mjs';
import {encodeIndexedPNG} from '../app/svision/tools/retro/png.mjs';

const { PoPLevel } = await import('../app/pop/levelData.js');
const { PCMSample } = await import('../app/svision/js/audio/pcmSample.js');
const { speakerSeconds } = await import('../app/pop/sounds.js');
const { MidiFile } = await import('../app/svision/js/audio/midiFile.js');
const { AdlibMidi } = await import('../app/svision/js/audio/chip/adlibMidi.js');

const args = process.argv.slice(2);
const onlyAt = args.indexOf('--only');
const only = onlyAt >= 0 ? args[onlyAt+1] : null;
const positional = args.filter((a, i) => !a.startsWith('--') && i !== onlyAt+1);
const here = path.dirname(new URL(import.meta.url).pathname);
const specFile = positional[0] || path.join(here, 'dumpdat.spec.json');
const specDir = path.dirname(path.resolve(specFile));
const spec = JSON.parse(fs.readFileSync(specFile, 'utf8'));
const originalDir = path.resolve(specDir, spec.originalDir);
const dataDir = path.resolve(specDir, spec.dataDir);

const dats = new Map();
const manifest = {tool: 'tools/dumpdat.mjs', spec: path.basename(specFile), sources: {}, outputs: []};

function openDat(name) {
  if (!dats.has(name)) {
    const file = path.join(originalDir, name);
    if (!fs.existsSync(file)) {
      throw new Error('missing '+file+' — see assets/original/README.md');
    }
    const dat = DATFile.open(file);
    let bad = 0;
    for (const id of dat.ids) {
      if (!dat.checksumValid(id)) {
        bad++;
      }
    }
    if (bad) {
      console.log(`  WARNING ${name}: ${bad} resources with a wrong checksum`);
    }
    manifest.sources[name] = {
      sha256: crypto.createHash('sha256').update(dat.bytes).digest('hex'),
      size: dat.bytes.length,
      resources: dat.entries.length,
      checksumErrors: bad
    };
    dats.set(name, dat);
  }
  return dats.get(name);
} // openDat

function writeJSON(relative, value) {
  const file = path.join(dataDir, relative);
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, JSON.stringify(value, null, 1)+'\n');
  manifest.outputs.push(relative);
} // writeJSON

function writeBytes(relative, bytes) {
  const file = path.join(dataDir, relative);
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, bytes);
  manifest.outputs.push(relative);
} // writeBytes

const pad2 = (n) => String(n).padStart(2, '0');

// ------------------------------------------------------------------- graphics

function imageRecord(id, bytes) {
  const image = decodeImage(bytes);
  return {
    id, width: image.width, height: image.height, depth: image.depth,
    method: image.method, flags: image.flags, pixels: toBase64(image.pixels)
  };
} // imageRecord

/**
 * Lays the images of a set out on one indexed PNG: the 16 colours of the
 * set, colour 0 transparent, a grey-blue background as entry 16.
 */
function sheet(records, vga) {
  const images = records.filter(Boolean);
  const pad = 2, maxWidth = 640;
  let x = pad, y = pad, rowHeight = 0, width = 0;
  const placed = [];
  for (const r of images) {
    if (x+r.width+pad > maxWidth && x > pad) {
      x = pad; y += rowHeight+pad; rowHeight = 0;
    }
    placed.push({r, x, y});
    x += r.width+pad;
    rowHeight = Math.max(rowHeight, r.height);
    width = Math.max(width, x);
  }
  const height = y+rowHeight+pad;
  const pixels = new Uint8Array(width*height).fill(16);
  for (const p of placed) {
    const src = Buffer.from(p.r.pixels, 'base64');
    for (let line = 0; line < p.r.height; line++) {
      pixels.set(src.subarray(line*p.r.width, (line+1)*p.r.width), (p.y+line)*width+p.x);
    }
  }
  const palette = new Uint8Array(17*3);
  for (let i = 0; i < 48; i++) {
    palette[i] = (vga[i] << 2) | (vga[i] >> 4);
  }
  palette.set([0x40, 0x40, 0x60], 48);
  return encodeIndexedPNG(width, height, pixels, palette, {transparent: 0});
} // sheet

function dumpGraphics() {
  console.log('graphics:');
  for (const [name, entry] of Object.entries(spec.graphics)) {
    const dat = openDat(entry.file);
    const base = entry.resource;
    let palette, palettes;
    if (entry.paletteFiles) {
      palettes = {};
      for (const [kind, file] of Object.entries(entry.paletteFiles)) {
        palettes[kind] = parsePalette(openDat(file).resource(base));
      }
      palette = palettes[Object.keys(palettes)[0]];
    } else {
      palette = parsePalette(dat.resource(base));
    }
    const images = [];
    let present = 0;
    for (let k = 1; k <= palette.nImages; k++) {
      const bytes = dat.resource(base+k);
      if (!bytes || bytes.length <= 2) {   // an empty slot, the way SDLPoP treats it
        images.push(null);
        continue;
      }
      images.push(imageRecord(base+k, bytes));
      present++;
    }
    let optional;
    if (entry.optional) {
      optional = {};
      for (const id of dat.ids) {
        if (id > entry.optional && id < entry.optional+1000) {
          const bytes = dat.resource(id);
          if (bytes.length > 2) {   // an empty optional slot changes nothing
            optional[id-entry.optional] = imageRecord(id, bytes);
          }
        }
      }
    }
    const record = {
      format: 'pop-chtab-1',
      name,
      source: entry.file,
      resource: base,
      paletteRow: entry.paletteRow,
      note: entry.note,
      palette,
      images
    };
    if (palettes) {
      record.palettes = palettes;
      record.paletteFiles = entry.paletteFiles;
    }
    if (optional) {
      record.optional = optional;
    }
    writeJSON(`gfx/${name}.json`, record);
    const all = images.concat(optional ? Object.values(optional) : []);
    writeBytes(`gfx/${name}.png`, sheet(all, palette.vga));
    const opt = optional ? `, ${Object.keys(optional).length} optional` : '';
    console.log(`  ${name.padEnd(20)} ${entry.file.padEnd(13)} ${String(base).padStart(4)}: ${present} images of ${palette.nImages}${opt}, palette row ${entry.paletteRow}`);
  }
} // dumpGraphics

// --------------------------------------------------------------------- levels

function dumpLevels() {
  console.log('levels:');
  const dat = openDat(spec.levels.file);
  let ok = 0;
  for (let n = 0; n < spec.levels.count; n++) {
    const bytes = dat.resource(spec.levels.first+n);
    const level = PoPLevel.fromBytes(bytes);
    const back = level.toBytes();
    const same = back.length === bytes.length && back.every((b, i) => b === bytes[i]);
    if (same) {
      ok++;
    } else {
      console.log(`  DIFF level ${n}: toBytes() differs from the resource`);
    }
    writeJSON(`levels/level${pad2(n)}.json`, level.toJSON(n));
  }
  console.log(`  ${spec.levels.count} levels, ${ok} read back byte for byte`);
} // dumpLevels

// --------------------------------------------------------------------- sounds

function dumpSounds() {
  console.log('sounds:');
  const names = spec.sounds.names;
  const digi = {format: 'pop-sounds-digi-2', note: '8-bit unsigned mono WAV per sound and the same bytes as base64 (pcm) for the game; the original plays them through the DAC at the given rate; seconds = samples/rate', sounds: {}};
  const speaker = {format: 'pop-sounds-speaker-2', note: 'PC speaker: tempo, then notes [frequency, length]; frequency 0/1 = rest, 0x12 = end (SDLPoP types.h note_type); loop = bit 7 of the type byte; empty = a type byte and nothing else (unused sound); seconds = sum of length/tempo up to the end mark', sounds: {}};
  const midi = {format: 'pop-sounds-midi-3', note: 'AdLib music, standard MIDI files as stored (type byte stripped); the same bytes as base64 (midi) for the game, which plays them through app/svision/js/audio/chip/adlibMidi.js; seconds from the tempo map (svision MidiFile)', sounds: {}};
  const counts = {digi: 0, speaker: 0, midi: 0, other: 0};
  for (const file of spec.sounds.files) {
    const dat = openDat(file);
    for (const id of dat.ids) {
      const index = id-spec.sounds.first;
      const name = names[index] || ('sound-'+index);
      const slug = `${pad2(index)}-${name}`;
      const sound = parseSound(dat.resource(id), spec.sounds.digiLayout);
      const common = {index, name, source: file, resource: id, typeByte: sound.typeByte, loop: sound.loop};
      if (sound.type === 'digi' && sound.samples) {
        const wav = PCMSample.fromUnsigned8(sound.samples, sound.rate).toWAV(8);
        writeBytes(`sounds/digi/${slug}.wav`, wav);
        digi.sounds[index] = {...common, file: `digi/${slug}.wav`, layout: sound.layout, rate: sound.rate,
          count: sound.count, samples: sound.samples.length, unknown: sound.unknown,
          seconds: sound.samples.length/sound.rate, pcm: toBase64(sound.samples)};
        counts.digi++;
      } else if (sound.type === 'speaker') {
        speaker.sounds[index] = {...common, empty: sound.empty || undefined, tempo: sound.tempo, notes: sound.notes, tail: sound.tail,
          seconds: speakerSeconds(sound.tempo, sound.notes)};
        counts.speaker++;
      } else if (sound.type === 'midi') {
        writeBytes(`sounds/midi/${slug}.mid`, sound.file);
        const parsed = MidiFile.fromBytes(sound.file);
        midi.sounds[index] = {...common, file: `midi/${slug}.mid`, size: sound.file.length,
          seconds: parsed ? parsed.seconds : 0, midi: toBase64(sound.file)};
        counts.midi++;
      } else {
        console.log(`  ? ${file} ${id}: type ${sound.type} (${sound.typeByte})`);
        counts.other++;
      }
    }
  }
  dumpInstruments();
  writeJSON('sounds/digi.json', digi);
  writeJSON('sounds/speaker.json', speaker);
  writeJSON('sounds/midi.json', midi);
  console.log(`  ${counts.digi} digitised, ${counts.speaker} speaker, ${counts.midi} midi${counts.other ? ', '+counts.other+' unknown' : ''}`);
} // dumpSounds

/**
 * The AdLib instrument table (resource 1 of PRINCE.DAT): a count byte and
 * sixteen bytes an instrument, which is the register set of one two operator
 * voice. The bytes go into the file as they are — that is what the driver is
 * handed — with the instruments read out beside them for the eye.
 */
function dumpInstruments() {
  const entry = spec.sounds.instruments;
  const bytes = openDat(entry.file).resource(entry.resource);
  const count = bytes[0];
  const instruments = AdlibMidi.bank(bytes);
  writeJSON('sounds/instruments.json', {format: 'pop-adlib-instruments-1', source: entry.file,
    resource: entry.resource, note: entry.note, count, instruments, bytes: toBase64(bytes)});
  console.log(`  instruments: ${count} AdLib instruments (${bytes.length} bytes)`);
} // dumpInstruments

// --------------------------------------------------------------------- tables

function dumpTables() {
  console.log('tables:');
  const gp = spec.tables.guardPalettes;
  const bytes = openDat(gp.file).resource(gp.resource);
  const sets = [];
  for (let at = 0; at+48 <= bytes.length; at += 48) {
    const colors = [];
    for (let c = 0; c < 16; c++) {
      colors.push([bytes[at+c*3], bytes[at+c*3+1], bytes[at+c*3+2]]);
    }
    sets.push(colors);
  }
  writeJSON('guardPalettes.json', {format: 'pop-guard-palettes-1', source: gp.file, resource: gp.resource,
    note: gp.note, sets});
  console.log(`  guardPalettes: ${sets.length} sets of 16 colours (${bytes.length} bytes)`);

  const unk = spec.unknown;
  const dat = openDat(unk.file);
  for (const id of unk.resources) {
    const res = dat.resource(id);
    writeJSON(`misc/${unk.file.replace('.DAT', '').toLowerCase()}-res${id}.json`, {
      source: unk.file, resource: id, size: res.length, note: unk.note, base64: toBase64(res)
    });
    console.log(`  ${unk.file} ${id}: ${res.length} bytes, unidentified`);
  }
} // dumpTables

// ------------------------------------------------------------------------ exe

const s8 = (b) => ((b & 0xFF) ^ 0x80)-0x80;

/**
 * Finds a table in the executable by the first bytes of its content.
 * @returns {{offset, bytes}}
 */
export function findTable(exe, table, name) {
  const pattern = Buffer.from(table.pattern, 'hex');
  const offset = exe.indexOf(pattern);
  if (offset < 0) {
    throw new Error(`${name}: pattern ${table.pattern} not found in the executable`);
  }
  const length = table.length !== undefined ? table.length : table.entries*table.stride;
  return {offset, bytes: exe.subarray(offset, offset+length)};
} // findTable

function dumpExe() {
  console.log('exe:');
  const spec_ = spec.exe;
  const file = path.join(originalDir, spec_.file);
  const exe = fs.readFileSync(file);
  manifest.sources[spec_.file] = {sha256: crypto.createHash('sha256').update(exe).digest('hex'), size: exe.length};
  const t = spec_.tables;
  const seq = findTable(exe, t.seqtbl, 'seqtbl');
  const dataBase = seq.offset-t.seqtbl.base;
  const offsetsAt = dataBase+t.seqOffsets.dataOffset;
  const seqOffsets = [];
  for (let i = 0; i < t.seqOffsets.entries; i++) {
    seqOffsets.push(exe.readUInt16LE(offsetsAt+i*2));
  }
  const frames = {};
  const found = {seqtbl: seq.offset, seqOffsets: offsetsAt};
  for (const [key, name] of [['frameKid', 'kid'], ['frameGuard', 'guard'], ['frameCuts', 'cuts']]) {
    const table = findTable(exe, t[key], key);
    found[key] = table.offset;
    const rows = [];
    for (let i = 0; i < t[key].entries; i++) {
      const b = table.bytes.subarray(i*5, i*5+5);
      rows.push([b[0], b[1], s8(b[2]), s8(b[3]), b[4]]);   // image, sword, dx, dy, flags
    }
    frames[name] = rows;
  }
  const sw = findTable(exe, t.swords, 'swords');
  found.swords = sw.offset;
  const swords = [];
  for (let i = 0; i < t.swords.entries; i++) {
    swords.push([sw.bytes[i*3], s8(sw.bytes[i*3+1]), s8(sw.bytes[i*3+2])]);
  }
  writeJSON('exe/tables.json', {
    format: 'pop-exe-tables-1',
    source: spec_.file,
    note: spec_.note,
    fileOffsets: found,
    seqtbl: {base: t.seqtbl.base, length: seq.bytes.length, bytes: seq.bytes.toString('base64')},
    seqOffsets,
    frames,
    framesNote: '[image (0-based index into the chtab), sword (bits 0-5 sword frame, 6-7 chtab), dx, dy, flags (bits 0-4 weight x, 0x20 thin, 0x40 needs floor, 0x80 odd pixel)]',
    swords,
    swordsNote: '[image of the sword chtab, dx, dy] per sword frame'
  });
  console.log(`  seqtbl ${seq.bytes.length} bytes at 0x${seq.offset.toString(16)} (data segment at 0x${dataBase.toString(16)}), ${seqOffsets.length} sequence offsets`);
  console.log(`  frames: kid ${frames.kid.length}, guard ${frames.guard.length}, cuts ${frames.cuts.length}; ${swords.length} sword positions`);
} // dumpExe

// ----------------------------------------------------------------------- main

fs.mkdirSync(dataDir, {recursive: true});
if (!only || only === 'gfx') dumpGraphics();
if (!only || only === 'levels') dumpLevels();
if (!only || only === 'sounds') dumpSounds();
if (!only || only === 'tables') dumpTables();
if (!only || only === 'exe') dumpExe();
if (!only) {
  manifest.outputs.sort();
  writeJSON('manifest.json', manifest);
}
console.log(`written to ${path.relative(process.cwd(), dataDir) || '.'}: ${manifest.outputs.length} files from ${Object.keys(manifest.sources).length} DAT files`);
