const { AbstractAudioManager } = await import('./svision/js/audio/abstractAudioManager.js?ver='+window.srcVersion);
const { AudioSampleHandler } = await import('./svision/js/audio/audioSampleHandler.js?ver='+window.srcVersion);
const { PCMSample } = await import('./svision/js/audio/pcmSample.js?ver='+window.srcVersion);
const { SoundTable, speakerSamples, MIDI_TEMPO_MODIFIER } = await import('./pop/sounds.js?ver='+window.srcVersion);
const { MidiFile } = await import('./svision/js/audio/midiFile.js?ver='+window.srcVersion);
const { AdlibMidi } = await import('./svision/js/audio/chip/adlibMidi.js?ver='+window.srcVersion);
const { OPL2 } = await import('./svision/js/audio/chip/opl2.js?ver='+window.srcVersion);
// begin code

/**
 * The sound of the machine: one bus of digitised sound, `sounds`, played
 * the way a Sound Blaster played the original's samples — one at a time out
 * of the DAC at the sample's own rate (8 200 to 14 000 Hz; the level door
 * slides at 2 750 Hz and loops). The samples come from
 * `data/sounds/digi.json`; where a sound has no sample the PC speaker tune
 * is rendered as a square wave, as the original did on a PC without a card
 * (only sound 38, the "press button" blink, is like that).
 *
 * The AdLib music (`data/sounds/midi.json`) goes out of the same bus. It is
 * played by svision's own OPL2 (`audio/chip/opl2.js`) driven by the MIDI
 * driver of the era (`audio/chip/adlibMidi.js`) through the game's own
 * instrument table (`data/sounds/instruments.json`), and it is **rendered
 * ahead of time**: a piece becomes a `PCMSample` the first time it is asked
 * for and is kept, so that music and sound effects leave the manager by the
 * same door and a tool under Node hears what the browser does (R-001). The
 * card had no say in which of the two was heard either — one sound at a
 * time, and the scheduler decides which.
 */
export class AudioManager extends AbstractAudioManager {

  constructor(app) {
    super(app);
    this.id = 'AudioManager';
    /** the table of the sounds (kind, length, loop) — what the worker gets too */
    this.table = null;
    /** `PCMSample` by sound number */
    this.samples = {};
    /** the AdLib piece playing, -1 for none */
    this.musicRequested = -1;
    /** the game's AdLib instrument table, as the driver takes it */
    this.instruments = null;
    /** the MIDI files by sound number, until they are rendered */
    this.music = {};
    /** which pieces are still to be rendered, the shortest first */
    this.musicQueue = [];
    /** the piece being rendered in the background: `{index, player, out, at}` */
    this.rendering = null;
    this.renderTimer = 0;
  } // constructor

  /**
   * What the music is rendered at: half the chip's own rate. The card's
   * output stage rolls off at 7 kHz, so nothing above twelve is lost, and
   * two minutes of the ending theme is twelve megabytes instead of
   * twenty-five. Raise it to `OPL2.SAMPLE_RATE` to render at the chip's own.
   */
  static get MUSIC_RATE() { return Math.round(OPL2.SAMPLE_RATE/2); }

  /** How long a slice of background rendering may take, and how long it rests. */
  static get RENDER_BUDGET_MS() { return 8; }
  static get RENDER_PAUSE_MS() { return 100; }

  createAudioHandler(bus, options) {
    return new AudioSampleHandler(this.app);
  } // createAudioHandler

  /**
   * Builds the samples and the table from the three data files (once; the
   * sounds are the same for every level).
   * @param {Object} digi - data/sounds/digi.json
   * @param {Object} speaker - data/sounds/speaker.json
   * @param {Object} midi - data/sounds/midi.json
   * @param {Object} [instruments] - data/sounds/instruments.json
   */
  loadSounds(digi, speaker, midi, instruments) {
    this.table = SoundTable.fromData(digi, speaker, midi);
    this.samples = {};
    this.music = {};
    this.instruments = instruments ? AudioManager.fromBase64(instruments.bytes) : null;
    var indices = Object.keys(this.table.entries);
    for (var i = 0; i < indices.length; i++) {
      var index = parseInt(indices[i], 10);
      var entry = this.table.entries[index];
      if (entry.kind === 'digi') {
        var record = digi.sounds[index];
        this.samples[index] = PCMSample.fromUnsigned8(AudioManager.fromBase64(record.pcm), record.rate);
      } else if (entry.kind === 'speaker') {
        var tune = speaker.sounds[index];
        this.samples[index] = new PCMSample(speakerSamples(tune.tempo, tune.notes, 11025), 11025);
      } else if (entry.kind === 'midi') {
        this.music[index] = MidiFile.fromBytes(AudioManager.fromBase64(midi.sounds[index].midi));
      }
    }
    this.queueMusic();
  } // loadSounds

  /** whether the sounds are loaded */
  get ready() {
    return this.table !== null;
  } // ready

  /**
   * The sample of a sound number on the `sounds` bus.
   * @param {string} bus
   * @param {number|string} sound - The sound number.
   * @param {Object} options
   * @returns {PCMSample|boolean} The sample, or false.
   */
  audioData(bus, sound, options) {
    var cached = super.audioData(bus, sound, options);
    if (cached !== false) {
      return cached;
    }
    var sample = this.samples[sound] || false;
    if (sample !== false && bus in this.audioDataCache) {
      this.audioDataCache[bus][sound] = sample;
    }
    return sample;
  } // audioData

