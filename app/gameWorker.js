const { VGAVideoRAM } = await import('./svision/js/platform/canvas2D/vga/vgaVideoRAM.js?ver='+window.srcVersion);
const { VGAPalette } = await import('./svision/js/platform/canvas2D/vga/vgaPalette.js?ver='+window.srcVersion);
const { PoPRandom } = await import('./pop/popRandom.js?ver='+window.srcVersion);
const { Chtab } = await import('./pop/chtab.js?ver='+window.srcVersion);
const { PoPLevel } = await import('./pop/levelData.js?ver='+window.srcVersion);
const { RoomRenderer } = await import('./pop/roomRenderer.js?ver='+window.srcVersion);
const { SequenceTable } = await import('./pop/sequences.js?ver='+window.srcVersion);
const { frameTablesFromData } = await import('./pop/frames.js?ver='+window.srcVersion);
const { SoundTable } = await import('./pop/sounds.js?ver='+window.srcVersion);
const { PrinceLogic } = await import('./pop/prince.js?ver='+window.srcVersion);
// begin code

/**
 * The game program. It runs in a web worker glued out of this module and
 * the ones it imports (svision `ModuleWorker`), ticking at the original's
 * 12 frames a second, and sends its video memory and palette to the model
 * whenever the picture changed. The same class runs under Node for the
 * tools: `new GameWorker(post)` with `handleMessage()` and `tick()`, no
 * timers (app/WORKER-PROTOCOL.md).
 *
 * The prince moves through the level under the original's physics
 * (`PrinceLogic`); the room follows him. The controls arrive as the
 * original read its keyboard — left/right, up/down, Shift — and are handed
 * to the logic once per frame. The seed and the substitutable source of
 * randomness are here from the start (R-009).
 *
 * P4: the tiles live — gates, buttons, loose floors, spikes, chompers,
 * torches, potions, the level door — so the room is drawn afresh every
 * frame from the tiles as they are; falling floors and the prince go in
 * the middle, the foreground over them, the way `draw_game_frame` layers
 * it. The screen flashes on a potion or a hurt, the clock runs, and when
 * the prince leaves through the level door the model hears `levelDone`.
 *
 * P6: the sounds. The game asks for them during the frame, the loudest
 * wins at its end (`play_next_sound`), and the frame message says which
 * sample to start and whether to cut the playing one; how long a sound
 * plays is counted here in frames from its length (`SoundTable`), so the
 * physics that waits for a sound is repeatable and the tools can run in
 * silence (`init {silent}`). Guards come with P5.
 */
export class GameWorker {

  /** one game frame */
  static get TICK_MS() { return 1000/12; }

  /**
   * @param {Function} post - Sends a message to the model (`postMessage`).
   */
  constructor(post) {
    this.post = post;
    this.random = new PoPRandom(0);
    this.frame = 0;
    this.running = false;
    this.paused = false;

    this.levelNumber = 0;
    this.level = null;
    this.chtabs = null;
    this.renderer = null;
    this.tables = null;
    /** the prince and his physics */
    this.logic = null;
    this.room = 0;
    /** the screen memory as the game writes it */
    this.screen = new VGAVideoRAM();
    this.palette = new VGAPalette();
    /** the BIOS colours, for the flash of register 0 */
    this.biosPalette = VGAPalette.defaultPalette();
    /** register 0 is not black this frame (`set_bg_attr`) */
    this.flashing = false;
    this.dirty = false;
    /** the level ended (`levelDone` sent) or the time ran out: no more frames */
    this.finished = false;

    /** the state of the controls, action → pressed */
    this.controls = {left: false, right: false, up: false, down: false, shift: false};
    /** what the model knows of the sounds (`level {sounds}`), or null */
    this.soundTable = null;
    /** no sound plays or is heard playing (`init {silent}`, the tools) */
    this.silent = false;
    /** a raw control state set by a tool for the next frame (`input`), or null */
    this.rawInput = null;

    this.timer = null;
    this.accumulator = 0;
    this.lastTime = 0;
  } // constructor

