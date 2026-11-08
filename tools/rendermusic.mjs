#!/usr/bin/env node
/**
 * rendermusic — plays the AdLib music of the original through svision's own
 * OPL2 and writes it as WAV, so that a piece can be listened to, held against
 * a recording of the card, and watched for changes when the chip is touched.
 *
 * The path is the game's: the MIDI file out of `data/sounds/midi.json`, the
 * instrument table out of `data/sounds/instruments.json`, the driver of the
 * era (`app/svision/js/audio/chip/adlibMidi.js`) in front of the chip — the
 * same code `app/audioManager.js` runs in the browser, only written to a file
 * instead of a bus. `--rate` is the one thing the game does differently: it
 * renders at half the chip's rate to save the memory (AudioManager.MUSIC_RATE).
 *
 * usage: node tools/rendermusic.mjs [--sound N] [--out build/music]
 *                                   [--rate 49716] [--seconds S] [--list]
 */
import '../app/svision/tools/nodeEnv.mjs';   // must come first
import fs from 'node:fs';
import path from 'node:path';

const { MidiFile } = await import('../app/svision/js/audio/midiFile.js');
const { AdlibMidi } = await import('../app/svision/js/audio/chip/adlibMidi.js');
const { PCMSample } = await import('../app/svision/js/audio/pcmSample.js');
const { MIDI_TEMPO_MODIFIER } = await import('../app/pop/sounds.js');

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const args = process.argv.slice(2);
function option(name, fallback) {
  const at = args.indexOf(name);
  return at >= 0 ? args[at+1] : fallback;
}
const only = args.includes('--sound') ? parseInt(option('--sound', '0'), 10) : null;
const outDir = path.resolve(root, option('--out', 'build/music'));
const rate = parseInt(option('--rate', '0'), 10) || undefined;
const seconds = args.includes('--seconds') ? parseFloat(option('--seconds', '0')) : undefined;
const list = args.includes('--list');

const dataDir = path.join(root, 'data', 'sounds');
const midi = JSON.parse(fs.readFileSync(path.join(dataDir, 'midi.json'), 'utf8'));
const table = JSON.parse(fs.readFileSync(path.join(dataDir, 'instruments.json'), 'utf8'));
const instruments = new Uint8Array(Buffer.from(table.bytes, 'base64'));

const indices = Object.keys(midi.sounds).map((key) => parseInt(key, 10))
  .filter((index) => only === null || index === only)
  .sort((a, b) => a-b);
if (!indices.length) {
  console.error(`no such piece${only === null ? '' : ' '+only}; --list shows them all`);
  process.exit(1);
}

if (list) {
  console.log(`${table.count} AdLib instruments, ${Object.keys(midi.sounds).length} pieces:`);
  for (const index of indices) {
    const record = midi.sounds[index];
    const modifier = MIDI_TEMPO_MODIFIER[index] || 0;
    console.log(`  ${String(index).padStart(2)} ${record.name.padEnd(24)} ${record.seconds.toFixed(2).padStart(7)} s` +
      `${modifier ? `  tempo ${modifier > 0 ? '+' : ''}${(modifier*100).toFixed(0)} %` : ''}`);
  }
  process.exit(0);
}

fs.mkdirSync(outDir, {recursive: true});
let total = 0, elapsed = 0;
for (const index of indices) {
  const record = midi.sounds[index];
  const file = MidiFile.fromBytes(new Uint8Array(Buffer.from(record.midi, 'base64')));
  if (file === null) {
    console.log(`  ${index} ${record.name}: not a MIDI file`);
    continue;
  }
  const player = new AdlibMidi({instruments, sampleRate: rate, tempoModifier: MIDI_TEMPO_MODIFIER[index] || 0});
  player.play(file);
  const started = Date.now();
  const sample = new PCMSample(player.renderAll(seconds), player.sampleRate);
  elapsed += Date.now()-started;
  total += sample.duration;
  const name = `${String(index).padStart(2, '0')}-${record.name}.wav`;
  fs.writeFileSync(path.join(outDir, name), sample.toWAV(16));
  console.log(`  ${String(index).padStart(2)} ${record.name.padEnd(24)} ${sample.duration.toFixed(2).padStart(7)} s` +
    ` → ${path.relative(root, path.join(outDir, name))}  (${file.events.length} events` +
    `${player.dropped ? `, ${player.dropped} notes over nine voices` : ''})`);
}
console.log(`${indices.length} pieces, ${total.toFixed(1)} s of music rendered in ${(elapsed/1000).toFixed(1)} s ` +
  `at ${Math.round(new AdlibMidi({sampleRate: rate}).sampleRate)} Hz`);
