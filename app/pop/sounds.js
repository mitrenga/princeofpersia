// begin code

/**
 * The sounds of the original, as the program treats them (SDLPoP `seg000.c`
 * `play_sound` / `play_next_sound`, `seg009.c`): 58 numbered sounds, each
 * present as a PC speaker tune, a digitised sample and/or an AdLib (MIDI)
 * piece. The game asks for sounds during a frame; the loudest by priority
 * wins, and it starts only when nothing plays or the playing one gives way
 * (`sound_interruptible`). One sound at a time — a DAC.
 *
 * Nothing here touches the Web Audio API: the scheduler counts frames, and
 * whether a sound "still plays" (`check_sound_playing`, which the physics
 * reads — the level 1 crouch, the feather fall, the end of a level) comes
 * from the sound's length in seconds, not from the speaker. A run is thus
 * repeatable from its seed and its inputs alone (R-009), and the tools can
 * run it without sound (`silent`, the `POP_TRACE_SILENT` of the trace patch).
 * The lengths are computed by `tools/dumpdat.mjs` — with the function below
 * for the speaker, with svision's `MidiFile` for the AdLib music — and
 * stored in `data/sounds/*.json`.
 */

/** the numbered sounds the code refers to by name (`enum sound_ids`) */
export const SOUND = {
  FELL_TO_DEATH: 0, FALLING: 1, TILE_CRASHING: 2, BUTTON_PRESSED: 3, GATE_CLOSING: 4, GATE_OPENING: 5,
  GATE_CLOSING_FAST: 6, GATE_STOP: 7, BUMPED: 8, GRAB: 9, SWORD_VS_SWORD: 10, SWORD_MOVING: 11,
  GUARD_HURT: 12, KID_HURT: 13, LEVELDOOR_CLOSING: 14, LEVELDOOR_SLIDING: 15, MEDIUM_LAND: 16,
  SOFT_LAND: 17, DRINK: 18, DRAW_SWORD: 19, LOOSE_SHAKE_1: 20, LOOSE_SHAKE_2: 21, LOOSE_SHAKE_3: 22,
  FOOTSTEP: 23, DEATH_REGULAR: 24, PRESENTATION: 25, EMBRACE: 26, CUTSCENE_2_4_6_12: 27,
  DEATH_IN_FIGHT: 28, MEET_JAFFAR: 29, BIG_POTION: 30, SHADOW_MUSIC: 32, SMALL_POTION: 33,
  CUTSCENE_8_9: 35, OUT_OF_TIME: 36, VICTORY: 37, BLINK: 38, LOW_WEIGHT: 39, CUTSCENE_12_SHORT_TIME: 40,
  END_LEVEL_MUSIC: 41, VICTORY_JAFFAR: 43, SKEL_ALIVE: 44, JUMP_THROUGH_MIRROR: 45, CHOMPED: 46,
  CHOMPER: 47, SPIKED: 48, SPIKES: 49, STORY_2_PRINCESS: 50, PRINCESS_DOOR_OPENING: 51,
  STORY_4_JAFFAR_LEAVES: 52, STORY_3_JAFFAR_COMES: 53, INTRO_MUSIC: 54, STORY_1_ABSENCE: 55,
  ENDING_MUSIC: 56
};

/** the priority of every sound — lower wins (`sound_prio_table`, PRINCE.EXE 1.0 values) */
export const SOUND_PRIORITY = [
  0x14, 0x1E, 0x23, 0x66, 0x32, 0x37, 0x30, 0x30, 0x4B, 0x50, 0x0A, 0x12, 0x0C, 0x0B, 0x69, 0x6E,
  0x73, 0x78, 0x7D, 0x82, 0x91, 0x96, 0x9B, 0xA0, 0x01, 0x01, 0x01, 0x01, 0x01, 0x13, 0x01, 0x01,
  0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x01, 0x01, 0x01, 0x01, 0x87, 0x8C, 0x0F, 0x10,
  0x19, 0x16, 0x01, 0x00, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00
];

/** whether a playing sound gives way to a louder one (`sound_interruptible`) */
export const SOUND_INTERRUPTIBLE = [
  0, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0,
  1, 1, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0
];