  /**
   * What the worker decided for a frame (`play_next_sound`): cut the playing
   * sound, start another — a sample on the bus, or a piece of music.
   * @param {{start: number, stop: boolean, loop: boolean}} sound
   * @param {AbstractModel} model - Who sends the events.
   */
  playFrame(sound, model) {
    if (sound.stop) {
      model.sendEvent(0, {id: 'stopAudioBus', bus: 'sounds'});
      this.stopMusic();
    }
    if (sound.start >= 0 && this.table) {
      if (this.table.kind(sound.start) === 'midi') {
        this.playMusic(sound.start, model);
      } else {
        model.sendEvent(0, {id: 'playSound', bus: 'sounds', sound: sound.start, options: {repeat: sound.loop ? true : 1}});
      }
    }
  } // playFrame

  /**
   * A piece of the AdLib music, out of the same bus as everything else.
   * @param {number} index - The sound number (24..56).
   * @param {Object} model - The model, which sends the bus its orders.
   */
  playMusic(index, model) {
    this.musicRequested = index;
    var sample = this.renderMusic(index);
    if (sample !== false && model) {
      model.sendEvent(0, {id: 'playSound', bus: 'sounds', sound: index, options: {repeat: 1}});
    }
  } // playMusic

  stopMusic() {
    this.musicRequested = -1;
  } // stopMusic

  // --------------------------------------------------------------- the music

  /**
   * Puts every piece of music in the queue, the shortest first, and starts
   * the background rendering. The order matters only in that the ending
   * theme, two minutes of it, is then rendered last — by which time the
   * player has had the whole game to get there.
   */
  queueMusic() {
    var self = this;
    this.musicQueue = Object.keys(this.music).map(function(key) { return parseInt(key, 10); })
      .filter(function(index) { return self.music[index]; })
      .sort(function(a, b) { return self.table.entries[a].seconds-self.table.entries[b].seconds; });
    this.pumpMusic();
  } // queueMusic

  /**
   * A slice of background rendering: at most {@link AudioManager.RENDER_BUDGET_MS}
   * of work, then a rest, until every piece is a sample. Rendering the OPL2
   * runs at about ten times its own speed, so five minutes of music is a few
   * minutes of this — long before a cutscene asks for any of it, and without
   * a frame of the game ever waiting for the chip.
   */
  pumpMusic() {
    this.renderTimer = 0;
    var until = AudioManager.now()+AudioManager.RENDER_BUDGET_MS;
    while (AudioManager.now() < until) {
      if (this.rendering === null && !this.startRendering()) {
        return;   // nothing left to render
      }
      this.renderSlice(AudioManager.SLICE_SAMPLES);
    }
    var self = this;
    this.renderTimer = setTimeout(function() { self.pumpMusic(); }, AudioManager.RENDER_PAUSE_MS);
  } // pumpMusic

  /** How many samples one turn of the renderer produces. */
  static get SLICE_SAMPLES() { return 4096; }

  /**
   * Takes the next piece out of the queue and sets a player and a buffer up
   * for it.
   * @returns {boolean} False when the queue is empty.
   */
  startRendering(index) {
    var next = index === undefined ? this.musicQueue.shift() : index;
    if (next === undefined || !this.music[next]) {
      return false;
    }
    var player = new AdlibMidi({instruments: this.instruments, sampleRate: AudioManager.MUSIC_RATE,
      tempoModifier: MIDI_TEMPO_MODIFIER[next] || 0});
    player.play(this.music[next]);
    var length = Math.max(1, Math.round(player.pieceSeconds*player.sampleRate));
    this.rendering = {index: next, player: player, out: new Float32Array(length), at: 0};
    return true;
  } // startRendering

  /**
   * Renders the next samples of the piece in hand, and keeps it as a sample
   * once it is whole.
   * @param {number} count - How many samples, at most.
   * @returns {boolean} True while the piece is not finished.
   */
  renderSlice(count) {
    var job = this.rendering;
    if (job === null) {
      return false;
    }
    var chunk = Math.min(count, job.out.length-job.at);
    job.player.render(job.out, chunk, job.at);
    job.at += chunk;
    if (job.at >= job.out.length) {
      this.samples[job.index] = new PCMSample(job.out, job.player.sampleRate);
      this.rendering = null;
      return false;
    }
    return true;
  } // renderSlice

  /**
   * A piece of music as samples. Normally it is already rendered; asked for
   * one that is not, this finishes it then and there rather than let the
   * cutscene play in silence.
   * @param {number} index - The sound number.
   * @returns {PCMSample|boolean} The sample, or false when there is no such
   *          piece.
   */
  renderMusic(index) {
    if (this.samples[index]) {
      return this.samples[index];
    }
    if (!this.music[index]) {
      return false;
    }
    if (this.rendering === null || this.rendering.index !== index) {
      // put whatever was in hand back at the head of the queue
      if (this.rendering !== null) {
        this.musicQueue.unshift(this.rendering.index);
        this.rendering = null;
      }
      this.musicQueue = this.musicQueue.filter(function(queued) { return queued !== index; });
      this.startRendering(index);
    }
    while (this.renderSlice(AudioManager.SLICE_SAMPLES*8)) {
      // to the end of it
    }
    return this.samples[index] || false;
  } // renderMusic

  /** The clock the rendering budget is measured on. */
  static now() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  } // now

  /**
   * Base64 to bytes, in the browser and under Node alike.
   * @param {string} text
   * @returns {Uint8Array}
   */
  static fromBase64(text) {
    var binary = atob(text || '');
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } // fromBase64

} // AudioManager
