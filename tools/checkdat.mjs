#!/usr/bin/env node
/**
 * checkdat — the round trip over the original DAT files: what
 * tools/dumpdat.mjs wrote to data/ is turned back into bytes and compared
 * with the resources, and every resource of every DAT is verified
 * structurally. The report has the shape of the match tools: the number
 * of checks and the number of differences; the exit code is the number
 * of differences.
 *
 * Checked, per resource:
 *   - the checksum byte (★ complement of the sum of the data bytes)
 *   - images: the compressed stream decodes to exactly stride*height bytes
 *     and is consumed to its last byte; the pixels equal data/gfx/*.json
 *   - palettes: parse → serialize → the same 100 bytes
 *   - levels: data/levels/*.json → app/pop/levelData.js → the same 2305 bytes
 *   - digitised sounds: data/sounds/digi/*.wav → samples → the same resource
 *   - speaker tunes and MIDI files: the same bytes
 *   - guard palettes: the same bytes
 *   - PRINCE.EXE tables: found at the recorded offsets, data/exe/tables.json
 *     rebuilds the same bytes
 *
 * `--encode` also packs every image again with our RLE/LZG packers and
 * counts how many come out identical to the original's bytes. That is a
 * measurement of how the original's packer worked, not a check: a
 * different but equivalent encoding is not a defect, so it is reported
 * separately and does not count as a difference.
 *
 * usage: node tools/checkdat.mjs [spec.json] [-v] [--encode]
 */
import '../app/svision/tools/nodeEnv.mjs';   // must come first
import fs from 'node:fs';
import path from 'node:path';
import {DATFile, decodeImage, encodeImage, parsePalette, serializePalette, parseSound,
        serializeSpeaker, serializeDigi, fromBase64, equalBytes, IMAGE_METHOD} from './lib/datlib.mjs';

const { PoPLevel } = await import('../app/pop/levelData.js');
const { PCMSample } = await import('../app/svision/js/audio/pcmSample.js');
const { speakerSeconds } = await import('../app/pop/sounds.js');
const { MidiFile } = await import('../app/svision/js/audio/midiFile.js');
const { AdlibMidi } = await import('../app/svision/js/audio/chip/adlibMidi.js');

const args = process.argv.slice(2);
const verbose = args.includes('-v');
const doEncode = args.includes('--encode');
const positional = args.filter((a) => !a.startsWith('-'));
const here = path.dirname(new URL(import.meta.url).pathname);
const specFile = positional[0] || path.join(here, 'dumpdat.spec.json');
const specDir = path.dirname(path.resolve(specFile));
const spec = JSON.parse(fs.readFileSync(specFile, 'utf8'));
const originalDir = path.resolve(specDir, spec.originalDir);
const dataDir = path.resolve(specDir, spec.dataDir);

let checks = 0;
let differences = 0;

function check(name, ok, detail) {
  checks++;
  if (!ok) {
    differences++;
    console.log(`  DIFF ${name}${detail ? ': '+detail : ''}`);
  } else if (verbose) {
    console.log(`  ok   ${name}`);
  }
} // check

const dats = new Map();
function openDat(name) {
  if (!dats.has(name)) {
    dats.set(name, DATFile.open(path.join(originalDir, name)));
  }
  return dats.get(name);
} // openDat