  // ---------------------------------------------------------------- messages

  /**
   * One message from the model.
   * @param {Object} msg - `{id, ...}`.
   */
  handleMessage(msg) {
    switch (msg.id) {
      case 'init':
        this.random = new PoPRandom(msg.seed === undefined ? 0 : msg.seed);
        this.frame = 0;
        this.silent = !!msg.silent;
        break;
      case 'level':
        if (msg.sounds) {
          this.soundTable = new SoundTable(msg.sounds);
        }
        this.loadLevel(msg.number, msg.level, msg.gfx, msg.tables, msg.hitPoints);
        if (!msg.headless) {
          this.start();
        }
        break;
      case 'controls':
        if (msg.action in this.controls) {
          this.controls[msg.action] = !!msg.value;
        }
        break;
      case 'input':
        // a tool's raw controls for the frames to come: x -1/0/1, y -1/0/1, shift
        this.rawInput = {x: msg.x | 0, y: msg.y | 0, shift: !!msg.shift};
        break;
      case 'pause':
        this.paused = true;
        break;
      case 'continue':
        this.paused = false;
        this.lastTime = 0;
        break;
      case 'reset':
        this.stop();
        this.level = null;
        this.renderer = null;
        break;
      case 'tick':
        // headless: exactly one frame, and always a frame message back
        this.tick();
        this.postFrame(true);
        break;
    }
  } // handleMessage

  /**
   * Takes a level and its sprite sets in, composes the palette the way the
   * original does (BIOS row 0 with registers 6 and 12 rewritten, the sets in
   * their rows) and shows the start room.
   */
  loadLevel(number, levelData, gfx, tables, hitPoints) {
    this.levelNumber = number;
    this.finished = false;
    this.flashing = false;
    this.level = PoPLevel.fromJSON(levelData).alterMods();
    this.chtabs = {
      environment: Chtab.fromData(gfx.environment),
      wall: Chtab.fromData(gfx.wall),
      flame: Chtab.fromData(gfx.flame),
      sword: Chtab.fromData(gfx.sword),
      kid: Chtab.fromData(gfx.kid)
    };
    if (tables) {
      this.tables = {sequences: SequenceTable.fromData(tables), frames: frameTablesFromData(tables)};
    }
    this.palette = VGAPalette.defaultPalette();
    this.palette.set(12, 0x38, 0x00, 0x0C);   // blood, the hurt flash
    this.palette.set(6, 0x30, 0x26, 0x14);    // the palace wall pattern
    var names = Object.keys(this.chtabs);
    for (var i = 0; i < names.length; i++) {
      this.chtabs[names[i]].install(this.palette);
    }
    this.renderer = new RoomRenderer(this.level, this.chtabs, {levelNumber: number});
    this.logic = new PrinceLogic(this.level, number, this.tables, this.random,
                                 {hitPoints: hitPoints === undefined ? 3 : hitPoints,
                                  sounds: this.soundTable, silent: this.silent});
    this.sound = null;
    var self = this;
    // the physics reads the size of the image of a frame off the sprite sets
    this.logic.imageSize = function(chtabId, imageIndex) {
      var chtab = chtabId === 2 ? self.chtabs.kid : (chtabId === 0 ? self.chtabs.sword : null);
      var image = chtab ? chtab.image(imageIndex+1) : null;
      return image ? {width: image.width, height: image.height} : null;
    };
    this.room = this.logic.drawnRoom;
    this.logic.roomDrawn();
    this.composeScreen();
  } // loadLevel

  // ------------------------------------------------------------------- frames

