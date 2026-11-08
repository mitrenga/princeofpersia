const { AbstractModel } = await import('./svision/js/abstractModel.js?ver='+window.srcVersion);
const { VGAVideoRAMEntity } = await import('./svision/js/platform/canvas2D/vga/vgaVideoRAMEntity.js?ver='+window.srcVersion);
const { VGAControls } = await import('./svision/js/platform/canvas2D/vga/vgaControls.js?ver='+window.srcVersion);
const { ModuleWorker } = await import('./svision/js/moduleWorker.js?ver='+window.srcVersion);
// begin code

/**
 * The game screen. The game itself runs in the worker (gameWorker.js) at the
 * original's 12 frames a second and sends its video memory and palette
 * whenever the picture changes; this model shows the last frame in a
 * {@link VGAVideoRAMEntity}, feeds the worker the controls and loads the
 * data files a level needs (app/WORKER-PROTOCOL.md).
 *
 * The prince runs, jumps, climbs and falls through the level under the
 * original's controls (cursor keys or the keypad, Shift); the level door
 * takes him to the next level with his hit points (`levelDone`). `+` and
 * `-` change the level, `B` boots again — debugging conveniences until P7,
 * which also brings the bottom-line messages (`text`) and what follows the
 * hour running out (`timeOver`).
 *
 * P6: the sounds. The worker says with every frame which sound starts and
 * whether the playing one is cut (`sound`); this model hands that to the
 * app's `AudioManager`, which plays the samples of the original on the
 * `sounds` bus. The sound data files are fetched once, before the first
 * level.
 */
export class GameModel extends AbstractModel {

  /** the modules the worker is glued from, in dependency order */
  static get WORKER_SOURCES() {
    return [
      'svision/js/platform/canvas2D/vga/vgaVideoRAM.js',
      'svision/js/platform/canvas2D/vga/vgaPalette.js',
      'pop/popRandom.js',
      'pop/tileTable.js',
      'pop/chtab.js',
      'pop/levelData.js',
      'pop/roomRenderer.js',
      'pop/sequences.js',
      'pop/frames.js',
      'pop/sounds.js',
      'pop/prince.js',
      'gameWorker.js'
    ];
  } // WORKER_SOURCES

  constructor(app) {
    super(app);
    this.id = 'GameModel';
    this.autorepeatKeys = false;

    this.screen = null;
    this.paletteVersion = -1;
    /** the data files still to fetch for the level being loaded */
    this.pending = [];
    /** what has arrived, by the key the worker wants it under */
    this.loaded = {};
    this.loadingLevel = 0;
    /** the hit points the prince brings into the level being loaded (`hitp_beg_lev`) */
    this.loadingHitPoints = 3;
    this.ready = false;
    /** the worker stands still after the window lost focus, until a key */
    this.paused = false;
  } // constructor

  init() {
    super.init();
    if (this.borderEntity != null) {
      this.borderEntity.bkColor = '#000000';
    }
    this.desktopEntity.bkColor = '#000000';

    this.screen = new VGAVideoRAMEntity(this.desktopEntity, 0, 0);
    this.screen.clear(0);
    this.desktopEntity.addEntity(this.screen);

    this.sendEvent(0, {id: 'openAudioBus', bus: 'sounds', options: {muted: false}});
    this.startWorker();
  } // init

  shutdown() {
    this.sendWorkerMessage({id: 'reset'});
    super.shutdown();
  } // shutdown

  // ------------------------------------------------------------------ worker

  /**
   * Glues the worker from its modules and starts it; the worker is kept on
   * the app so a later model switch does not build it again.
   */
  startWorker() {
    if (this.app.worker) {
      this.app.worker.onmessage = (event) => this.handleWorkerMessage(event);
      this.ready = true;
      this.loadLevel(this.app.levelNumber);
      return;
    }
    ModuleWorker.create(this.app, GameModel.WORKER_SOURCES).then((worker) => {
      this.app.worker = worker;
      worker.onmessage = (event) => this.handleWorkerMessage(event);
      worker.onerror = (event) => this.app.showErrorMessage('game worker: '+event.message, 'restart');
      this.ready = true;
      this.sendWorkerMessage({id: 'init', seed: Date.now() >>> 0});
      this.loadLevel(this.app.levelNumber);
    }).catch((error) => this.app.showErrorMessage(error.message, 'restart'));
  } // startWorker

  sendWorkerMessage(event) {
    if (this.app.worker && this.ready) {
      this.app.worker.postMessage(event);
    }
  } // sendWorkerMessage

  handleWorkerMessage(event) {
    var data = event.data;
    switch (data.id) {
      case 'frame':
        if (data.paletteVersion !== this.paletteVersion) {
          this.paletteVersion = data.paletteVersion;
          this.screen.palette.load(data.palette);
        }
        this.screen.restore(data.vram);
        if (data.sound) {
          this.app.audioManager.playFrame(data.sound, this);
        }
        break;
      case 'levelDone':
        // the prince left through the level door: the next level, his hit points with him
        if (data.sound) {
          this.app.audioManager.playFrame(data.sound, this);
        }
        this.app.levelNumber = Math.min(15, data.next);
        this.loadLevel(this.app.levelNumber, data.hitPoints);
        break;
      case 'timeOver':
        // the hour is over — the cutscene and the restart are P7
        break;
    }
  } // handleWorkerMessage