/** whether the PC speaker version of a sound is meant to be heard (`sound_pcspeaker_exists`) */
export const SOUND_PCSPEAKER_EXISTS = [
  1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1,
  1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 0
];

/** the game frame, 1/12 s */
const FRAME_SECONDS = 1/12;

// ------------------------------------------------------------------ lengths

/**
 * How long a PC speaker tune plays (`speaker_callback`: a note of length
 * `l` lasts `l/tempo` seconds; 0x12 ends the tune; the tail after it is
 * ignored).
 * @param {number} tempo
 * @param {Array} notes - `[frequency, length]` pairs.
 * @returns {number} Seconds.
 */
export function speakerSeconds(tempo, notes) {
  if (!tempo) {
    return 0;
  }
  var total = 0;
  for (var i = 0; i < notes.length; i++) {
    if (notes[i][0] === 0x12) {
      break;
    }
    total += notes[i][1]/tempo;
  }
  return total;
} // speakerSeconds

/**
 * A PC speaker tune as samples, the way SDLPoP renders it: a square wave
 * per note, silence for a rest (frequency 0 or 1), until the end mark.
 * @param {number} tempo
 * @param {Array} notes - `[frequency, length]` pairs.
 * @param {number} sampleRate
 * @param {number} [volume=0.5]
 * @returns {Float32Array} Mono samples, -1..1.
 */
export function speakerSamples(tempo, notes, sampleRate, volume) {
  var level = volume === undefined ? 0.5 : volume;
  var count = Math.round(speakerSeconds(tempo, notes)*sampleRate);
  var samples = new Float32Array(count);
  var at = 0;
  for (var i = 0; i < notes.length && at < count; i++) {
    var frequency = notes[i][0];
    if (frequency === 0x12) {
      break;
    }
    var length = Math.min(count-at, Math.trunc(notes[i][1]*sampleRate/tempo));
    if (frequency > 1) {
      var period = sampleRate/frequency;
      for (var n = 0; n < length; n++) {
        samples[at+n] = ((n/period) % 1) < 0.5 ? level : -level;
      }
    }
    at += length;
  }
  return samples;
} // speakerSamples

/**
 * How much the tempo of a piece of AdLib music is pulled either way
 * (`midi_tempo_modifiers`). Two cutscenes are timed to their music and not
 * the other way round, so the music is what gets adjusted: the titles of the
 * intro appear with the phrases of the theme, and Jaffar walks in on his.
 * A fraction is added to every tempo of the file — a longer beat, so 0.03
 * plays it three percent slower.
 *
 * The lengths in `data/sounds/midi.json`, which the scheduler counts frames
 * with, are the file's own; three percent of a cutscene is under half a
 * frame of the original's clock.
 */
export const MIDI_TEMPO_MODIFIER = {
  53: -0.03,   // story 3, Jaffar comes: three percent faster
  54: 0.03     // the intro music: three percent slower
};


// ---------------------------------------------------------------- the table

/**
 * What the game knows of every sound: its kind, its length and whether it
 * loops — built by the model from `data/sounds/{digi,speaker,midi}.json`
 * and handed to the worker (the samples themselves stay on the main thread).
 */
export class SoundTable {

  /**
   * @param {Object} entries - By index: `{kind: 'digi'|'speaker'|'midi', seconds, loop}`.
   */
  constructor(entries) {
    this.entries = entries || {};
  } // constructor

  /**
   * The table from the three data files, choosing for every sound what the
   * original with a Sound Blaster and an AdLib played: the digitised sample
   * where there is one, else the AdLib piece, else the speaker tune (the
   * sound DATs are searched in that order; `sound_pcspeaker_exists` keeps
   * some speaker tunes silent).
   * @param {Object} digi - data/sounds/digi.json
   * @param {Object} speaker - data/sounds/speaker.json
   * @param {Object} midi - data/sounds/midi.json
   * @returns {SoundTable}
   */
  static fromData(digi, speaker, midi) {
    var entries = {};
    for (var index = 0; index < SOUND_PRIORITY.length; index++) {
      var d = digi && digi.sounds[index], m = midi && midi.sounds[index], s = speaker && speaker.sounds[index];
      if (d) {
        entries[index] = {kind: 'digi', seconds: d.seconds === undefined ? d.samples/d.rate : d.seconds, loop: !!d.loop};
      } else if (m) {
        entries[index] = {kind: 'midi', seconds: m.seconds || 0, loop: !!m.loop};
      } else if (s && !s.empty && SOUND_PCSPEAKER_EXISTS[index]) {
        entries[index] = {kind: 'speaker', seconds: s.seconds === undefined ? speakerSeconds(s.tempo, s.notes) : s.seconds, loop: !!s.loop};
      }
    }
    return new SoundTable(entries);
  } // fromData