  /**
   * The picture of one frame (`draw_game_frame`): the room from its tiles
   * as they are now, behind the characters; then the middle — falling
   * floors, the mirror image, the prince — lowest bottom line last; then
   * the foreground over them; the hit points in the bottom line.
   */
  composeScreen() {
    var logic = this.logic;
    var renderer = this.renderer;
    this.screen.fill(0);
    // the prince first: which tiles are to be drawn once more over him
    var object = logic.kidObject();
    var kidTile = object ? object.tilepos : 30;
    if (this.room) {
      renderer.kid = {room: logic.kid.room, row: logic.kid.currRow, col: logic.kid.currCol, frame: logic.kid.frame};
      renderer.overlays = object ? object.overlays : [];
      renderer.aboveColumns = object ? object.aboveColumns : [];
      renderer.drawRoomBackground(this.room, this.screen);
      // the clip box of the stairs, where the drawer put the level door
      logic.leveldoorYBottom = renderer.leveldoorYBottom;
      logic.leveldoorRight = renderer.leveldoorRight;
      renderer.paintOverlays(kidTile, false, this.screen);
    }
    var middle = [];
    var mobs = logic.mobObjects();
    for (var m = 0; m < mobs.length; m++) {
      middle.push({y: mobs[m].yBottom, mob: mobs[m]});
    }
    var mirror = logic.mirrorObject();
    if (mirror) {
      middle.push({y: mirror.yBottom, object: mirror});
    }
    if (object) {
      middle.push({y: object.yBottom, object: object});
    }
    middle.sort(function(a, b) { return a.y-b.y; });
    for (var i = 0; i < middle.length; i++) {
      if (middle[i].mob) {
        renderer.drawLooseMob(middle[i].mob.xh, middle[i].mob.yBottom, this.screen);
      } else {
        renderer.drawObject(this.chtabs.kid, middle[i].object, this.screen);
      }
    }
    if (this.room) {
      renderer.paintOverlays(kidTile, true, this.screen);
      renderer.paintForeground(this.screen);
    }
    var blink = logic.hitpCurr === 1 && this.levelNumber !== 15;
    if (blink) {
      // one hit point blinks with the odd and even ticks (`draw_hp`)
      if (logic.remTick & 1) {
        this.renderer.drawHitPoints(this.chtabs.kid, 1, 0, this.screen);
      } else {
        this.renderer.drawHitPoints(this.chtabs.kid, 0, 1, this.screen);
      }
    } else {
      this.renderer.drawHitPoints(this.chtabs.kid, logic.hitpCurr, logic.hitpMax, this.screen);
    }
    this.dirty = true;
  } // composeScreen

  /**
   * One game frame: the controls into the physics, the prince's frame, the
   * room after him, the picture.
   */
  tick() {
    this.frame++;
    if (!this.level || this.finished) {
      return;
    }
    var logic = this.logic;
    var c = this.controls;
    if (this.rawInput) {
      logic.setInput(this.rawInput.x, this.rawInput.y, this.rawInput.shift);
    } else {
      // `read_keyb_control`: up wins over down, left over right
      var y = c.up ? -1 : (c.down ? 1 : 0);
      var x = c.left ? -1 : (c.right ? 1 : 0);
      logic.setInput(x, y, c.shift);
    }
    logic.playFrame();
    if (logic.nextLevel !== this.levelNumber && !logic.checkSoundPlaying()) {
      // `play_level_2` returns the next level; the frame is not drawn, sounds stop
      this.finished = true;
      this.post({id: 'levelDone', level: this.levelNumber, next: logic.nextLevel, hitPoints: logic.hitpMax,
                 remMin: logic.remMin, remTick: logic.remTick, sound: {start: -1, stop: true, loop: false}});
      return;
    }
    if (logic.timeExpired) {
      this.finished = true;
      this.post({id: 'timeOver', level: this.levelNumber});
    }
    if (logic.differentRoom) {
      this.room = logic.drawnRoom;
      logic.roomDrawn();
    }
    this.composeScreen();
    this.flashIfHurt();
    logic.ageBottomText();
    // `play_next_sound`: the sound of the frame, for the model to start
    this.sound = logic.playNextSound();
    if (this.sound) {
      this.dirty = true;
    }
  } // tick