  // -------------------------------------------------------------------- data

  /**
   * Fetches what a level needs — the level record and the sprite sets of
   * its kind — one file after another, then hands them to the worker.
   * @param {number} number - 0..15.
   * @param {number} [hitPoints=3] - The prince's maximum hit points on entry.
   */
  loadLevel(number, hitPoints) {
    var palace = GameModel.TYPE_OF_LEVEL[number] === 1;
    var pad = number < 10 ? '0'+number : String(number);
    this.loadingLevel = number;
    this.loadingHitPoints = hitPoints === undefined ? 3 : hitPoints;
    this.loaded = {};
    this.pending = [];
    if (!this.app.audioManager.ready) {
      // the sounds once, before the first level
      this.pending.push({key: 'digi', file: 'sounds/digi'}, {key: 'speaker', file: 'sounds/speaker'},
        {key: 'midi', file: 'sounds/midi'}, {key: 'instruments', file: 'sounds/instruments'});
    }
    this.pending.push(
      {key: 'level', file: 'levels/level'+pad},
      {key: 'environment', file: 'gfx/'+(palace ? 'palace' : 'dungeon')},
      {key: 'wall', file: 'gfx/'+(palace ? 'palaceWall' : 'dungeonWall')},
      {key: 'flame', file: 'gfx/flameSwordPotion'},
      {key: 'sword', file: 'gfx/sword'},
      {key: 'kid', file: 'gfx/kid'},
      {key: 'tables', file: 'exe/tables'}
    );
    this.fetchNext();
  } // loadLevel

  fetchNext() {
    if (!this.pending.length) {
      if (this.loaded.digi) {
        this.app.audioManager.loadSounds(this.loaded.digi, this.loaded.speaker, this.loaded.midi, this.loaded.instruments);
      }
      this.sendWorkerMessage({
        id: 'level',
        number: this.loadingLevel,
        hitPoints: this.loadingHitPoints,
        sounds: this.app.audioManager.ready ? this.app.audioManager.table.toJSON() : null,
        level: this.loaded.level,
        gfx: {environment: this.loaded.environment, wall: this.loaded.wall, flame: this.loaded.flame,
              sword: this.loaded.sword, kid: this.loaded.kid},
        tables: this.loaded.tables
      });
      return;
    }
    var next = this.pending[0];
    this.fetchData(next.file+'.data', {key: next.file.replace('/', '.'), when: 'required'}, {});
  } // fetchNext

  setData(data) {
    var next = this.pending.shift();
    if (next) {
      this.loaded[next.key] = data.data;
    }
    this.fetchNext();
  } // setData

  /** 0 dungeon, 1 palace by level number — the original's `tbl_level_type` */
  static get TYPE_OF_LEVEL() { return [0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 1, 1, 0, 0, 1, 0]; }

  // ------------------------------------------------------------------ events

  handleEvent(event) {
    if (super.handleEvent(event)) {
      return true;
    }
    switch (event.id) {
      case 'keyPress':
        if (this.paused) {
          // the library sends no event on focus: the first key wakes the game
          this.paused = false;
          this.sendWorkerMessage({id: 'continue'});
          this.sendEvent(0, {id: 'continueAllAudioBuses'});
        }
        return this.keyChanged(event.key, true);
      case 'keyRelease':
        return this.keyChanged(event.key, false);
      case 'blurWindow':
        this.paused = true;
        this.sendWorkerMessage({id: 'pause'});
        this.sendEvent(0, {id: 'pauseAllAudioBuses'});
        return true;
    }
    return false;
  } // handleEvent

  /**
   * Turns a key into control actions for the worker: the keypad diagonals
   * first, then the bindings.
   * @param {string} key - The reported key.
   * @param {boolean} value - Pressed or released.
   * @returns {boolean} Whether the key meant anything.
   */
  keyChanged(key, value) {
    var actions = VGAControls.numpadActions(key);
    if (actions === null) {
      var action = VGAControls.actionOf(key, this.app.controls.keyboard, VGAControls.PRINCE);
      actions = action === null ? [] : [action];
    }
    for (var i = 0; i < actions.length; i++) {
      this.sendWorkerMessage({id: 'controls', action: actions[i], value: value});
    }
    if (value) {
      switch (key) {
        case '+':
          this.app.levelNumber = Math.min(15, this.app.levelNumber+1);
          this.loadLevel(this.app.levelNumber);
          return true;
        case '-':
          this.app.levelNumber = Math.max(0, this.app.levelNumber-1);
          this.loadLevel(this.app.levelNumber);
          return true;
        case 'b':
        case 'B':
          this.app.setModel('BootModel');
          return true;
      }
    }
    return actions.length > 0;
  } // keyChanged

  loopModel(timestamp) {
    super.loopModel(timestamp);
    this.drawModel();
  } // loopModel

} // GameModel