function readJSON(relative) {
  const file = path.join(dataDir, relative);
  if (!fs.existsSync(file)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
} // readJSON

const pad2 = (n) => String(n).padStart(2, '0');

// ------------------------------------------------------------------ container

console.log('container:');
{
  const notDat = new Set(spec.notDAT || []);
  const files = fs.readdirSync(originalDir).filter((f) => f.endsWith('.DAT') && !notDat.has(f)).sort();
  let resources = 0;
  for (const name of files) {
    const dat = openDat(name);
    const view = new DataView(dat.bytes.buffer, dat.bytes.byteOffset, dat.bytes.byteLength);
    check(`${name} table inside the file`, dat.tableOffset+dat.tableSize <= dat.bytes.length);
    check(`${name} table size = 2 + 8*count`, dat.tableSize === 2+8*dat.entries.length, `${dat.tableSize} vs ${2+8*dat.entries.length}`);
    for (const entry of dat.entries) {
      check(`${name} ${entry.id} inside the file`, entry.offset+1+entry.size <= dat.tableOffset || entry.offset+1+entry.size <= dat.bytes.length);
      check(`${name} ${entry.id} checksum`, dat.checksumValid(entry.id));
      resources++;
    }
    void view;
  }
  console.log(`  ${files.length} DAT files, ${resources} resources`);
}

// ------------------------------------------------------------------- graphics

console.log('graphics:');
{
  const encodeStats = {};
  let images = 0;
  for (const [name, entry] of Object.entries(spec.graphics)) {
    const dat = openDat(entry.file);
    const base = entry.resource;
    const paletteFiles = entry.paletteFiles ? Object.values(entry.paletteFiles) : [entry.file];
    let nImages = 0;
    for (const file of paletteFiles) {
      const bytes = openDat(file).resource(base);
      check(`${name} palette ${file} is 100 bytes`, bytes && bytes.length === 100);
      const pal = parsePalette(bytes);
      check(`${name} palette ${file} round trip`, equalBytes(serializePalette(pal), bytes));
      nImages = pal.nImages;
    }
    const data = readJSON(`gfx/${name}.json`);
    check(`${name} data/gfx/${name}.json exists`, data !== null);
    const ids = [];
    for (let k = 1; k <= nImages; k++) {
      ids.push({id: base+k, slot: k, where: data ? data.images[k-1] : null});
    }
    if (entry.optional) {
      for (const id of dat.ids) {
        if (id > entry.optional && id < entry.optional+1000) {
          ids.push({id, slot: id-entry.optional, where: data && data.optional ? data.optional[id-entry.optional] : null, optional: true});
        }
      }
    }
    for (const item of ids) {
      const bytes = dat.resource(item.id);
      if (!bytes || bytes.length <= 2) {
        check(`${name} ${item.id} empty slot recorded as null`, data === null || !item.where);
        continue;
      }
      let image;
      try {
        image = decodeImage(bytes);
      } catch (e) {
        check(`${name} ${item.id} decodes`, false, e.message);
        continue;
      }
      images++;
      check(`${name} ${item.id} stream consumed to the end`, image.consumed === bytes.length-6,
            `${image.consumed} of ${bytes.length-6} bytes (${IMAGE_METHOD[image.method]})`);
      if (data) {
        const ok = item.where && item.where.width === image.width && item.where.height === image.height &&
          equalBytes(fromBase64(item.where.pixels), image.pixels);
        check(`${name} ${item.id} pixels equal data/`, !!ok);
      }
      if (doEncode) {
        const method = IMAGE_METHOD[image.method];
        const stat = encodeStats[method] || (encodeStats[method] = {same: 0, total: 0, smaller: 0, larger: 0});
        stat.total++;
        const again = encodeImage(image, image.method);
        if (equalBytes(again, bytes)) {
          stat.same++;
        } else if (again.length < bytes.length) {
          stat.smaller++;
        } else if (again.length > bytes.length) {
          stat.larger++;
        }
        // whatever the packing, unpacking it must give the pixels back
        const back = decodeImage(again);
        check(`${name} ${item.id} our packing unpacks to the same pixels`, equalBytes(back.pixels, image.pixels));
      }
    }
  }
  console.log(`  ${Object.keys(spec.graphics).length} sets, ${images} images`);
  if (doEncode) {
    console.log('  re-encode measurement (not counted as differences):');
    for (const [method, s] of Object.entries(encodeStats)) {
      console.log(`    ${method.padEnd(12)} ${s.same}/${s.total} identical, ${s.smaller} ours smaller, ${s.larger} ours larger`);
    }
  }
}

// --------------------------------------------------------------------- levels

console.log('levels:');
{
  const dat = openDat(spec.levels.file);
  for (let n = 0; n < spec.levels.count; n++) {
    const bytes = dat.resource(spec.levels.first+n);
    check(`level ${n} is 2305 bytes (2304 for level 15)`, bytes.length === (n === 15 ? PoPLevel.BYTES-1 : PoPLevel.BYTES), String(bytes.length));
    check(`level ${n} bytes → level → bytes`, equalBytes(PoPLevel.fromBytes(bytes).toBytes(), bytes));
    const json = readJSON(`levels/level${pad2(n)}.json`);
    check(`level ${n} data/levels json exists`, json !== null);
    if (json) {
      check(`level ${n} json → level → bytes`, equalBytes(PoPLevel.fromJSON(json).toBytes(), bytes));
    }
  }
  console.log(`  ${spec.levels.count} levels`);
}

// --------------------------------------------------------------------- sounds

console.log('sounds:');
{
  const digi = readJSON('sounds/digi.json');
  const speaker = readJSON('sounds/speaker.json');
  const midi = readJSON('sounds/midi.json');
  let n = 0;
  for (const file of spec.sounds.files) {
    const dat = openDat(file);
    for (const id of dat.ids) {
      const index = id-spec.sounds.first;
      const bytes = dat.resource(id);
      const sound = parseSound(bytes, spec.sounds.digiLayout);
      n++;
      if (sound.type === 'digi') {
        check(`${file} ${index} digi layout is 1.0`, sound.layout === '1.0', sound.layout);
        const entry = digi && digi.sounds[index];
        check(`${file} ${index} in data/sounds/digi.json`, !!entry);
        if (entry && sound.layout === '1.0') {
          const wav = new Uint8Array(fs.readFileSync(path.join(dataDir, 'sounds', entry.file)));
          const sample = PCMSample.fromWAV(wav);
          check(`${file} ${index} wav rate`, sample.sampleRate === sound.rate);
          const samples = sample.toUnsigned8();
          check(`${file} ${index} wav → digi resource`, equalBytes(serializeDigi(sound, samples), bytes));
          check(`${file} ${index} sample count field = samples`, sound.count === sound.samples.length, `${sound.count} vs ${sound.samples.length}`);
          check(`${file} ${index} pcm = wav samples`, equalBytes(new Uint8Array(Buffer.from(entry.pcm || '', 'base64')), samples));
          check(`${file} ${index} seconds = samples/rate`, entry.seconds === sound.samples.length/sound.rate);
        }
      } else if (sound.type === 'speaker') {
        const entry = speaker && speaker.sounds[index];
        check(`${file} ${index} in data/sounds/speaker.json`, !!entry);
        if (entry) {
          check(`${file} ${index} speaker json → resource`, equalBytes(serializeSpeaker(entry), bytes));
          check(`${file} ${index} seconds = notes/tempo`, entry.seconds === speakerSeconds(entry.tempo, entry.notes));
        }
      } else if (sound.type === 'midi') {
        const entry = midi && midi.sounds[index];
        check(`${file} ${index} in data/sounds/midi.json`, !!entry);
        if (entry) {
          const stored = new Uint8Array(fs.readFileSync(path.join(dataDir, 'sounds', entry.file)));
          check(`${file} ${index} midi file = resource`, equalBytes(stored, bytes.subarray(1)) && bytes[0] === entry.typeByte);
          check(`${file} ${index} midi base64 = the file`, equalBytes(fromBase64(entry.midi || ''), stored));
          const parsed = MidiFile.fromBytes(stored);
          check(`${file} ${index} parses as a MIDI file`, parsed !== null && parsed.events.length > 0);
          check(`${file} ${index} seconds from the tempo map`, parsed !== null && entry.seconds === parsed.seconds && entry.seconds > 0, entry.seconds);
        }
      } else {
        check(`${file} ${index} known sound type`, false, `type byte ${sound.typeByte}`);
      }
    }
  }
  const inst = spec.sounds.instruments;
  const instBytes = openDat(inst.file).resource(inst.resource);
  const instJSON = readJSON('sounds/instruments.json');
  check('instruments json exists', instJSON !== null);
  if (instJSON) {
    check('instruments json → resource', equalBytes(fromBase64(instJSON.bytes), instBytes));
    check('instruments count = the count byte', instJSON.count === instBytes[0] && instJSON.instruments.length === instBytes[0],
      `${instJSON.count} vs ${instBytes[0]}`);
    check('instruments resource size = 1 + count*16', instBytes.length === 1+instBytes[0]*AdlibMidi.INSTRUMENT_SIZE, instBytes.length);
    const read = AdlibMidi.bank(instBytes);
    check('instruments read back from the bytes', JSON.stringify(read) === JSON.stringify(instJSON.instruments));
  }
  console.log(`  ${n} sound resources, ${instJSON ? instJSON.count : 0} AdLib instruments`);
}

// --------------------------------------------------------------------- tables

console.log('tables:');
{
  const gp = spec.tables.guardPalettes;
  const bytes = openDat(gp.file).resource(gp.resource);
  const json = readJSON('guardPalettes.json');
  check('guardPalettes json exists', json !== null);
  if (json) {
    const back = new Uint8Array(json.sets.length*48);
    json.sets.forEach((set, s) => set.forEach((c, i) => back.set(c, s*48+i*3)));
    check('guardPalettes json → resource', equalBytes(back, bytes));
  }
  for (const id of spec.unknown.resources) {
    const res = openDat(spec.unknown.file).resource(id);
    const json = readJSON(`misc/${spec.unknown.file.replace('.DAT', '').toLowerCase()}-res${id}.json`);
    check(`${spec.unknown.file} ${id} kept in data/misc`, json !== null && equalBytes(fromBase64(json.base64), res));
  }
}

// ------------------------------------------------------------------------ exe

console.log('exe:');
{
  const exe = fs.readFileSync(path.join(originalDir, spec.exe.file));
  const json = readJSON('exe/tables.json');
  check('exe tables json exists', json !== null);
  if (json) {
    const t = spec.exe.tables;
    const s8 = (b) => ((b & 0xFF) ^ 0x80)-0x80;
    const seqBytes = exe.subarray(json.fileOffsets.seqtbl, json.fileOffsets.seqtbl+t.seqtbl.length);
    check('seqtbl pattern at the recorded offset', exe.indexOf(Buffer.from(t.seqtbl.pattern, 'hex')) === json.fileOffsets.seqtbl);
    check('seqtbl json = exe bytes', equalBytes(fromBase64(json.seqtbl.bytes), seqBytes));
    check('seqtbl ends with the last sequence (BA BA BC FF 70 22)', seqBytes.subarray(seqBytes.length-6).toString('hex') === 'bababcff7022');
    check('seqOffsets count', json.seqOffsets.length === t.seqOffsets.entries);
    let same = true;
    for (let i = 0; i < json.seqOffsets.length; i++) {
      if (exe.readUInt16LE(json.fileOffsets.seqOffsets+i*2) !== json.seqOffsets[i]) same = false;
    }
    check('seqOffsets json = exe words', same);
    check('seqOffsets[1] is startrun (0x1973)', json.seqOffsets[1] === 0x1973);
    for (const [key, name] of [['frameKid', 'kid'], ['frameGuard', 'guard'], ['frameCuts', 'cuts']]) {
      const at = json.fileOffsets[key];
      check(`${key} pattern at the recorded offset`, exe.indexOf(Buffer.from(t[key].pattern, 'hex')) === at);
      let ok = json.frames[name].length === t[key].entries;
      json.frames[name].forEach((row, i) => {
        const b = exe.subarray(at+i*5, at+i*5+5);
        if (!(row[0] === b[0] && row[1] === b[1] && row[2] === s8(b[2]) && row[3] === s8(b[3]) && row[4] === b[4])) ok = false;
      });
      check(`${key} json = exe rows`, ok);
    }
    let okSw = json.swords.length === t.swords.entries;
    json.swords.forEach((row, i) => {
      const b = exe.subarray(json.fileOffsets.swords+i*3, json.fileOffsets.swords+i*3+3);
      if (!(row[0] === b[0] && row[1] === s8(b[1]) && row[2] === s8(b[2]))) okSw = false;
    });
    check('swords json = exe rows', okSw);
  }
}

console.log(`checkdat.mjs: ${checks} kontrol, ${differences} rozdílů`);
process.exit(Math.min(differences, 255));