  /**
   * `flash_if_hurt` + `remove_flash_if_hurt`: a potion or a hurt turns the
   * black of the screen (register 0) into a colour for a moment. The
   * original shows it for two timer ticks inside the frame; here it stays
   * for the whole frame and register 0 goes back to black with the next.
   */
  flashIfHurt() {
    var logic = this.logic;
    var color = -1;
    if (logic.flashTime !== 0) {
      color = logic.flashColor;
    } else if (logic.hitpDelta < 0) {
      color = 12;   // bright red
    }
    if (color >= 0) {
      var bios = this.biosPalette.bytes;
      this.palette.set(0, bios[color*3], bios[color*3+1], bios[color*3+2]);
      this.flashing = true;
    } else if (this.flashing) {
      this.palette.set(0, 0, 0, 0);
      this.flashing = false;
    }
    if (logic.flashTime !== 0) {
      logic.flashTime--;
    }
  } // flashIfHurt

  /**
   * The state of the prince and of the tiles around him after the last
   * frame, for the tools (`matchphysics`): his record, the clock, the
   * counts of animated and falling tiles, and the tile types and
   * modifiers of his room.
   */
  kidState() {
    var logic = this.logic;
    var k = logic.kid.snapshot();
    k.hp = logic.hitpCurr;
    k.drawnRoom = logic.drawnRoom;
    k.sounds = logic.sounds.slice();
    k.min = logic.remMin;
    k.tick = logic.remTick;
    k.trobs = logic.trobs.length;
    k.mobs = logic.mobs.length;
    k.door = logic.leveldoorOpen;
    k.tiles = [];
    k.mods = [];
    var inRoom = k.room >= 1 && k.room <= 24;
    var base = (k.room-1)*30;
    for (var i = 0; i < 30; i++) {
      k.tiles.push(inRoom ? logic.level.fg[base+i] & 0x1F : 0);
      k.mods.push(inRoom ? logic.level.bg[base+i] : 0);
    }
    return k;
  } // kidState

  /**
   * Sends the picture when it changed (or when asked to).
   * @param {boolean} [always]
   */
  postFrame(always) {
    if (!this.dirty && !always) {
      return;
    }
    this.dirty = false;
    var sound = this.sound;
    this.sound = null;
    this.post({
      id: 'frame',
      frame: this.frame,
      level: this.levelNumber,
      room: this.room,
      kid: this.logic ? this.kidState() : null,
      text: this.logic ? this.logic.bottomText : '',
      sound: sound,
      vram: this.screen.bytes.slice(),
      palette: this.palette.bytes.slice(),
      paletteVersion: this.palette.version
    });
  } // postFrame

  // -------------------------------------------------------------------- clock

  start() {
    if (this.running) {
      this.postFrame(true);
      return;
    }
    this.running = true;
    this.lastTime = 0;
    this.accumulator = 0;
    this.postFrame(true);
    this.loop();
  } // start

  stop() {
    this.running = false;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  } // stop

  /**
   * The fixed-step loop: as many frames as the wall clock owes, then sleep
   * until the next one is due. A pause stops the frames, not the clock.
   */
  loop() {
    if (!this.running) {
      return;
    }
    var now = performance.now();
    if (this.lastTime) {
      this.accumulator += now-this.lastTime;
    }
    this.lastTime = now;
    if (this.paused) {
      this.accumulator = 0;
    } else {
      var frames = 0;
      while (this.accumulator >= GameWorker.TICK_MS && frames < 12) {
        this.tick();
        this.accumulator -= GameWorker.TICK_MS;
        frames++;
      }
      if (frames === 12) {
        this.accumulator = 0;   // the tab was asleep: do not catch up a whole minute
      }
      this.postFrame(false);
    }
    var self = this;
    this.timer = setTimeout(function() { self.loop(); }, Math.max(1, GameWorker.TICK_MS-this.accumulator));
  } // loop

} // GameWorker

// In the worker the program wires itself up; under Node (the tools) and on
// the main thread (should anyone import this) it stays a class.
if (typeof self !== 'undefined' && typeof self.postMessage === 'function' && typeof self.document === 'undefined') {
  var gameWorker = new GameWorker(function(msg) { self.postMessage(msg); });
  self.onmessage = function(event) { gameWorker.handleMessage(event.data); };
}