  /** the compact shape for a message to the worker */
  toJSON() {
    return this.entries;
  } // toJSON

  has(index) {
    return index in this.entries;
  } // has

  kind(index) {
    return this.entries[index] ? this.entries[index].kind : null;
  } // kind

  /** how many game frames a sound plays, at least one */
  frames(index) {
    var entry = this.entries[index];
    return entry ? Math.max(1, Math.ceil(entry.seconds/FRAME_SECONDS)) : 0;
  } // frames

  loops(index) {
    return !!(this.entries[index] && this.entries[index].loop);
  } // loops

} // SoundTable

// ------------------------------------------------------------ the scheduler

/**
 * `play_sound` / `play_next_sound` / `check_sound_playing` / `stop_sounds`
 * on a frame clock. During a frame the game asks for sounds; at the end of
 * the frame (`draw_game_frame`) the one that won starts if it may. What
 * plays is remembered with the frame it ends on.
 */
export class SoundScheduler {

  /**
   * @param {SoundTable} table
   * @param {Object} [options] - `silent`: no sound ever plays and none is
   *        ever heard playing (the tools; `POP_TRACE_SILENT`).
   */
  constructor(table, options) {
    var settings = options || {};
    this.table = table || new SoundTable({});
    this.silent = !!settings.silent;
    /** the sound asked for this frame that won (`next_sound`), -1 for none */
    this.nextSound = -1;
    /** the sound playing (`current_sound`), -1 for none */
    this.currentSound = -1;
    /** the frame the current sound ends on; Infinity for a looping one */
    this.endsAt = 0;
    /** the frame counter the scheduler reads (set by the owner before each frame) */
    this.frame = 0;
    /** a stop was asked for this frame (`stop_sounds`) */
    this.stopRequested = false;
  } // constructor

  /** `play_sound`: the request of a frame, kept when louder than the one so far */
  request(index) {
    if (!this.table.has(index)) {
      return;   // `sound_pointers[sound_id] == NULL`
    }
    if (this.nextSound < 0 || SOUND_PRIORITY[index] <= SOUND_PRIORITY[this.nextSound]) {
      this.nextSound = index;
    }
  } // request

  /** `check_sound_playing` */
  playing() {
    if (this.silent || this.currentSound < 0) {
      return false;
    }
    return this.frame < this.endsAt;
  } // playing

  /** `stop_sounds` */
  stop() {
    if (this.currentSound >= 0 && this.frame < this.endsAt) {
      this.stopRequested = true;
    }
    this.currentSound = -1;
    this.endsAt = 0;
  } // stop

  /**
   * `play_next_sound`, at the end of a frame: what the speaker is to do.
   * @returns {{start: number, stop: boolean, loop: boolean}|null} The sound to
   *          start (or -1 for none) and whether to cut what plays; null when
   *          nothing changes.
   */
  playNext() {
    var start = -1;
    if (this.nextSound >= 0 && !this.silent) {
      var canPlay = !this.playing() ||
        (SOUND_INTERRUPTIBLE[this.currentSound] !== 0 && SOUND_PRIORITY[this.nextSound] <= SOUND_PRIORITY[this.currentSound]);
      if (canPlay) {
        start = this.currentSound = this.nextSound;
        this.endsAt = this.table.loops(start) ? Infinity : this.frame+this.table.frames(start);
      }
    }
    this.nextSound = -1;
    var stop = this.stopRequested;
    this.stopRequested = false;
    if (start < 0 && !stop) {
      return null;
    }
    return {start: start, stop: stop, loop: start >= 0 && this.table.loops(start)};
  } // playNext

} // SoundScheduler
