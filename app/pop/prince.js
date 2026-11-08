const { TILE, tileIsFloor } = await import('./tileTable.js?ver='+window.srcVersion);
const { SEQ, SEQ_OP, SEQ_SOUND } = await import('./sequences.js?ver='+window.srcVersion);
const { FRAME, FRAME_FLAG } = await import('./frames.js?ver='+window.srcVersion);
const { SoundScheduler } = await import('./sounds.js?ver='+window.srcVersion);
// begin code

/**
 * The prince: how he moves, falls, grabs, bumps and dies — the physics of
 * the original, frame by frame, written after SDLPoP's transcription of the
 * DOS program (`seg002.c`–`seg006.c`) **without any of its FIX_ patches**,
 * because the remake reproduces the original, bugs included.
 *
 * Coordinates are the original's: x runs in a 14-units-per-tile system in
 * which the left edge of the room is 58 (`SCREENSPACE_X`) and the screen is
 * 280 units wide (drawn 320 pixels: `x*320/280`); y in pixels, the floor of
 * row r at `Y_LAND[r+1]`; `direction` is 0 to the right, -1 to the left.
 * Sizes and wrap-arounds of the original's bytes are kept where the
 * behaviour depends on them (a byte x, a signed byte fall speed, unsigned
 * 16-bit compares), marked `& 0xFF` / `u16()` / `s8()`.
 *
 * Every method carries the original's name in its comment so the source
 * can be read alongside. The tile mechanisms (P4, `seg007.c`) live in the
 * second half of the class: the "trobs" — tiles being animated (gates,
 * buttons, loose floors, spikes, chompers, torches, potions, the level
 * door) — and the "mobs" — loose floors falling through the rooms. Guards
 * and sword fights (P5) are still hooks at the end.
 */

const TILE_SIZEX = 14, TILE_MIDX = 7, TILE_RIGHTX = 13, TILE_SIZEY = 63;
const SCREENSPACE_X = 58, FIRST_ONSCREEN_COLUMN = 5;
const FALLING_SPEED_MAX = 33, FALLING_SPEED_ACCEL = 3;
const FALLING_SPEED_MAX_FEATHER = 4, FALLING_SPEED_ACCEL_FEATHER = 1;

/** the floor line of a row (index row+1; index 0 is the row above the room) */
const Y_LAND = [-8, 55, 118, 181, 244];
/** the clip line of a row */
const Y_CLIP = [-60, 3, 66, 129, 192];
/** the left edge of a column, index column+5 (a byte: -12 reads as 244) */
const X_BUMP = [244, 2, 16, 30, 44, 58, 72, 86, 100, 114, 128, 142, 156, 170, 184, 198, 212, 226, 240, 254];
const DIR_FRONT = [-1, 1];    // index direction+1
const DIR_BEHIND = [1, -1];
const TBL_LINE = [0, 10, 20];

/** the wall side of the tile types (`wall_type`) */
const WALL_DIST_FROM_LEFT = [0, 10, 0, -1, 0, 0];
const WALL_DIST_FROM_RIGHT = [0, 0, 10, 13, 0, 0];

/** the bytes the original read beyond its tile tables (`get_tile_div_mod`) */
const BOGUS_BEFORE = [0x02, 0x00, 0x41, 0x00, 0x80, 0x00, 0xBF, 0x00, 0xFE, 0x00, 0xFF, 0x01, 0x01, 0xFF, 0xC4, 0xFF, 0x03, 0x00, 0x42, 0x00, 0x81, 0x00, 0xC0, 0x00, 0xF8, 0xFF, 0x37, 0x00, 0x76, 0x00, 0xB5, 0x00, 0xF4, 0x00];
const BOGUS_AFTER = [0xF4, 0x02, 0x10, 0x1E, 0x2C, 0x3A, 0x48, 0x56, 0x64, 0x72, 0x80, 0x8E, 0x9C, 0xAA, 0xB8, 0xC6, 0xD4, 0xE2, 0xF0, 0xFE, 0x00, 0x0A, 0x00, 0xFF, 0x00, 0x00, 0x00, 0x00, 0x0A, 0x0D, 0x00, 0x00, 0x00, 0x00];

export const DIR = {RIGHT: 0, LEFT: -1, NONE: 0x56};
export const ACTION = {STAND: 0, RUN_JUMP: 1, HANG_CLIMB: 2, IN_MIDAIR: 3, IN_FREEFALL: 4, BUMPED: 5, HANG_STRAIGHT: 6, TURN: 7, HURT: 99};
export const CONTROL = {RELEASED: 0, IGNORE: 1, HELD: -1, HELD_FORWARD: -1, HELD_BACKWARD: 1, HELD_UP: -1, HELD_DOWN: 1, HELD_LEFT: -1, HELD_RIGHT: 1};
const EDGE = {CLOSER: 0, WALL: 1, FLOOR: 2};
const SWORD = {SHEATHED: 0, DRAWN: 2};
const CHARID = {KID: 0, SHADOW: 1, GUARD: 2, SKELETON: 4, PRINCESS: 5, VIZIER: 6, MOUSE: 24};

function s8(v) { return ((v & 0xFF) ^ 0x80)-0x80; }
function u16(v) { return v & 0xFFFF; }
function s16(v) { return ((v & 0xFFFF) ^ 0x8000)-0x8000; }
function cdiv(a, b) { return Math.trunc(a/b); }
function cmod(a, b) { return a-Math.trunc(a/b)*b; }

/**
 * A character record (`char_type`): the prince, or a guard later.
 */
export class Character {
  constructor() {
    this.frame = 0; this.x = 0; this.y = 0; this.direction = 0;
    this.currCol = 0; this.currRow = 0; this.action = 0;
    this.fallX = 0; this.fallY = 0; this.room = 0; this.repeat = 0;
    this.charId = 0; this.sword = 0; this.alive = -1; this.currSeq = 0;
  } // constructor

  copyFrom(other) {
    this.frame = other.frame; this.x = other.x; this.y = other.y; this.direction = other.direction;
    this.currCol = other.currCol; this.currRow = other.currRow; this.action = other.action;
    this.fallX = other.fallX; this.fallY = other.fallY; this.room = other.room; this.repeat = other.repeat;
    this.charId = other.charId; this.sword = other.sword; this.alive = other.alive; this.currSeq = other.currSeq;
    return this;
  } // copyFrom

  snapshot() {
    return {frame: this.frame, x: this.x, y: this.y, direction: this.direction, col: this.currCol,
            row: this.currRow, action: this.action, fallX: this.fallX, fallY: this.fallY, room: this.room,
            sword: this.sword, alive: this.alive, seq: this.currSeq};
  } // snapshot
} // Character

export class PrinceLogic {

  /**
   * @param {PoPLevel} level - With `alterMods()` applied; the logic writes
   *        into its tiles the way the game does (pressed buttons, picked
   *        potions).
   * @param {number} levelNumber - 0..15.
   * @param {Object} tables - `{sequences: SequenceTable, frames: {kid, guard, cuts, swords}}`.
   * @param {PoPRandom} random - The generator (R-009).
   * @param {Object} [options] - `hitPoints` (3), `keyboard` (true: up+forward
   *        on the keyboard is a standing jump, as `is_keyboard_mode`),
   *        `sounds` (a SoundTable — what plays and for how long), `silent`
   *        (no sound plays or is heard playing; the tools, `POP_TRACE_SILENT`).
   */
  constructor(level, levelNumber, tables, random, options) {
    var settings = options || {};
    /** the sounds of the frame and the one playing (`play_sound`, `play_next_sound`) */
    this.scheduler = new SoundScheduler(settings.sounds, {silent: !!settings.silent});
    this.level = level;
    this.levelNumber = levelNumber;
    this.seq = tables.sequences;
    this.frameTables = tables.frames;
    this.random = random;
    this.keyboardMode = settings.keyboard !== false;

    /** the character the code works on and the prince: one record (SDLPoP
        copies Kid to Char and back; the prince is the only character yet) */
    this.kid = new Character();
    this.char = this.kid;
    /** the opponent, none yet (P5) */
    this.opp = new Character();
    this.opp.direction = DIR.NONE;
    this.guard = this.opp;

    /** the frame record of `char.frame` (`cur_frame`) */
    this.curFrame = this.frameTables.kid.get(0);

    // the tile the last getTile() found (`curr_room`, `tile_col`, `tile_row`,
    // `curr_tilepos`, `curr_tile2`), and the room whose tiles are addressed
    this.currRoom = 0; this.tileCol = 0; this.tileRow = 0; this.currTilepos = 0; this.currTile2 = 0;
    this.addressedRoom = 0;
    this.infrontX = 0;
    this.throughTile = 0;

    // rooms
    this.drawnRoom = 0; this.nextRoom = 0;
    this.roomL = 0; this.roomR = 0; this.roomA = 0; this.roomB = 0;
    this.roomBL = 0; this.roomBR = 0; this.roomAL = 0; this.roomAR = 0;
    this.differentRoom = false;
    this.exitRoomTimer = 0;
    this.roomleaveResult = -1;

    // controls of this frame (`control_x`, `control_y`, `control_shift`) and
    // the remembered ones (`control_forward` ...)
    this.controlX = 0; this.controlY = 0; this.controlShift = 0;
    this.controlForward = 0; this.controlBackward = 0; this.controlUp = 0; this.controlDown = 0; this.controlShift2 = 0;
    this.ctrl1 = {forward: 0, backward: 0, up: 0, down: 0, shift2: 0};

    // collision
    this.objX = 0; this.objY = 0; this.objXl = 0; this.objDirection = 0; this.objId = 0; this.objChtab = 0;
    this.objClipTop = 0; this.objClipBottom = 192; this.objClipLeft = 0; this.objClipRight = 320;
    this.charXLeft = 0; this.charXRight = 0; this.charXLeftColl = 0; this.charXRightColl = 0;
    this.charTopY = 0; this.charTopRow = 0; this.charBottomRow = 0; this.charColLeft = 0; this.charColRight = 0;
    this.charWidthHalf = 0; this.charHeight = 0;
    this.collisionRow = 0; this.prevCollisionRow = -1;
    this.prevCollRoom = new Int8Array(10).fill(-1); this.prevCollFlags = new Uint8Array(10);
    this.currRowCollRoom = new Int8Array(10).fill(-1); this.currRowCollFlags = new Uint8Array(10);
    this.belowRowCollRoom = new Int8Array(10).fill(-1); this.belowRowCollFlags = new Uint8Array(10);
    this.aboveRowCollRoom = new Int8Array(10).fill(-1); this.aboveRowCollFlags = new Uint8Array(10);
    this.bumpColLeftOfWall = -1; this.bumpColRightOfWall = -1;
    this.rightCheckedCol = 0; this.leftCheckedCol = 0; this.collTileLeftXpos = 0;
    this.edgeType = 0;

    // the prince's condition
    this.hitpMax = settings.hitPoints === undefined ? 3 : settings.hitPoints;
    this.hitpCurr = this.hitpMax;
    this.hitpDelta = 0;
    this.guardhpCurr = 0; this.guardhpMax = 0; this.guardhpDelta = 0;
    this.haveSword = levelNumber === 0 || levelNumber >= 2;
    this.holdingSword = 0; this.offguard = 0; this.canGuardSeeKid = 0; this.isGuardNotice = 0;
    this.grabTimer = 0; this.isScreaming = 0; this.knock = 0; this.fallFrame = 0;
    this.isFeatherFall = 0; this.upsideDown = 0; this.droppedout = 0; this.pickupObjType = 0;
    this.resurrectTime = 0; this.needLevel1Music = levelNumber === 1 ? 1 : 0;
    this.leveldoorOpen = 0; this.checkpoint = 0; this.unitedWithShadow = 0;
    this.remMin = 60; this.remTick = 719; this.isShowTime = 0;
    this.nextLevel = levelNumber; this.isRestartLevel = false;
    this.flashColor = 0; this.flashTime = 0;

    /** the image sizes of the frames, given by the owner:
        `imageSize(chtab, id) → {width, height}` or null (`set_char_collision`
        reads the width and height of the image of the frame) */
    this.imageSize = null;
    /** the clip box of the prince climbing into the level door: the drawer
        of the room sets them from where it drew the door (`draw_leveldoor`) */
    this.leveldoorYBottom = 0;
    this.leveldoorRight = 0;
    this.jumpedThroughMirror = 0;
    this.distanceMirror = 0;

    /** the tiles being animated (`trobs`): `{tilepos, room, type}`, type < 0 = done */
    this.trobs = [];
    /** the tile the trob code works on and its modifier (`trob`, `curr_modifier`) */
    this.trob = null;
    this.trobMod = 0;
    /** loose floors on their way down (`mobs`): `{xh, y, room, speed, type, row}` */
    this.mobs = [];
    this.curmob = null;
    this.curmobIndex = 0;
    this.lastLooseSound = 0;
    /** the time ran out (`expired`) — the owner decides what follows (P7) */
    this.timeExpired = false;
    /** the message of the bottom line and how many frames it stays (`display_text_bottom`) */
    this.bottomText = '';
    this.textTimeRemaining = 0;
    this.textTimeTotal = 0;

    /** sounds asked for this frame, sound numbers (the model plays them, P6) */
    this.sounds = [];
    /** the frame counter */
    this.frameCount = 0;

    this.startLevel();
  } // constructor

  // ================================================================ level start

  /** `play_level` (the part before the loop) + `do_startpos` + `set_start_pos` */
  startLevel() {
    var level = this.level;
    this.posGuards();
    this.clearCollRooms();
    this.clearSavedCtrl();
    this.drawnRoom = 0;
    this.mobs.length = 0;
    this.trobs.length = 0;
    this.holdingSword = 0; this.grabTimer = 0; this.canGuardSeeKid = 0; this.unitedWithShadow = 0;
    this.flashTime = 0; this.leveldoorOpen = 0; this.guardhpCurr = 0; this.hitpDelta = 0;
    this.guard.charId = CHARID.GUARD; this.guard.direction = DIR.NONE;

    // do_startpos
    var c = this.char;
    this.nextRoom = c.room = level.startRoom;
    var pos = level.startPos;
    c.currCol = pos % 10;
    c.currRow = cdiv(pos, 10);
    c.x = (X_BUMP[c.currCol+FIRST_ONSCREEN_COLUMN]+TILE_SIZEX) & 0xFF;
    c.direction = ~level.startDir;   // start facing the other way and turn round
    this.hitpMax = this.hitpCurr = this.levelNumber !== 0 ? this.hitpMax : 4;
    if (this.levelNumber === 1) {
      // level 1: the door above falls shut behind the prince and he drops in
      this.getTile(5, 2, 0);
      this.triggerButton(0, 0, -1);
      this.seqtblOffsetChar(SEQ.FALL);
    } else if (this.levelNumber === 13) {
      this.seqtblOffsetChar(SEQ.RUN);
    } else {
      this.seqtblOffsetChar(SEQ.TURN);
    }
    // set_start_pos
    c.y = Y_LAND[c.currRow+1] & 0xFF;
    c.alive = -1;
    c.charId = CHARID.KID;
    this.isScreaming = 0; this.knock = 0; this.upsideDown = 0; this.isFeatherFall = 0;
    c.fallY = 0; c.fallX = 0; this.offguard = 0; c.sword = SWORD.SHEATHED; this.droppedout = 0;
    this.playSeq();
    if (this.levelNumber === 7 && c.room === 17) {
      this.gotoOtherRoom(3);   // level 7: the prince falls in from the room above
    }
    // the level door of the start room slams shut behind the prince
    this.findStartLevelDoor();
    // draw_level_first: the first room
    this.nextRoom = c.room;
    this.checkTheEnd();
    this.exitRoomTimer = 2;
  } // startLevel

  /** `find_start_level_door` */
  findStartLevelDoor() {
    this.getRoomAddress(this.kid.room);
    for (var tilepos = 0; tilepos < 30; tilepos++) {
      if (this.tileAt(tilepos) === TILE.LEVEL_DOOR_LEFT) {
        this.startLevelDoor(this.kid.room, tilepos);
      }
    }
  } // findStartLevelDoor

  /** `pos_guards` */
  posGuards() {
    var level = this.level;
    for (var room = 0; room < 24; room++) {
      var tile = level.guardsTile[room];
      if (tile < 30) {
        level.guardsX[room] = (X_BUMP[(tile % 10)+FIRST_ONSCREEN_COLUMN]+TILE_SIZEX) & 0xFF;
        level.guardsSeqHi[room] = 0;
      }
    }
  } // posGuards

  // ================================================================== one frame

  /**
   * The controls of this frame, as the original reads its keyboard just
   * before the prince moves (`do_paused` → `read_keyb_control`).
   * @param {number} x - -1 left, 0 none, 1 right (CONTROL.HELD_LEFT/RIGHT).
   * @param {number} y - -1 up, 0 none, 1 down.
   * @param {boolean} shift - The action key.
   */
  setInput(x, y, shift) {
    this.nextRoom = 0;
    this.controlX = x < 0 ? CONTROL.HELD_LEFT : (x > 0 ? CONTROL.HELD_RIGHT : CONTROL.RELEASED);
    this.controlY = y < 0 ? CONTROL.HELD_UP : (y > 0 ? CONTROL.HELD_DOWN : CONTROL.RELEASED);
    this.controlShift = shift ? CONTROL.HELD : CONTROL.RELEASED;
  } // setInput

  /**
   * One game frame (`play_level_2` body: `timers`, `play_frame`).
   * Call setInput() first.
   */
  playFrame() {
    this.frameCount++;
    this.scheduler.frame = this.frameCount;
    this.sounds.length = 0;
    this.guardhpDelta = 0;
    this.hitpDelta = 0;
    this.timers();
    // play_frame
    this.doMobs();
    this.processTrobs();
    this.checkSkel();
    this.checkCanGuardSeeKid();
    if (this.playKidFrame()) {
      return;
    }
    this.playGuardFrame();
    this.checkSwordHurting();
    this.checkSwordHurt();
    this.checkSwordVsSword();
    this.doDeltaHp();
    this.exitRoom();
    this.checkTheEnd();
    this.checkGuardFallout();
    if (this.levelNumber === 6 && this.roomleaveResult === -2) {
      this.kid.y = 0xFF;   // level 6: the falling exit
      this.nextLevel++;
    } else if (this.levelNumber === 12 && this.kid.room === 23) {
      this.nextLevel++;
    }
    this.showTime();
    // expiring does not count on Jaffar's and the princess's levels
    if (this.levelNumber < 13 && this.remMin === 0) {
      this.expired();
    }
  } // playFrame

  /**
   * `expired`: the hour is over. The original shows the "time expired"
   * cutscene and starts the game over; here the flag is raised for the
   * owner (P7) and the game stands still.
   */
  expired() {
    this.timeExpired = true;
  } // expired

  /** `timers` — what the prince needs of it */
  timers() {
    if (this.unitedWithShadow > 0) {
      this.unitedWithShadow--;
      if (this.unitedWithShadow === 0) {
        this.unitedWithShadow--;
      }
    }
    if (this.resurrectTime > 0) {
      this.resurrectTime--;
    }
    if (this.isFeatherFall) {
      this.isFeatherFall++;
    }
    if (this.isFeatherFall && (!this.checkSoundPlaying() || this.isFeatherFall > 225)) {
      this.isFeatherFall = 0;
    }
    // level 8: the mouse comes 150 frames after the level door opened
    if (this.levelNumber === 8 && this.char.room === 16 && this.leveldoorOpen) {
      this.leveldoorOpen = (this.leveldoorOpen+1) & 0xFFFF;
      if (this.leveldoorOpen === 150) {
        this.doMouse();
      }
    }
  } // timers

  /**
   * `show_time`: the clock. 720 frames make a minute; time stands still
   * while the prince is dead, on level 13 once Jaffar is dead, and on
   * levels 13–15. The messages of the bottom line are composed here the way
   * the original composes them; drawing them is the owner's (P7).
   */
  showTime() {
    if (this.kid.alive < 0 && this.remMin !== 0 &&
        (this.levelNumber < 13 || (this.levelNumber === 13 && this.leveldoorOpen === 0)) &&
        this.levelNumber < 15) {
      this.remTick--;
      if (this.remTick === 0) {
        this.remTick = 719;
        this.remMin--;
        if (this.remMin !== 0 && (this.remMin <= 5 || this.remMin % 5 === 0)) {
          this.isShowTime = 1;
        }
      } else if (this.remMin === 1 && this.remTick % 12 === 0) {
        this.isShowTime = 1;
        this.textTimeRemaining = 0;
      }
    }
    if (this.isShowTime && this.textTimeRemaining === 0) {
      this.textTimeRemaining = this.textTimeTotal = 24;
      if (this.remMin > 0) {
        if (this.remMin === 1) {
          var remSec = cdiv(this.remTick+1, 12);
          if (remSec === 1) {
            this.bottomText = '1 SECOND LEFT';
            this.textTimeRemaining = this.textTimeTotal = 12;
          } else {
            this.bottomText = remSec+' SECONDS LEFT';
          }
        } else {
          this.bottomText = this.remMin+' MINUTES LEFT';
        }
      } else {
        this.bottomText = 'TIME HAS EXPIRED!';
      }
      this.isShowTime = 0;
    }
  } // showTime

  /**
   * The bottom line ages one frame (`draw_game_frame`, the text part): the
   * owner calls it after drawing; the text is gone when the count is up.
   */
  ageBottomText() {
    if (this.textTimeRemaining === 1) {
      this.textTimeRemaining = this.textTimeTotal = 0;
      this.bottomText = '';
    } else if (this.textTimeRemaining !== 0 && this.textTimeTotal !== 1188) {
      this.textTimeRemaining--;
    }
  } // ageBottomText

  /** `play_kid_frame` */
  playKidFrame() {
    this.loadFramDetCol();
    this.playKid();
    if (this.isRestartLevel) {
      return true;
    }
    if (this.char.room !== 0) {
      this.playSeq();
      this.fallAccel();
      this.fallSpeed();
      this.loadFrameToObj();
      this.loadFramDetCol();
      this.setCharCollision();
      this.bumpIntoOpponent();
      this.checkCollisions();
      this.checkBumped();
      this.checkGatePush();
      this.checkAction();
      this.checkPress();
      this.checkSpikeBelow();
      if (this.resurrectTime === 0) {
        this.checkSpiked();
        this.checkChompedKid();
      }
      this.checkKnock();
    }
    return false;
  } // playKidFrame

  /** `play_kid` */
  playKid() {
    this.fellOut();
    this.controlKid();
    var c = this.char;
    if (c.alive >= 0 && this.isDead()) {
      // the counting after death; the restart is the player's (P7)
      if (this.checkSoundPlaying()) {
        return;
      }
      this.isShowTime = 0;
      if (c.alive < 0 || c.alive >= 6) {
        if (c.alive !== 6) {
          if (c.alive !== 7) {
            return;
          }
        }
      }
      c.alive++;
    }
  } // playKid

  /** `fell_out` */
  fellOut() {
    var c = this.char;
    if (c.alive < 0 && c.room === 0) {
      this.takeHp(100);
      c.alive = 0;
      c.frame = FRAME.DEAD;
    }
  } // fellOut

  /** `control_kid` */
  controlKid() {
    var c = this.char;
    if (c.alive < 0 && this.hitpCurr === 0) {
      c.alive = 0;
    }
    if (this.grabTimer !== 0) {
      this.grabTimer--;
    }
    this.restCtrl1();
    this.readUserControl();
    this.userControl();
    this.saveCtrl1();
  } // controlKid

  // ================================================================== controls

  /** `read_user_control`: a key held is HELD once, then stays until released */
  readUserControl() {
    if (this.controlForward >= CONTROL.RELEASED) {
      if (this.controlX === CONTROL.HELD_FORWARD) {
        if (this.controlForward === CONTROL.RELEASED) {
          this.controlForward = CONTROL.HELD;
        }
      } else {
        this.controlForward = CONTROL.RELEASED;
      }
    }
    if (this.controlBackward >= CONTROL.RELEASED) {
      if (this.controlX === CONTROL.HELD_BACKWARD) {
        if (this.controlBackward === CONTROL.RELEASED) {
          this.controlBackward = CONTROL.HELD;
        }
      } else {
        this.controlBackward = CONTROL.RELEASED;
      }
    }
    if (this.controlUp >= CONTROL.RELEASED) {
      if (this.controlY === CONTROL.HELD_UP) {
        if (this.controlUp === CONTROL.RELEASED) {
          this.controlUp = CONTROL.HELD;
        }
      } else {
        this.controlUp = CONTROL.RELEASED;
      }
    }
    if (this.controlDown >= CONTROL.RELEASED) {
      if (this.controlY === CONTROL.HELD_DOWN) {
        if (this.controlDown === CONTROL.RELEASED) {
          this.controlDown = CONTROL.HELD;
        }
      } else {
        this.controlDown = CONTROL.RELEASED;
      }
    }
    if (this.controlShift2 >= CONTROL.RELEASED) {
      if (this.controlShift === CONTROL.HELD) {
        if (this.controlShift2 === CONTROL.RELEASED) {
          this.controlShift2 = CONTROL.HELD;
        }
      } else {
        this.controlShift2 = CONTROL.RELEASED;
      }
    }
  } // readUserControl

  /** `user_control`: forward/backward are relative to where the prince looks */
  userControl() {
    if (this.char.direction >= DIR.RIGHT) {
      this.flipControlX();
      this.control();
      this.flipControlX();
    } else {
      this.control();
    }
  } // userControl

  flipControlX() {
    this.controlX = -this.controlX;
    var temp = this.controlForward;
    this.controlForward = this.controlBackward;
    this.controlBackward = temp;
  } // flipControlX

  /** `release_arrows` */
  releaseArrows() {
    this.controlBackward = this.controlForward = this.controlUp = this.controlDown = CONTROL.RELEASED;
    return 1;
  } // releaseArrows

  saveCtrl1() {
    this.ctrl1.forward = this.controlForward; this.ctrl1.backward = this.controlBackward;
    this.ctrl1.up = this.controlUp; this.ctrl1.down = this.controlDown; this.ctrl1.shift2 = this.controlShift2;
  } // saveCtrl1

  restCtrl1() {
    this.controlForward = this.ctrl1.forward; this.controlBackward = this.ctrl1.backward;
    this.controlUp = this.ctrl1.up; this.controlDown = this.ctrl1.down; this.controlShift2 = this.ctrl1.shift2;
  } // restCtrl1

  clearSavedCtrl() {
    this.ctrl1.forward = this.ctrl1.backward = this.ctrl1.up = this.ctrl1.down = this.ctrl1.shift2 = CONTROL.RELEASED;
  } // clearSavedCtrl

  /** `control`: what the prince does with the controls, by what he is doing */
  control() {
    var c = this.char;
    var frame = c.frame;
    if (c.alive >= 0) {
      if (frame === FRAME.STAND || frame === FRAME.STAND_INACTIVE ||
          frame === FRAME.STAND_WITH_SWORD_158 || frame === FRAME.STAND_WITH_SWORD_171) {
        this.seqtblOffsetChar(SEQ.DYING);
      }
      return;
    }
    var action = c.action;
    if (action === ACTION.BUMPED || action === ACTION.IN_FREEFALL) {
      this.releaseArrows();
    } else if (c.sword === SWORD.DRAWN) {
      this.controlWithSword();
    } else if (c.charId >= CHARID.GUARD) {
      this.controlGuardInactive();
    } else if (frame === FRAME.STAND || (frame >= FRAME.TURN_50 && frame < 53)) {
      this.controlStanding();
    } else if (frame === FRAME.TURN_48) {
      this.controlTurning();
    } else if (frame < 4) {
      this.controlStartrun();
    } else if (frame >= FRAME.START_JUMP_UP_1 && frame < FRAME.JUMPHANG_70) {
      this.controlJumpup();
    } else if (frame < 15) {
      this.controlRunning();
    } else if (frame >= FRAME.HANGING_1 && frame < 100) {
      this.controlHanging();
    } else if (frame === FRAME.CROUCH) {
      this.controlCrouched();
    }
  } // control

  /** `control_crouched` */
  controlCrouched() {
    if (this.needLevel1Music !== 0 && this.levelNumber === 1) {
      // level 1: the presentation music plays while the prince crouches
      if (!this.checkSoundPlaying()) {
        if (this.needLevel1Music === 1) {
          this.playSound(25);
          this.needLevel1Music = 2;
        } else {
          this.needLevel1Music = 0;
        }
      }
    } else {
      this.needLevel1Music = 0;
      if (this.controlShift2 === CONTROL.HELD && this.checkGetItem()) {
        return;
      }
      if (this.controlY !== CONTROL.HELD_DOWN) {
        this.seqtblOffsetChar(SEQ.STAND_UP_FROM_CROUCH);
      } else if (this.controlForward === CONTROL.HELD) {
        this.controlForward = CONTROL.IGNORE;
        this.seqtblOffsetChar(SEQ.CROUCH_HOP);
      }
    }
  } // controlCrouched

  /** `control_standing` */
  controlStanding() {
    var c = this.char;
    if (this.controlShift2 === CONTROL.HELD && this.controlShift === CONTROL.HELD && this.checkGetItem()) {
      return;
    }
    if (c.charId !== CHARID.KID && this.controlDown === CONTROL.HELD && this.controlForward === CONTROL.HELD) {
      this.drawSword();
      return;
    }
    var skipShift = false;
    if (this.haveSword) {
      if (this.offguard !== 0 && this.controlShift >= CONTROL.RELEASED) {
        skipShift = true;
      } else if (this.canGuardSeeKid >= 2) {
        var distance = this.charOppDist();
        if (distance >= -10 && distance < 90) {
          this.holdingSword = 1;
          if (u16(distance) < u16(-6)) {
            if (this.opp.charId === CHARID.SHADOW &&
                (this.opp.action === ACTION.IN_MIDAIR || (this.opp.frame >= FRAME.FALL_LAND_1 && this.opp.frame < 118))) {
              this.offguard = 0;
            } else {
              this.drawSword();
              return;
            }
          } else {
            this.backPressed();
            return;
          }
        }
      } else {
        this.offguard = 0;
      }
    }
    if (!skipShift && this.controlShift === CONTROL.HELD) {
      if (this.controlBackward === CONTROL.HELD) {
        this.backPressed();
      } else if (this.controlUp === CONTROL.HELD) {
        this.upPressed();
      } else if (this.controlDown === CONTROL.HELD) {
        this.downPressed();
      } else if (this.controlX === CONTROL.HELD_FORWARD && this.controlForward === CONTROL.HELD) {
        this.safeStep();
      }
    } else if (this.controlForward === CONTROL.HELD) {
      if (this.keyboardMode && this.controlUp === CONTROL.HELD) {
        this.standingJump();
      } else {
        this.forwardPressed();
      }
    } else if (this.controlBackward === CONTROL.HELD) {
      this.backPressed();
    } else if (this.controlUp === CONTROL.HELD) {
      if (this.keyboardMode && this.controlForward === CONTROL.HELD) {
        this.standingJump();
      } else {
        this.upPressed();
      }
    } else if (this.controlDown === CONTROL.HELD) {
      this.downPressed();
    } else if (this.controlX === CONTROL.HELD_FORWARD) {
      this.forwardPressed();
    }
  } // controlStanding

  /** `up_pressed` */
  upPressed() {
    var leveldoorTilepos = -1;
    if (this.getTileAtChar() === TILE.LEVEL_DOOR_LEFT) {
      leveldoorTilepos = this.currTilepos;
    } else if (this.getTileBehindChar() === TILE.LEVEL_DOOR_LEFT) {
      leveldoorTilepos = this.currTilepos;
    } else if (this.getTileInfrontofChar() === TILE.LEVEL_DOOR_LEFT) {
      leveldoorTilepos = this.currTilepos;
    }
    if (leveldoorTilepos !== -1 && this.level.startRoom !== this.drawnRoom && this.leveldoorOpen) {
      this.goUpLeveldoor();
      return;
    }
    if (this.controlX === CONTROL.HELD_FORWARD) {
      this.standingJump();
    } else {
      this.checkJumpUp();
    }
  } // upPressed

  /** `down_pressed` */
  downPressed() {
    var c = this.char;
    this.controlDown = CONTROL.IGNORE;
    if (!tileIsFloor(this.getTileInfrontofChar()) && this.distanceToEdgeWeight() < 3) {
      c.x = this.charDxForward(5) & 0xFF;
      this.loadFramDetCol();
    } else if (!tileIsFloor(this.getTileBehindChar()) && this.distanceToEdgeWeight() >= 8) {
      this.throughTile = this.getTileBehindChar();
      this.getTileAtChar();
      if (this.canGrab() &&
          (c.direction >= DIR.RIGHT || this.getTileAtChar() !== TILE.GATE || (this.currModifier() >> 2) >= 6)) {
        c.x = this.charDxForward(this.distanceToEdgeWeight()-9) & 0xFF;
        this.seqtblOffsetChar(SEQ.CLIMB_DOWN);
      } else {
        this.crouch();
      }
    } else {
      this.crouch();
    }
  } // downPressed

  /** `go_up_leveldoor` */
  goUpLeveldoor() {
    var c = this.char;
    c.x = (X_BUMP[this.tileCol+FIRST_ONSCREEN_COLUMN]+10) & 0xFF;
    c.direction = DIR.LEFT;
    this.seqtblOffsetChar(SEQ.GO_UP_ON_LEVEL_DOOR);
  } // goUpLeveldoor

  /** `control_turning` */
  controlTurning() {
    if (this.controlShift >= CONTROL.RELEASED && this.controlX === CONTROL.HELD_FORWARD && this.controlY >= CONTROL.RELEASED) {
      this.seqtblOffsetChar(SEQ.START_RUN_AFTER_TURN);
    }
  } // controlTurning

  crouch() {
    this.seqtblOffsetChar(SEQ.CROUCH);
    this.controlDown = this.releaseArrows();
  } // crouch

  /** `back_pressed` */
  backPressed() {
    this.controlBackward = this.releaseArrows();
    var seqId;
    if (this.haveSword === false || this.canGuardSeeKid < 2 || this.charOppDist() > 0 || this.distanceToEdgeWeight() < 2) {
      seqId = SEQ.TURN;
    } else {
      this.char.sword = SWORD.DRAWN;
      this.offguard = 0;
      seqId = SEQ.TURN_DRAW_SWORD;
    }
    this.seqtblOffsetChar(seqId);
  } // backPressed

  /** `forward_pressed` */
  forwardPressed() {
    var distance = this.getEdgeDistance();
    if (this.edgeType === EDGE.WALL && this.currTile2 !== TILE.CHOMPER && distance < 8) {
      // near a wall a step, not a run
      if (this.controlForward === CONTROL.HELD) {
        this.safeStep();
      }
    } else {
      this.seqtblOffsetChar(SEQ.START_RUN);
    }
  } // forwardPressed

  /** `control_running` */
  controlRunning() {
    var c = this.char;
    if (this.controlX === CONTROL.RELEASED && (c.frame === FRAME.RUN_7 || c.frame === FRAME.RUN_11)) {
      this.controlForward = this.releaseArrows();
      this.seqtblOffsetChar(SEQ.STOP_RUN);
    } else if (this.controlX === CONTROL.HELD_BACKWARD) {
      this.controlBackward = this.releaseArrows();
      this.seqtblOffsetChar(SEQ.RUN_TURN);
    } else if (this.controlY === CONTROL.HELD_UP && this.controlUp === CONTROL.HELD) {
      this.runJump();
    } else if (this.controlDown === CONTROL.HELD) {
      this.controlDown = CONTROL.IGNORE;
      this.seqtblOffsetChar(SEQ.CROUCH_WHILE_RUNNING);
    }
  } // controlRunning

  /** `safe_step` */
  safeStep() {
    this.controlShift2 = CONTROL.IGNORE;
    this.controlForward = CONTROL.IGNORE;
    var distance = this.getEdgeDistance();
    if (distance) {
      this.char.repeat = 1;
      this.seqtblOffsetChar(distance+28);   // 29..42: a step to the edge
    } else if (this.edgeType !== EDGE.WALL && this.char.repeat !== 0) {
      this.char.repeat = 0;
      this.seqtblOffsetChar(SEQ.STEP_ON_EDGE);
    } else {
      this.seqtblOffsetChar(SEQ.SAFE_STEP_11);   // the unsafe step off the ledge
    }
  } // safeStep

  /** `check_get_item` */
  checkGetItem() {
    var c = this.char;
    if (this.getTileAtChar() === TILE.POTION || this.currTile2 === TILE.SWORD) {
      if (!tileIsFloor(this.getTileBehindChar())) {
        return false;
      }
      c.x = this.charDxForward(-14) & 0xFF;
      this.loadFramDetCol();
    }
    if (this.getTileInfrontofChar() === TILE.POTION || this.currTile2 === TILE.SWORD) {
      this.getItem();
      return true;
    }
    return false;
  } // checkGetItem

  /** `get_item` */
  getItem() {
    var c = this.char;
    if (c.frame !== FRAME.CROUCH) {
      var distance = this.getEdgeDistance();
      if (this.edgeType !== EDGE.FLOOR) {
        c.x = this.charDxForward(distance) & 0xFF;
      }
      if (c.direction >= DIR.RIGHT) {
        c.x = this.charDxForward((this.currTile2 === TILE.POTION ? 1 : 0)-2) & 0xFF;
      }
      this.crouch();
    } else if (this.currTile2 === TILE.SWORD) {
      this.doPickup(-1);
      this.seqtblOffsetChar(SEQ.GET_SWORD);
    } else {
      this.doPickup(this.currModifier() >> 3);
      this.seqtblOffsetChar(SEQ.DRINK);
    }
  } // getItem

  controlStartrun() {
    if (this.controlY === CONTROL.HELD_UP && this.controlX === CONTROL.HELD_FORWARD) {
      this.standingJump();
    }
  } // controlStartrun

  controlJumpup() {
    if (this.controlX === CONTROL.HELD_FORWARD || this.controlForward === CONTROL.HELD) {
      this.standingJump();
    }
  } // controlJumpup

  standingJump() {
    this.controlUp = this.controlForward = CONTROL.IGNORE;
    this.seqtblOffsetChar(SEQ.STANDING_JUMP);
  } // standingJump

  /** `check_jump_up` */
  checkJumpUp() {
    this.controlUp = this.releaseArrows();
    this.throughTile = this.getTileAboveChar();
    this.getTileFrontAboveChar();
    if (this.canGrab()) {
      this.grabUpWithFloorBehind();
    } else {
      this.throughTile = this.getTileBehindAboveChar();
      this.getTileAboveChar();
      if (this.canGrab()) {
        this.jumpUpOrGrab();
      } else {
        this.jumpUp();
      }
    }
  } // checkJumpUp

  /** `jump_up_or_grab` */
  jumpUpOrGrab() {
    var distance = this.distanceToEdgeWeight();
    if (distance < 6) {
      this.jumpUp();
    } else if (!tileIsFloor(this.getTileBehindChar())) {
      this.grabUpNoFloorBehind();
    } else {
      this.char.x = this.charDxForward(distance-TILE_SIZEX) & 0xFF;
      this.loadFramDetCol();
      this.grabUpWithFloorBehind();
    }
  } // jumpUpOrGrab

  grabUpNoFloorBehind() {
    this.getTileAboveChar();
    this.char.x = this.charDxForward(this.distanceToEdgeWeight()-10) & 0xFF;
    this.seqtblOffsetChar(SEQ.JUMP_UP_AND_GRAB);
  } // grabUpNoFloorBehind

  /** `jump_up` */
  jumpUp() {
    var c = this.char;
    this.controlUp = this.releaseArrows();
    var distance = this.getEdgeDistance();
    if (distance < 4 && this.edgeType === EDGE.WALL) {
      c.x = this.charDxForward(distance-3) & 0xFF;
    }
    this.getTile(c.room, this.getTileDivMod(this.backDeltaX(0)+this.dxWeight()-6), c.currRow-1);
    if (this.currTile2 !== TILE.WALL && !tileIsFloor(this.currTile2)) {
      this.seqtblOffsetChar(SEQ.JUMP_UP_WITH_NOTHING_ABOVE);
    } else {
      this.seqtblOffsetChar(SEQ.JUMP_UP_INTO_CEILING);
    }
  } // jumpUp

  /** `control_hanging` */
  controlHanging() {
    var c = this.char;
    if (c.alive < 0) {
      if (this.grabTimer === 0 && this.controlY === CONTROL.HELD) {
        this.canClimbUp();
      } else if (this.controlShift === CONTROL.HELD) {
        if (c.action !== ACTION.HANG_STRAIGHT &&
            (this.getTileAtChar() === TILE.WALL ||
             (c.direction === DIR.LEFT && (this.currTile2 === TILE.DOORTOP_WITH_FLOOR || this.currTile2 === TILE.DOORTOP)))) {
          if (this.grabTimer === 0) {
            this.playSound(8);
          }
          this.seqtblOffsetChar(SEQ.HANG_AGAINST_WALL);
        } else if (!tileIsFloor(this.getTileAboveChar())) {
          this.hangFall();
        }
      } else {
        this.hangFall();
      }
    } else {
      this.hangFall();
    }
  } // controlHanging

  /** `can_climb_up` */
  canClimbUp() {
    var c = this.char;
    var seqId = SEQ.CLIMB_UP;
    this.controlUp = this.controlShift2 = this.releaseArrows();
    this.getTileAboveChar();
    if (((this.currTile2 === TILE.MIRROR || this.currTile2 === TILE.CHOMPER) && c.direction === DIR.RIGHT) ||
        (this.currTile2 === TILE.GATE && c.direction !== DIR.RIGHT && (this.currModifier() >> 2) < 6)) {
      seqId = SEQ.CLIMB_UP_TO_CLOSED_GATE;
    }
    this.seqtblOffsetChar(seqId);
  } // canClimbUp

  /** `hang_fall` */
  hangFall() {
    var c = this.char;
    this.controlDown = this.releaseArrows();
    if (!tileIsFloor(this.getTileBehindChar()) && !tileIsFloor(this.getTileAtChar())) {
      this.seqtblOffsetChar(SEQ.RELEASE_LEDGE_AND_FALL);
    } else {
      if (this.getTileAtChar() === TILE.WALL ||
          (c.direction < DIR.RIGHT && (this.currTile2 === TILE.DOORTOP_WITH_FLOOR || this.currTile2 === TILE.DOORTOP))) {
        c.x = this.charDxForward(-7) & 0xFF;
      }
      this.seqtblOffsetChar(SEQ.RELEASE_LEDGE_AND_LAND);
    }
  } // hangFall

  /** `grab_up_with_floor_behind` */
  grabUpWithFloorBehind() {
    var distance = this.distanceToEdgeWeight();
    var edgeDistance = this.getEdgeDistance();
    if (distance < 4 && edgeDistance < 4 && this.edgeType !== EDGE.WALL) {
      this.char.x = this.charDxForward(distance) & 0xFF;
      this.seqtblOffsetChar(SEQ.JUMP_UP_AND_GRAB_STRAIGHT);
    } else {
      this.char.x = this.charDxForward(distance-4) & 0xFF;
      this.seqtblOffsetChar(SEQ.JUMP_UP_AND_GRAB_FORWARD);
    }
  } // grabUpWithFloorBehind

  /** `run_jump`: the prince takes off from the edge of the floor */
  runJump() {
    var c = this.char;
    if (c.frame >= FRAME.RUN_7) {
      var xpos = this.charDxForward(4);
      var col = this.getTileDivModM7(xpos);
      for (var tilesForward = 0; tilesForward < 2; tilesForward++) {
        col += DIR_FRONT[c.direction+1];
        this.getTile(c.room, col, c.currRow);
        if (this.currTile2 === TILE.SPIKE || !tileIsFloor(this.currTile2)) {
          var posAdjustment = this.distanceToEdge(xpos)+TILE_SIZEX*tilesForward-TILE_SIZEX;
          if (u16(posAdjustment) < u16(-8) || posAdjustment >= 2) {
            if (posAdjustment < 128) {
              return;
            }
            posAdjustment = -3;
          }
          c.x = this.charDxForward(posAdjustment+4) & 0xFF;
          break;
        }
      }
      this.controlUp = this.releaseArrows();
      this.seqtblOffsetChar(SEQ.RUN_JUMP);
    }
  } // runJump

  // ------------------------------------------------------- sword (P5 hooks)

  /** `draw_sword` */
  drawSword() {
    var seqId = SEQ.DRAW_SWORD;
    this.controlForward = this.controlShift2 = this.releaseArrows();
    if (this.char.charId === CHARID.KID) {
      this.playSound(19);
      this.offguard = 0;
    } else if (this.char.charId !== CHARID.SHADOW) {
      seqId = SEQ.EN_GARDE;
    }
    this.char.sword = SWORD.DRAWN;
    this.seqtblOffsetChar(seqId);
  } // drawSword

  /** `control_with_sword` — the prince alone puts the sword away (P5 brings the fight) */
  controlWithSword() {
    var c = this.char;
    if (c.action < ACTION.HANG_CLIMB) {
      if (this.getTileAtChar() === TILE.LOOSE || this.canGuardSeeKid >= 2) {
        var distance = this.charOppDist();
        if (u16(distance) < 90) {
          this.swordfight();
          return;
        } else if (distance < 0) {
          if (u16(distance) < u16(-4)) {
            this.seqtblOffsetChar(SEQ.TURN_WITH_SWORD);
            return;
          } else {
            this.swordfight();
            return;
          }
        }
      }
      if (c.charId === CHARID.KID && c.alive < 0) {
        this.holdingSword = 0;
      }
      if (c.charId < CHARID.GUARD) {
        if (c.frame === FRAME.STAND_WITH_SWORD_171) {
          c.sword = SWORD.SHEATHED;
          this.seqtblOffsetChar(SEQ.PUT_SWORD_AWAY);
        }
      } else {
        this.swordfight();
      }
    }
  } // controlWithSword

  /** `swordfight` (P5) */
  swordfight() {
  } // swordfight

  controlGuardInactive() {
  } // controlGuardInactive

  /** `char_opp_dist`: 999 without an opponent in the room */
  charOppDist() {
    var c = this.char, o = this.opp;
    if (c.room !== o.room) {
      return 999;
    }
    var distance = o.x-c.x;
    if (c.direction < DIR.RIGHT) {
      distance = -distance;
    }
    if (distance >= 0 && c.direction !== o.direction) {
      distance += 13;
    }
    return distance;
  } // charOppDist

  // ============================================================== the sequence

  /** `seqtbl_offset_char` */
  seqtblOffsetChar(seqId) {
    this.char.currSeq = this.seq.offsetOf(seqId);
  } // seqtblOffsetChar

  /** `play_seq`: runs the instructions up to the next frame number */
  playSeq() {
    var c = this.char;
    var seq = this.seq;
    for (;;) {
      var command = seq.read(c.currSeq);
      c.currSeq++;
      switch (command) {
        case SEQ_OP.DX:
          c.x = this.charDxForward(seq.read(c.currSeq)) & 0xFF;
          c.currSeq++;
          break;
        case SEQ_OP.DY:
          c.y = (c.y+seq.read(c.currSeq)) & 0xFF;
          c.currSeq++;
          break;
        case SEQ_OP.FLIP:
          c.direction = ~c.direction;
          break;
        case SEQ_OP.JMP_IF_FEATHER:
          if (!this.isFeatherFall) {
            c.currSeq += 2;
            break;
          }
          c.currSeq = seq.readWord(c.currSeq);
          break;
        case SEQ_OP.JMP:
          c.currSeq = seq.readWord(c.currSeq);
          break;
        case SEQ_OP.UP:
          c.currRow--;
          this.startChompers();
          break;
        case SEQ_OP.DOWN:
          c.currRow++;
          this.startChompers();
          break;
        case SEQ_OP.ACTION:
          c.action = seq.read(c.currSeq);
          c.currSeq++;
          break;
        case SEQ_OP.SET_FALL:
          c.fallX = s8(seq.read(c.currSeq));
          c.currSeq++;
          c.fallY = s8(seq.read(c.currSeq));
          c.currSeq++;
          break;
        case SEQ_OP.KNOCK_UP:
          this.knock = 1;
          break;
        case SEQ_OP.KNOCK_DOWN:
          this.knock = -1;
          break;
        case SEQ_OP.SOUND: {
          var which = seq.read(c.currSeq);
          c.currSeq++;
          switch (which) {
            case SEQ_SOUND.SILENT:
              this.isGuardNotice = 1;
              break;
            case SEQ_SOUND.FOOTSTEP:
              this.playSound(23);
              this.isGuardNotice = 1;
              break;
            case SEQ_SOUND.BUMP:
              this.playSound(8);
              this.isGuardNotice = 1;
              break;
            case SEQ_SOUND.DRINK:
              this.playSound(18);
              break;
            case SEQ_SOUND.LEVEL:
              if (this.levelNumber === 4) {
                this.playSound(32);
              } else if (this.levelNumber !== 13 && this.levelNumber !== 15) {
                this.playSound(41);
              }
              break;
          }
          break;
        }
        case SEQ_OP.END_LEVEL:
          this.nextLevel++;
          break;
        case SEQ_OP.GET_ITEM: {
          var item = seq.read(c.currSeq);
          c.currSeq++;
          if (item === 1) {
            this.procGetObject();
          }
          break;
        }
        case SEQ_OP.DIE:
          break;
        default:
          c.frame = command;
          return;
      }
    }
  } // playSeq

  // =============================================================== frames, x

  /** `load_frame` */
  loadFrame() {
    var c = this.char;
    var frame = c.frame;
    switch (c.charId) {
      case CHARID.GUARD:
      case CHARID.SKELETON:
        this.curFrame = this.frameTables.guard.get(frame+(frame >= 102 && frame < 107 ? 70 : 0)-149);
        break;
      case CHARID.SHADOW:
        if (frame < 150 || frame >= 190) {
          this.curFrame = this.frameTables.kid.get(frame);
        } else {
          this.curFrame = this.frameTables.guard.get(frame-149);
        }
        break;
      case CHARID.PRINCESS:
      case CHARID.VIZIER:
        this.curFrame = this.frameTables.cuts.get(frame);
        break;
      default:
        this.curFrame = this.frameTables.kid.get(frame);
        break;
    }
  } // loadFrame

  /** `load_fram_det_col` */
  loadFramDetCol() {
    this.loadFrame();
    this.determineCol();
  } // loadFramDetCol

  /** `determine_col` */
  determineCol() {
    this.char.currCol = s8(this.getTileDivModM7(this.dxWeight()));
  } // determineCol

  /** `dx_weight`: where the prince's weight is */
  dxWeight() {
    var offset = s8(this.curFrame.dx-(this.curFrame.flags & FRAME_FLAG.WEIGHT_X));
    return this.charDxForward(offset);
  } // dxWeight

  /** `char_dx_forward`: x moved by delta in the direction he looks (not wrapped) */
  charDxForward(deltaX) {
    if (this.char.direction < DIR.RIGHT) {
      deltaX = -deltaX;
    }
    return deltaX+this.char.x;
  } // charDxForward

  /** `back_delta_x` */
  backDeltaX(deltaX) {
    return this.char.direction < DIR.RIGHT ? deltaX : -deltaX;
  } // backDeltaX

  /**
   * `get_tile_div_mod`: the column of an x and the position within the tile
   * (`obj_xl`). Beyond 0..255 the original read past its tables; those
   * bytes are reproduced (from SDLPoP; ★ not yet verified in our EXE).
   */
  getTileDivMod(xpos) {
    var x = xpos-SCREENSPACE_X;
    var xl = cmod(x, TILE_SIZEX);
    var xh = cdiv(x, TILE_SIZEX);
    if (xl < 0) {
      xh--;
      xl += TILE_SIZEX;
    }
    if (xpos < 0) {
      if (BOGUS_BEFORE.length+xpos >= 0) {
        xh = BOGUS_BEFORE[BOGUS_BEFORE.length+xpos];
        xl = this.tileDivTable(256+xpos);
      }
    } else if (xpos >= 256) {
      if (xpos-256 < BOGUS_AFTER.length) {
        xh = this.tileModTable(xpos-256);
        xl = BOGUS_AFTER[xpos-256];
      }
    }
    this.objXl = xl;
    return xh;
  } // getTileDivMod

  /** `tile_div_tbl[i]` of the original, computed */
  tileDivTable(i) {
    return s8(cdiv(i-SCREENSPACE_X-(cmod(i-SCREENSPACE_X, TILE_SIZEX) < 0 ? TILE_SIZEX : 0), TILE_SIZEX));
  } // tileDivTable

  /** `tile_mod_tbl[i]` of the original, computed */
  tileModTable(i) {
    var m = cmod(i-SCREENSPACE_X, TILE_SIZEX);
    return m < 0 ? m+TILE_SIZEX : m;
  } // tileModTable

  getTileDivModM7(xpos) {
    return this.getTileDivMod(xpos-7);
  } // getTileDivModM7

  /** `y_to_row_mod4` */
  yToRowMod4(ypos) {
    return cmod(cdiv(ypos+60, TILE_SIZEY), 4)-1;
  } // yToRowMod4

  // ================================================================== tiles

  /**
   * `get_tile`: the tile at a column and row of a room, following the
   * links when the column or row is outside it; room 0 is a wall.
   */
  getTile(room, col, row) {
    this.currRoom = room;
    this.tileCol = col;
    this.tileRow = row;
    this.currRoom = this.findRoomOfTile();
    if (this.currRoom > 0) {
      this.addressedRoom = this.currRoom;
      this.currTilepos = TBL_LINE[this.tileRow]+this.tileCol;
      this.currTile2 = this.level.fg[(this.currRoom-1)*30+this.currTilepos] & 0x1F;
    } else {
      this.currTile2 = TILE.WALL;
    }
    return this.currTile2;
  } // getTile

  /** `find_room_of_tile` — the original's order: columns first, then rows */
  findRoomOfTile() {
    var links = this.level.roomlinks;
    for (;;) {
      if (this.tileCol < 0) {
        this.tileCol += 10;
        if (this.currRoom) {
          this.currRoom = links[this.currRoom-1].left;
        }
        continue;
      }
      if (this.tileCol >= 10) {
        this.tileCol -= 10;
        if (this.currRoom) {
          this.currRoom = links[this.currRoom-1].right;
        }
        continue;
      }
      if (this.tileRow < 0) {
        this.tileRow += 3;
        if (this.currRoom) {
          this.currRoom = links[this.currRoom-1].up;
        }
        continue;
      }
      if (this.tileRow >= 3) {
        this.tileRow -= 3;
        if (this.currRoom) {
          this.currRoom = links[this.currRoom-1].down;
        }
        continue;
      }
      return this.currRoom;
    }
  } // findRoomOfTile

  /** `curr_room_modif[curr_tilepos]` of the last addressed room */
  currModifier() {
    if (!this.addressedRoom) {
      return 0;
    }
    return this.level.bg[(this.addressedRoom-1)*30+this.currTilepos];
  } // currModifier

  setCurrModifier(value) {
    if (this.addressedRoom) {
      this.level.bg[(this.addressedRoom-1)*30+this.currTilepos] = value & 0xFF;
    }
  } // setCurrModifier

  setCurrTile(value) {
    if (this.addressedRoom) {
      this.level.fg[(this.addressedRoom-1)*30+this.currTilepos] = value & 0xFF;
    }
  } // setCurrTile

  /**
   * `get_room_address`: the room whose tiles `tileAt()` & co. address.
   * Room 0 leaves the previous address in place, as the original does.
   */
  getRoomAddress(room) {
    if (room) {
      this.addressedRoom = room;
    }
  } // getRoomAddress

  /** `curr_room_tiles[tilepos] & 0x1F` of the addressed room (`get_curr_tile`) */
  tileAt(tilepos) {
    return this.addressedRoom ? this.level.fg[(this.addressedRoom-1)*30+tilepos] & 0x1F : 0;
  } // tileAt

  /** the whole tile byte — bit 5 marks a loose floor that never falls */
  tileByteAt(tilepos) {
    return this.addressedRoom ? this.level.fg[(this.addressedRoom-1)*30+tilepos] : 0;
  } // tileByteAt

  setTileAt(tilepos, value) {
    if (this.addressedRoom) {
      this.level.fg[(this.addressedRoom-1)*30+tilepos] = value & 0xFF;
    }
  } // setTileAt

  /** `curr_room_modif[tilepos]` of the addressed room */
  modAt(tilepos) {
    return this.addressedRoom ? this.level.bg[(this.addressedRoom-1)*30+tilepos] : 0;
  } // modAt

  setModAt(tilepos, value) {
    if (this.addressedRoom) {
      this.level.bg[(this.addressedRoom-1)*30+tilepos] = value & 0xFF;
    }
  } // setModAt

  getTileAtChar() { return this.getTile(this.char.room, this.char.currCol, this.char.currRow); }
  getTileAboveChar() { return this.getTile(this.char.room, this.char.currCol, this.char.currRow-1); }
  getTileBehindChar() { return this.getTile(this.char.room, DIR_BEHIND[this.char.direction+1]+this.char.currCol, this.char.currRow); }
  getTileBehindAboveChar() { return this.getTile(this.char.room, DIR_BEHIND[this.char.direction+1]+this.char.currCol, this.char.currRow-1); }

  getTileInfrontofChar() {
    this.infrontX = DIR_FRONT[this.char.direction+1]+this.char.currCol;
    return this.getTile(this.char.room, this.infrontX, this.char.currRow);
  } // getTileInfrontofChar

  getTileInfrontof2Char() {
    this.infrontX = (DIR_FRONT[this.char.direction+1] << 1)+this.char.currCol;
    return this.getTile(this.char.room, this.infrontX, this.char.currRow);
  } // getTileInfrontof2Char

  getTileFrontAboveChar() {
    this.infrontX = DIR_FRONT[this.char.direction+1]+this.char.currCol;
    return this.getTile(this.char.room, this.infrontX, this.char.currRow-1);
  } // getTileFrontAboveChar

  /** `distance_to_edge_weight` */
  distanceToEdgeWeight() {
    return this.distanceToEdge(this.dxWeight());
  } // distanceToEdgeWeight

  /** `distance_to_edge` */
  distanceToEdge(xpos) {
    this.getTileDivModM7(xpos);
    var distance = this.objXl;
    if (this.char.direction === DIR.RIGHT) {
      distance = TILE_RIGHTX-distance;
    }
    return distance;
  } // distanceToEdge

  /** `can_grab`: can the prince grab currTile2 through throughTile? */
  canGrab() {
    var c = this.char;
    var modifier = this.currModifier();
    if (this.throughTile === TILE.WALL) return false;
    if (this.throughTile === TILE.DOORTOP && c.direction >= DIR.RIGHT) return false;
    if (tileIsFloor(this.throughTile)) return false;
    if (this.currTile2 === TILE.LOOSE && modifier !== 0) return false;
    if (this.currTile2 === TILE.DOORTOP_WITH_FLOOR && c.direction < DIR.RIGHT) return false;
    if (!tileIsFloor(this.currTile2)) return false;
    return true;
  } // canGrab

  /** `wall_type` */
  wallType(tile) {
    switch (tile) {
      case TILE.GATE:
      case TILE.DOORTOP_WITH_FLOOR:
      case TILE.DOORTOP:
        return 1;   // wall at the right
      case TILE.MIRROR:
        return 2;   // wall at the left
      case TILE.CHOMPER:
        return 3;   // chomper at the left
      case TILE.WALL:
        return 4;
      default:
        return 0;
    }
  } // wallType

  /** `get_edge_distance`: how far the edge in front is and what kind */
  getEdgeDistance() {
    var c = this.char;
    var distance;
    this.determineCol();
    this.loadFrameToObj();
    this.setCharCollision();
    var tiletype = this.getTileAtChar();
    var done = false;
    if (this.wallType(tiletype) !== 0) {
      this.tileCol = c.currCol;
      distance = this.distFromWallForward(tiletype);
      if (distance >= 0) {
        if (distance <= TILE_RIGHTX) {
          this.edgeType = EDGE.WALL;
        } else {
          this.edgeType = EDGE.FLOOR;
          distance = 11;
        }
        done = true;
      }
    }
    if (!done) {
      tiletype = this.getTileInfrontofChar();
      if (tiletype === TILE.DOORTOP && c.direction >= DIR.RIGHT) {
        this.edgeType = EDGE.CLOSER;
        distance = this.distanceToEdgeWeight();
      } else {
        var closer = false;
        if (this.wallType(tiletype) !== 0) {
          this.tileCol = this.infrontX;
          distance = this.distFromWallForward(tiletype);
          if (distance >= 0) {
            if (distance <= TILE_RIGHTX) {
              this.edgeType = EDGE.WALL;
            } else {
              this.edgeType = EDGE.FLOOR;
              distance = 11;
            }
            this.currTile2 = tiletype;
            return distance;
          }
        }
        if (tiletype === TILE.LOOSE) {
          closer = true;
        } else if (tiletype === TILE.CLOSER || tiletype === TILE.SWORD || tiletype === TILE.POTION) {
          distance = this.distanceToEdgeWeight();
          if (distance !== 0) {
            this.edgeType = EDGE.CLOSER;
          } else {
            this.edgeType = EDGE.FLOOR;
            distance = 11;
          }
        } else if (tileIsFloor(tiletype)) {
          this.edgeType = EDGE.FLOOR;
          distance = 11;
        } else {
          closer = true;
        }
        if (closer) {
          this.edgeType = EDGE.CLOSER;
          distance = this.distanceToEdgeWeight();
        }
      }
    }
    this.currTile2 = tiletype;
    return distance;
  } // getEdgeDistance

  /** `dist_from_wall_forward` */
  distFromWallForward(tiletype) {
    if (tiletype === TILE.GATE && !this.canBumpIntoGate()) {
      return -1;
    }
    this.collTileLeftXpos = X_BUMP[this.tileCol+FIRST_ONSCREEN_COLUMN]+TILE_MIDX;
    var type = this.wallType(tiletype);
    if (type === 0) {
      return -1;
    }
    if (this.char.direction < DIR.RIGHT) {
      return this.charXLeftColl-(this.collTileLeftXpos+TILE_RIGHTX-WALL_DIST_FROM_RIGHT[type]);
    }
    return WALL_DIST_FROM_LEFT[type]+this.collTileLeftXpos-this.charXRightColl;
  } // distFromWallForward

  /** `can_bump_into_gate`: a gate is an obstacle until it is open enough */
  canBumpIntoGate() {
    return (this.currModifier() >> 2)+6 < this.charHeight;
  } // canBumpIntoGate

  // ============================================================== collision

  /** `load_frame_to_obj`: where the image of the frame goes */
  loadFrameToObj() {
    var c = this.char;
    this.resetObjClip();
    this.loadFrame();
    this.objDirection = c.direction;
    this.objId = this.curFrame.image;
    this.objChtab = 2+(this.curFrame.sword >> 6);   // chtab 2 is the prince's
    // `obj_x` is a signed 16-bit word: left of the room's edge it is negative
    this.objX = s16((this.charDxForward(this.curFrame.dx) << 1)-116);
    this.objY = (this.curFrame.dy+c.y) & 0xFF;
    if (s8(this.curFrame.flags ^ this.objDirection) >= 0) {
      this.objX = s16(this.objX+1);
    }
  } // loadFrameToObj

  resetObjClip() {
    this.objClipLeft = 0; this.objClipTop = 0; this.objClipRight = 320; this.objClipBottom = 192;
  } // resetObjClip

  /**
   * `set_char_collision`: the box of the character from the image of his
   * frame. The image sizes come from the kid chtab; without it (a headless
   * run without graphics) the sizes of the frame are unknown and 0.
   */
  setCharCollision() {
    var size = this.imageSize ? this.imageSize(this.objChtab, this.objId) : null;
    if (size === null) {
      this.charWidthHalf = 0;
      this.charHeight = 0;
    } else {
      this.charWidthHalf = (size.width+1) >> 1;
      this.charHeight = size.height;
    }
    this.charXLeft = cdiv(this.objX, 2)+58;
    if (this.char.direction >= DIR.RIGHT) {
      this.charXLeft -= this.charWidthHalf;
    }
    this.charXLeftColl = this.charXLeft;
    this.charXRightColl = this.charXRight = this.charXLeft+this.charWidthHalf;
    this.charTopY = this.objY-this.charHeight+1;
    if (this.charTopY >= 192) {
      this.charTopY = 0;
    }
    this.charTopRow = this.yToRowMod4(this.charTopY);
    this.charBottomRow = this.yToRowMod4(this.objY);
    if (this.charBottomRow === -1) {
      this.charBottomRow = 3;
    }
    this.charColLeft = Math.max(this.getTileDivMod(this.charXLeft), 0);
    this.charColRight = Math.min(this.getTileDivMod(this.charXRight), 9);
    if (this.curFrame.flags & FRAME_FLAG.THIN) {
      this.charXLeftColl += 4;
      this.charXRightColl -= 4;
    }
  } // setCharCollision

  /** `check_collisions` */
  checkCollisions() {
    var c = this.char;
    this.bumpColLeftOfWall = this.bumpColRightOfWall = -1;
    if (c.action === ACTION.TURN) {
      return;
    }
    this.collisionRow = c.currRow;
    this.moveCollToPrev();
    this.prevCollisionRow = this.collisionRow;
    this.rightCheckedCol = Math.min(this.getTileDivModM7(this.charXRightColl)+2, 11);
    this.leftCheckedCol = this.getTileDivModM7(this.charXLeftColl)-1;
    this.getRowCollisionData(this.collisionRow, this.currRowCollRoom, this.currRowCollFlags);
    this.getRowCollisionData(this.collisionRow+1, this.belowRowCollRoom, this.belowRowCollFlags);
    this.getRowCollisionData(this.collisionRow-1, this.aboveRowCollRoom, this.aboveRowCollFlags);
    for (var column = 9; column >= 0; column--) {
      if (this.currRowCollRoom[column] >= 0 && this.prevCollRoom[column] === this.currRowCollRoom[column]) {
        if ((this.prevCollFlags[column] & 0x0F) === 0 && (this.currRowCollFlags[column] & 0x0F) !== 0) {
          this.bumpColLeftOfWall = column;
        }
        if ((this.prevCollFlags[column] & 0xF0) === 0 && (this.currRowCollFlags[column] & 0xF0) !== 0) {
          this.bumpColRightOfWall = column;
        }
      }
    }
  } // checkCollisions

  /** `move_coll_to_prev` — without FIX_COLL_FLAGS the flags keep their old values */
  moveCollToPrev() {
    var roomPtr, flagsPtr;
    if (this.collisionRow === this.prevCollisionRow || this.collisionRow+3 === this.prevCollisionRow ||
        this.collisionRow-3 === this.prevCollisionRow) {
      roomPtr = this.currRowCollRoom; flagsPtr = this.currRowCollFlags;
    } else if (this.collisionRow+1 === this.prevCollisionRow || this.collisionRow-2 === this.prevCollisionRow) {
      roomPtr = this.aboveRowCollRoom; flagsPtr = this.aboveRowCollFlags;
    } else {
      roomPtr = this.belowRowCollRoom; flagsPtr = this.belowRowCollFlags;
    }
    for (var column = 0; column < 10; column++) {
      this.prevCollRoom[column] = roomPtr[column];
      this.prevCollFlags[column] = flagsPtr[column];
      this.belowRowCollRoom[column] = -1;
      this.aboveRowCollRoom[column] = -1;
      this.currRowCollRoom[column] = -1;
    }
  } // moveCollToPrev

  /** `get_row_collision_data` */
  getRowCollisionData(row, roomPtr, flagsPtr) {
    var room = this.char.room;
    // ★ a column below -5 read before x_bump[] in the original; clamped here
    this.collTileLeftXpos = X_BUMP[Math.max(0, Math.min(19, this.leftCheckedCol+FIRST_ONSCREEN_COLUMN))]+TILE_MIDX;
    for (var column = this.leftCheckedCol; column <= this.rightCheckedCol; column++) {
      var leftWallXpos = this.getLeftWallXpos(room, column, row);
      var rightWallXpos = this.getRightWallXpos(room, column, row);
      var flags = (leftWallXpos < this.charXRightColl ? 0x0F : 0) | (rightWallXpos > this.charXLeftColl ? 0xF0 : 0);
      flagsPtr[this.tileCol] = flags;
      roomPtr[this.tileCol] = this.currRoom;
      this.collTileLeftXpos += TILE_SIZEX;
    }
  } // getRowCollisionData

  getLeftWallXpos(room, column, row) {
    var type = this.wallType(this.getTile(room, column, row));
    return type ? WALL_DIST_FROM_LEFT[type]+this.collTileLeftXpos : 0xFF;
  } // getLeftWallXpos

  getRightWallXpos(room, column, row) {
    var type = this.wallType(this.getTile(room, column, row));
    return type ? this.collTileLeftXpos-WALL_DIST_FROM_RIGHT[type]+TILE_RIGHTX : 0;
  } // getRightWallXpos

  /** `check_bumped` — without FIX_TWO_COLL_BUG only one side is checked */
  checkBumped() {
    var c = this.char;
    if (c.action !== ACTION.HANG_CLIMB && c.action !== ACTION.HANG_STRAIGHT &&
        (c.frame < FRAME.CLIMBING_1 || c.frame >= 149)) {
      if (this.bumpColLeftOfWall >= 0) {
        this.checkBumpedLookRight();
      } else if (this.bumpColRightOfWall >= 0) {
        this.checkBumpedLookLeft();
      }
    }
  } // checkBumped

  checkBumpedLookLeft() {
    if ((this.char.sword === SWORD.DRAWN || this.char.direction < DIR.RIGHT) && this.isObstacleAtCol(this.bumpColRightOfWall)) {
      this.bumped(this.getRightWallXpos(this.currRoom, this.tileCol, this.tileRow)-this.charXLeftColl, DIR.RIGHT);
    }
  } // checkBumpedLookLeft

  checkBumpedLookRight() {
    if ((this.char.sword === SWORD.DRAWN || this.char.direction === DIR.RIGHT) && this.isObstacleAtCol(this.bumpColLeftOfWall)) {
      this.bumped(this.getLeftWallXpos(this.currRoom, this.tileCol, this.tileRow)-this.charXRightColl, DIR.LEFT);
    }
  } // checkBumpedLookRight

  /** `is_obstacle_at_col` */
  isObstacleAtCol(tileCol) {
    var tileRow = this.char.currRow;
    if (tileRow < 0) {
      tileRow += 3;
    }
    if (tileRow >= 3) {
      tileRow -= 3;
    }
    this.getTile(this.currRowCollRoom[tileCol], tileCol, tileRow);
    return this.isObstacle();
  } // isObstacleAtCol

  /** `is_obstacle` */
  isObstacle() {
    var c = this.char;
    if (this.currTile2 === TILE.POTION) {
      return false;
    } else if (this.currTile2 === TILE.GATE) {
      if (!this.canBumpIntoGate()) return false;
    } else if (this.currTile2 === TILE.CHOMPER) {
      if (this.currModifier() !== 2) return false;
    } else if (this.currTile2 === TILE.MIRROR && c.charId === CHARID.KID &&
               c.frame >= FRAME.START_RUN_JUMP_6 && c.frame < FRAME.RUNNING_JUMP_5 && c.direction < DIR.RIGHT) {
      this.setCurrModifier(0x56);   // through the mirror
      this.jumpedThroughMirror = -1;
      return false;
    }
    this.collTileLeftXpos = this.xposInDrawnRoom(X_BUMP[this.tileCol+FIRST_ONSCREEN_COLUMN])+TILE_MIDX;
    return true;
  } // isObstacle

  /** `xpos_in_drawn_room` */
  xposInDrawnRoom(xpos) {
    if (this.currRoom !== this.drawnRoom) {
      if (this.currRoom === this.roomL || this.currRoom === this.roomBL) {
        xpos -= TILE_SIZEX*10;
      } else if (this.currRoom === this.roomR || this.currRoom === this.roomBR) {
        xpos += TILE_SIZEX*10;
      }
    }
    return xpos;
  } // xposInDrawnRoom

  /** `bumped` */
  bumped(deltaX, pushDirection) {
    var c = this.char;
    if (c.alive < 0 && c.frame !== FRAME.SPIKED) {
      c.x = (c.x+deltaX) & 0xFF;
      if (pushDirection < DIR.RIGHT) {
        if (this.currTile2 === TILE.WALL) {
          this.getTile(this.currRoom, --this.tileCol, this.tileRow);
        }
      } else {
        if (this.currTile2 === TILE.DOORTOP || this.currTile2 === TILE.DOORTOP_WITH_FLOOR || this.currTile2 === TILE.WALL) {
          this.tileCol++;
          if (this.currRoom === 0 && this.tileCol === 10) {
            this.currRoom = c.room;
            this.tileCol = 0;
          }
          this.getTile(this.currRoom, this.tileCol, this.tileRow);
        }
      }
      if (tileIsFloor(this.currTile2)) {
        this.bumpedFloor(pushDirection);
      } else {
        this.bumpedFall();
      }
    }
  } // bumped

  /** `bumped_fall` */
  bumpedFall() {
    var c = this.char;
    var action = c.action;
    c.x = this.charDxForward(-4) & 0xFF;
    if (action === ACTION.IN_FREEFALL) {
      c.fallX = 0;
    } else {
      this.seqtblOffsetChar(SEQ.BUMPFALL);
      this.playSeq();
    }
    this.bumpedSound();
  } // bumpedFall

  /** `bumped_floor` */
  bumpedFloor(pushDirection) {
    var c = this.char;
    if (c.sword !== SWORD.DRAWN && u16(Y_LAND[c.currRow+1]-c.y) >= 15) {
      this.bumpedFall();
    } else {
      c.y = Y_LAND[c.currRow+1] & 0xFF;
      if (c.fallY >= 22) {
        c.x = this.charDxForward(-5) & 0xFF;
      } else {
        c.fallY = 0;
        if (c.alive) {
          var seqIndex;
          if (c.sword === SWORD.DRAWN) {
            if (pushDirection === c.direction) {
              this.seqtblOffsetChar(SEQ.BUMP_FORWARD_WITH_SWORD);
              this.playSeq();
              c.x = this.charDxForward(1) & 0xFF;
              return;
            }
            seqIndex = SEQ.PUSHED_BACK_WITH_SWORD;
          } else {
            var frame = c.frame;
            if (frame === 24 || frame === 25 || (frame >= 40 && frame < 43) || (frame >= FRAME.START_FALL_1 && frame < 107)) {
              seqIndex = SEQ.HARDBUMP;
            } else {
              seqIndex = SEQ.BUMP;
            }
          }
          this.seqtblOffsetChar(seqIndex);
          this.playSeq();
          this.bumpedSound();
        }
      }
    }
  } // bumpedFloor

  bumpedSound() {
    this.isGuardNotice = 1;
    this.playSound(8);
  } // bumpedSound

  clearCollRooms() {
    this.prevCollRoom.fill(-1); this.currRowCollRoom.fill(-1); this.belowRowCollRoom.fill(-1); this.aboveRowCollRoom.fill(-1);
    this.prevCollisionRow = -1;
  } // clearCollRooms

  /** `check_gate_push`: a closing gate pushes the prince aside */
  checkGatePush() {
    var c = this.char;
    var frame = c.frame;
    if (c.action === ACTION.TURN || frame === FRAME.STAND || (frame >= FRAME.FALL_LAND_2 && frame < 111)) {
      this.getTileAtChar();
      var origCol = this.tileCol;
      if ((this.currTile2 === TILE.GATE || this.getTile(this.currRoom, --this.tileCol, this.tileRow) === TILE.GATE) &&
          (this.currRowCollFlags[this.tileCol & 0xFF] & this.prevCollFlags[this.tileCol & 0xFF]) === 0xFF &&
          this.canBumpIntoGate()) {
        this.bumpedSound();
        c.x = (c.x+5-(origCol <= this.tileCol ? 10 : 0)) & 0xFF;
      }
    }
  } // checkGatePush

  /** `bump_into_opponent` (P5: no opponent yet) */
  bumpIntoOpponent() {
  } // bumpIntoOpponent

  // ================================================================ actions

  /** `check_action` */
  checkAction() {
    var c = this.char;
    var action = c.action, frame = c.frame;
    if (action === ACTION.HANG_STRAIGHT || action === ACTION.BUMPED) {
      if (frame === FRAME.CROUCH) {
        this.checkOnFloor();
      }
    } else if (action === ACTION.IN_FREEFALL) {
      this.doFall();
    } else if (action === ACTION.IN_MIDAIR) {
      if (frame >= FRAME.START_FALL_1 && frame < FRAME.FALL) {
        this.checkGrab();
      }
    } else if (action !== ACTION.HANG_CLIMB) {
      this.checkOnFloor();
    }
  } // checkAction

  /** `check_on_floor` */
  checkOnFloor() {
    var c = this.char;
    if (this.curFrame.flags & FRAME_FLAG.NEEDS_FLOOR) {
      if (this.getTileAtChar() === TILE.WALL) {
        this.inWall();
      }
      if (!tileIsFloor(this.currTile2)) {
        if (this.levelNumber === 12 && this.unitedWithShadow < 0 && c.currRow === 0 &&
            (c.room === 2 || (c.room === 13 && this.tileCol >= 6))) {
          // level 12: floors appear under the prince
          this.setCurrTile(TILE.FLOOR);
          this.currTilepos++;
        } else {
          this.startFall();
        }
      }
    }
  } // checkOnFloor

  /** `start_fall` */
  startFall() {
    var c = this.char;
    var frame = c.frame;
    var seqId;
    c.sword = SWORD.SHEATHED;
    c.currRow++;
    this.startChompers();
    this.fallFrame = frame;
    if (frame === FRAME.RUN_9) {
      seqId = SEQ.FALL;
    } else if (frame === FRAME.RUN_13) {
      seqId = SEQ.FALL_19;
    } else if (frame === FRAME.STANDING_JUMP_11) {
      seqId = SEQ.FALL_AFTER_STANDING_JUMP;
    } else if (frame === FRAME.RUNNING_JUMP_5) {
      seqId = SEQ.FALL_AFTER_RUNNING_JUMP;
    } else if (frame >= FRAME.HANGDROP_1 && frame < 86) {
      seqId = SEQ.FALL_19;
      c.x = this.charDxForward(5) & 0xFF;
      this.loadFramDetCol();
    } else if (frame >= 150 && frame < 180) {
      if (c.charId === CHARID.GUARD) {
        if (c.currRow === 3 && c.currCol === 10) {
          this.clearChar();
          return;
        }
        if (c.fallX < 0) {
          seqId = SEQ.GUARD_PUSHED_OFF_LEDGE;
          if (c.direction < DIR.RIGHT && this.distanceToEdgeWeight() <= 7) {
            c.x = this.charDxForward(-5) & 0xFF;
          }
        } else {
          this.droppedout = 0;
          seqId = SEQ.GUARD_FALL;
        }
      } else {
        this.droppedout = 1;
        if (c.direction < DIR.RIGHT && this.distanceToEdgeWeight() <= 7) {
          c.x = this.charDxForward(-5) & 0xFF;
        }
        seqId = SEQ.KID_PUSHED_OFF_LEDGE;
      }
    } else {
      seqId = SEQ.FALL;
    }
    this.seqtblOffsetChar(seqId);
    this.playSeq();
    this.loadFramDetCol();
    if (this.getTileAtChar() === TILE.WALL) {
      this.inWall();
      return;
    }
    if (this.getTileInfrontofChar() === TILE.WALL) {
      if (this.fallFrame !== 44 || this.distanceToEdgeWeight() >= 6) {
        c.x = this.charDxForward(-1) & 0xFF;
      } else {
        this.seqtblOffsetChar(SEQ.START_FALL_IN_FRONT_OF_WALL);
        this.playSeq();
      }
      this.loadFramDetCol();
    }
  } // startFall

  /** `in_wall`: pushed out of a wall */
  inWall() {
    var deltaX = this.distanceToEdgeWeight();
    if (deltaX >= 8 || this.getTileInfrontofChar() === TILE.WALL) {
      deltaX = 6-deltaX;
    } else {
      deltaX += 4;
    }
    this.char.x = this.charDxForward(deltaX) & 0xFF;
    this.loadFramDetCol();
    this.getTileAtChar();
  } // inWall

  /** `fall_accel` */
  fallAccel() {
    var c = this.char;
    if (c.action === ACTION.IN_FREEFALL) {
      if (this.isFeatherFall) {
        c.fallY = s8(c.fallY+FALLING_SPEED_ACCEL_FEATHER);
        if (c.fallY > FALLING_SPEED_MAX_FEATHER) c.fallY = FALLING_SPEED_MAX_FEATHER;
      } else {
        c.fallY = s8(c.fallY+FALLING_SPEED_ACCEL);
        if (c.fallY > FALLING_SPEED_MAX) c.fallY = FALLING_SPEED_MAX;
      }
    }
  } // fallAccel

  /** `fall_speed` */
  fallSpeed() {
    var c = this.char;
    c.y = (c.y+c.fallY) & 0xFF;
    if (c.action === ACTION.IN_FREEFALL) {
      c.x = this.charDxForward(c.fallX) & 0xFF;
      this.loadFramDetCol();
    }
  } // fallSpeed

  /** `do_fall` */
  doFall() {
    var c = this.char;
    if (this.isScreaming === 0 && c.fallY >= 31) {
      this.playSound(1);
      this.isScreaming = 1;
    }
    if (u16(Y_LAND[c.currRow+1]) > u16(c.y)) {
      this.checkGrab();
    } else {
      if (this.getTileAtChar() === TILE.WALL) {
        this.inWall();
      }
      if (tileIsFloor(this.currTile2)) {
        this.land();
      } else {
        c.currRow++;
      }
    }
  } // doFall

  /** `land` */
  land() {
    var c = this.char;
    var seqId;
    this.isScreaming = 0;
    c.y = Y_LAND[c.currRow+1] & 0xFF;
    var onSpikes = false;
    if (this.getTileAtChar() !== TILE.SPIKE) {
      if (!tileIsFloor(this.getTileInfrontofChar()) && this.distanceToEdgeWeight() < 3) {
        c.x = this.charDxForward(-3) & 0xFF;
      }
      this.startChompers();
    } else {
      onSpikes = true;
    }
    var dead = false;
    // landing on spikes jumps into the "alive" branch even when dead (the original's goto)
    if (c.alive < 0 || onSpikes) {
      if (onSpikes ||
          (this.distanceToEdgeWeight() >= 12 && this.getTileBehindChar() === TILE.SPIKE) ||
          this.getTileAtChar() === TILE.SPIKE) {
        if (this.isSpikeHarmful()) {
          this.spiked();
          return;
        }
      }
      if (c.fallY < 22) {
        // one row
        if (c.charId >= CHARID.GUARD || c.sword === SWORD.DRAWN) {
          c.sword = SWORD.DRAWN;
          seqId = SEQ.GUARD_ACTIVE_AFTER_FALL;
        } else {
          seqId = SEQ.SOFT_LAND;
        }
        if (c.charId === CHARID.KID) {
          this.playSound(17);
          this.isGuardNotice = 1;
        }
      } else if (c.fallY < 33) {
        // two rows
        if (c.charId === CHARID.SHADOW) {
          c.sword = SWORD.DRAWN;
          seqId = SEQ.GUARD_ACTIVE_AFTER_FALL;
        } else if (c.charId === CHARID.GUARD) {
          dead = true;
        } else if (!this.takeHp(1)) {
          this.playSound(16);
          this.isGuardNotice = 1;
          seqId = SEQ.MEDIUM_LAND;
        } else {
          this.playSound(0);
          seqId = SEQ.CRUSHED;
        }
      } else {
        dead = true;
      }
    } else {
      dead = true;
    }
    if (dead) {
      this.takeHp(100);
      this.playSound(0);
      seqId = SEQ.CRUSHED;
    }
    this.seqtblOffsetChar(seqId);
    this.playSeq();
    c.fallY = 0;
  } // land

  /** `spiked` */
  spiked() {
    var c = this.char;
    this.setCurrModifier(0xFF);
    c.y = Y_LAND[c.currRow+1] & 0xFF;
    c.x = (X_BUMP[this.tileCol+FIRST_ONSCREEN_COLUMN]+10) & 0xFF;
    c.x = this.charDxForward(8) & 0xFF;
    c.fallY = 0;
    this.playSound(48);
    this.takeHp(100);
    this.seqtblOffsetChar(SEQ.SPIKED);
    this.playSeq();
  } // spiked

  /** `is_spike_harmful` */
  isSpikeHarmful() {
    var modifier = s8(this.currModifier());
    if (modifier === 0 || modifier === -1) {
      return 0;
    } else if (modifier < 0) {
      return 1;
    } else if (modifier < 5) {
      return 2;
    }
    return 0;
  } // isSpikeHarmful

  /** `check_grab`: Shift while falling grabs a ledge */
  checkGrab() {
    var c = this.char;
    if (this.controlShift === CONTROL.HELD && c.fallY < 32 && c.alive < 0 &&
        u16(Y_LAND[c.currRow+1]) <= u16(c.y+25)) {
      var oldX = c.x;
      c.x = this.charDxForward(-8) & 0xFF;
      this.loadFramDetCol();
      if (!this.canGrabFrontAbove()) {
        c.x = oldX;
      } else {
        c.x = this.charDxForward(this.distanceToEdgeWeight()) & 0xFF;
        c.y = Y_LAND[c.currRow+1] & 0xFF;
        c.fallY = 0;
        this.seqtblOffsetChar(SEQ.GRAB_LEDGE_MIDAIR);
        this.playSeq();
        this.grabTimer = 12;
        this.playSound(9);
        this.isScreaming = 0;
      }
    }
  } // checkGrab

  canGrabFrontAbove() {
    this.throughTile = this.getTileAboveChar();
    this.getTileFrontAboveChar();
    return this.canGrab();
  } // canGrabFrontAbove

  /** `check_spiked` */
  checkSpiked() {
    var c = this.char;
    var frame = c.frame;
    if (this.getTile(c.room, c.currCol, c.currRow) === TILE.SPIKE) {
      var harmful = this.isSpikeHarmful();
      if ((harmful >= 2 && ((frame >= FRAME.RUN_7 && frame < 15) || (frame >= FRAME.START_RUN_JUMP_1 && frame < 40))) ||
          ((frame === FRAME.RUNNING_JUMP_4 || frame === FRAME.STANDING_JUMP_11) && harmful !== 0)) {
        this.spiked();
      }
    }
  } // checkSpiked

  /** `check_chomped_kid` */
  checkChompedKid() {
    var c = this.char;
    for (var col = 0; col < 10; col++) {
      if (this.currRowCollFlags[col] === 0xFF &&
          this.getTile(this.currRowCollRoom[col], col, c.currRow) === TILE.CHOMPER &&
          (this.currModifier() & 0x7F) === 2) {
        this.chomped();
      }
    }
  } // checkChompedKid

  /** `chomped` */
  chomped() {
    var c = this.char;
    this.setCurrModifier(this.currModifier() | 0x80);
    if (c.frame !== FRAME.CHOMPED && c.room === this.currRoom) {
      c.x = (X_BUMP[this.tileCol+FIRST_ONSCREEN_COLUMN]+TILE_MIDX) & 0xFF;
      c.x = this.charDxForward(7-(c.direction === 0 ? 1 : 0)) & 0xFF;
      c.y = Y_LAND[c.currRow+1] & 0xFF;
      this.takeHp(100);
      this.playSound(46);
      this.seqtblOffsetChar(SEQ.CHOMPED);
      this.playSeq();
    }
  } // chomped

  /** `check_press`: buttons and loose floors under the prince */
  checkPress() {
    var c = this.char;
    var frame = c.frame, action = c.action;
    if ((frame >= FRAME.HANGING_1 && frame < 100) || (frame >= FRAME.CLIMBING_1 && frame < FRAME.CLIMBING_7)) {
      this.getTileAboveChar();
    } else if (action === ACTION.TURN || action === ACTION.BUMPED || action < ACTION.HANG_CLIMB) {
      if (frame === FRAME.JUMPHANG_79 && this.getTileAboveChar() === TILE.LOOSE) {
        this.makeLooseFall(1);
      } else {
        if (!(this.curFrame.flags & FRAME_FLAG.NEEDS_FLOOR)) return;
        this.getTileAtChar();
      }
    } else {
      return;
    }
    if (this.currTile2 === TILE.OPENER || this.currTile2 === TILE.CLOSER) {
      if (c.alive < 0) {
        this.triggerButton(1, 0, -1);
      } else {
        this.diedOnButton();
      }
    } else if (this.currTile2 === TILE.LOOSE) {
      this.isGuardNotice = 1;
      this.makeLooseFall(1);
    }
  } // checkPress

  /** `check_spike_below` */
  checkSpikeBelow() {
    var c = this.char;
    var rightCol = this.getTileDivModM7(this.charXRight);
    if (rightCol < 0) return;
    var room = c.room;
    for (var col = this.getTileDivModM7(this.charXLeft); col <= rightCol; col++) {
      var row = c.currRow;
      var notFinished;
      do {
        notFinished = false;
        if (this.getTile(room, col, row) === TILE.SPIKE) {
          this.startAnimSpike(this.currRoom, this.currTilepos);
        } else if (!tileIsFloor(this.currTile2) && this.currRoom !== 0 && room === this.currRoom) {
          row++;
          notFinished = true;
        }
      } while (notFinished);
    }
  } // checkSpikeBelow

  /** `check_knock` */
  checkKnock() {
    if (this.knock) {
      this.doKnock(this.char.room, this.char.currRow-(this.knock > 0 ? 1 : 0));
      this.knock = 0;
    }
  } // checkKnock

  /** `take_hp` */
  takeHp(count) {
    var dead = false;
    if (this.char.charId === CHARID.KID) {
      if (count >= this.hitpCurr) {
        this.hitpDelta = -this.hitpCurr;
        dead = true;
      } else {
        this.hitpDelta = -count;
      }
    } else {
      if (count >= this.guardhpCurr) {
        this.guardhpDelta = -this.guardhpCurr;
        dead = true;
      } else {
        this.guardhpDelta = -count;
      }
    }
    return dead;
  } // takeHp

  /** `do_delta_hp` */
  doDeltaHp() {
    this.hitpCurr = Math.min(Math.max(this.hitpCurr+this.hitpDelta, 0), this.hitpMax);
    this.guardhpCurr = Math.min(Math.max(this.guardhpCurr+this.guardhpDelta, 0), this.guardhpMax);
  } // doDeltaHp

  /** `is_dead` */
  isDead() {
    var frame = this.char.frame;
    return frame >= FRAME.SPIKED && (frame <= FRAME.CHOMPED || frame === FRAME.DEAD);
  } // isDead

  clearChar() {
    this.char.direction = DIR.NONE;
    this.char.alive = 0;
    this.char.action = 0;
    this.guardhpCurr = 0;
  } // clearChar

  /** `do_pickup` */
  doPickup(objType) {
    this.pickupObjType = objType;
    this.controlShift2 = CONTROL.IGNORE;
    this.setCurrTile(TILE.FLOOR);
    this.setCurrModifier(0);
  } // doPickup

  /** `proc_get_object`: the potions and the sword */
  procGetObject() {
    if (this.char.charId !== CHARID.KID || this.pickupObjType === 0) return;
    if (this.pickupObjType === -1) {
      this.haveSword = true;
      this.playSound(37);
      this.flashColor = 14; this.flashTime = 8;
    } else {
      switch (this.pickupObjType) {
        case 1:
          if (this.hitpCurr !== this.hitpMax) {
            this.playSound(33);
            this.hitpDelta = 1;
            this.flashColor = 4; this.flashTime = 2;
          }
          break;
        case 2:
          this.playSound(30);
          this.flashColor = 4; this.flashTime = 4;
          this.hitpMax = Math.min(this.hitpMax+1, 10);
          this.hitpDelta = this.hitpMax-this.hitpCurr;
          break;
        case 3:
          this.isFeatherFall = 1;
          this.playSound(39);
          break;
        case 4:
          this.upsideDown = this.upsideDown ? 0 : 1;
          break;
        case 6:
          this.getTile(8, 0, 0);
          this.triggerButton(0, 0, -1);
          break;
        case 5:
          this.playSound(13);
          this.hitpDelta = this.levelNumber === 15 ? -((this.hitpMax+1) >> 1) : -1;
          break;
      }
    }
  } // procGetObject

  // ================================================================== rooms

  /** `exit_room`: does the prince leave the room this frame? */
  exitRoom() {
    if (this.exitRoomTimer !== 0) {
      this.exitRoomTimer--;
      return;
    }
    this.loadFrameToObj();
    this.setCharCollision();
    this.roomleaveResult = this.leaveRoom();
    if (this.roomleaveResult < 0) {
      return;
    }
    this.nextRoom = this.char.room;
    // the guard follows or stays (P5)
  } // exitRoom

  /** `leave_room` */
  leaveRoom() {
    var c = this.char;
    var chary = c.y;
    var action = c.action, frame = c.frame;
    var leaveDir;
    if (action !== ACTION.BUMPED && action !== ACTION.IN_FREEFALL && action !== ACTION.IN_MIDAIR &&
        s8(chary) < 10 && s8(chary) > -16) {
      leaveDir = 2;
    } else if (chary >= 211) {
      leaveDir = 3;
    } else if ((frame >= FRAME.CLIMBING_1 && frame < 150) ||
               (frame >= FRAME.STAND_UP_FROM_CROUCH_1 && frame < 120) ||
               (frame >= FRAME.PARRY_150 && frame < 163) ||
               (frame >= FRAME.STAND_INACTIVE && frame < 169) ||
               action === ACTION.TURN) {
      return -1;
    } else if (c.direction !== DIR.RIGHT) {
      if (this.charXLeft <= 54) {
        leaveDir = 0;
      } else if (this.charXLeft >= 198) {
        leaveDir = 1;
      } else {
        return -1;
      }
    } else {
      this.getTile(c.room, 9, c.currRow);
      if (this.currTile2 !== TILE.DOORTOP_WITH_FLOOR && this.currTile2 !== TILE.DOORTOP && this.charXRight >= 201) {
        leaveDir = 1;
      } else if (this.charXRight <= 57) {
        leaveDir = 0;
      } else {
        return -1;
      }
    }
    if (leaveDir === 3 && this.levelNumber === 6 && c.room === 1) {
      return -2;   // level 6: the falling exit
    }
    this.gotoOtherRoom(leaveDir);
    return leaveDir;
  } // leaveRoom

  /** `goto_other_room` */
  gotoOtherRoom(direction) {
    var c = this.char;
    var link = c.room ? this.level.roomlinks[c.room-1] : {left: 0, right: 0, up: 0, down: 0};
    var oppositeDir;
    if (direction === 0) {
      c.room = link.left;
      c.x = (c.x+140) & 0xFF;
      oppositeDir = 1;
    } else if (direction === 1) {
      c.room = link.right;
      c.x = (c.x-140) & 0xFF;
      oppositeDir = 0;
    } else if (direction === 2) {
      c.room = link.up;
      c.y = (c.y+189) & 0xFF;
      c.currRow = this.yToRowMod4(c.y);
      oppositeDir = 3;
    } else {
      c.room = link.down;
      c.y = (c.y-189) & 0xFF;
      c.currRow = this.yToRowMod4(c.y);
      oppositeDir = 2;
    }
    return oppositeDir;
  } // gotoOtherRoom

  /** `check_the_end`: a new room to show */
  checkTheEnd() {
    if (this.nextRoom !== 0 && this.nextRoom !== this.drawnRoom) {
      this.drawnRoom = this.nextRoom;
      this.loadRoomLinks();
      if (this.levelNumber === 14 && this.drawnRoom === 5) {
        this.endSequence();   // the princess is reached
      }
      this.differentRoom = true;
      this.animTileModif();
      this.startChompers();
      this.checkFallFlo();
      this.checkShadow();
    }
  } // checkTheEnd

  /** `load_room_links` — addresses the drawn room too (`get_room_address`) */
  loadRoomLinks() {
    var links = this.level.roomlinks;
    this.roomBR = 0; this.roomBL = 0; this.roomAR = 0; this.roomAL = 0;
    if (this.drawnRoom) {
      this.getRoomAddress(this.drawnRoom);
      var link = links[this.drawnRoom-1];
      this.roomL = link.left; this.roomR = link.right; this.roomA = link.up; this.roomB = link.down;
      if (this.roomA) {
        this.roomAL = links[this.roomA-1].left; this.roomAR = links[this.roomA-1].right;
      } else {
        if (this.roomL) this.roomAL = links[this.roomL-1].up;
        if (this.roomR) this.roomAR = links[this.roomR-1].up;
      }
      if (this.roomB) {
        this.roomBL = links[this.roomB-1].left; this.roomBR = links[this.roomB-1].right;
      } else {
        if (this.roomL) this.roomBL = links[this.roomL-1].down;
        if (this.roomR) this.roomBR = links[this.roomR-1].down;
      }
    } else {
      this.roomB = this.roomA = this.roomR = this.roomL = 0;
    }
  } // loadRoomLinks

  /**
   * The redraw after a room change was done: the room-leaving check waits
   * two frames (`redraw_screen` sets `exit_room_timer = 2`).
   */
  roomDrawn() {
    this.differentRoom = false;
    this.exitRoomTimer = 2;
  } // roomDrawn

  // ============================================================ for drawing

  /**
   * Where and how the prince is drawn this frame (`add_kid_to_objtable`,
   * `draw_objtable_item`, `draw_mid`): image number of the kid chtab
   * (1-based), screen x of the left edge, bottom y, flipped when facing
   * right, and the clip box.
   * @returns {Object|null} `{image, x, yBottom, flip, clip:{left,right,top,bottom}}`, null when not in the drawn room.
   */
  kidObject() {
    var c = this.char;
    if (c.room === 0 || c.room !== this.drawnRoom) {
      return null;
    }
    this.loadFramDetCol();
    this.loadFrameToObj();
    var yOffset = this.getTileAtChar() === TILE.STUCK ? 1 : 0;   // stuck_lower
    var savedY = c.y;
    c.y = (c.y+yOffset) & 0xFF;
    this.objY = (this.objY+yOffset) & 0xFF;
    this.setCharCollision();
    this.clipChar();
    c.y = savedY;
    var tilepos = this.objtileAtChar();
    var redraw = this.redrawAtChar2();
    if (this.objId === 0xFF) {
      return null;
    }
    var screenX = cdiv(this.objX*320, 280);   // `calc_screen_x_coord`
    return {
      chtab: this.objChtab, image: this.objId+1, x: screenX, yBottom: this.objY,
      flip: this.objDirection === DIR.RIGHT,
      clip: {left: this.objClipLeft, right: this.objClipRight, top: this.objClipTop, bottom: this.objClipBottom},
      tilepos: tilepos, overlays: redraw.overlays, aboveColumns: redraw.aboveColumns
    };
  } // kidObject

  /** `get_tilepos`: a tile position, negative for the row above, 30 for outside */
  getTilepos(tileCol, tileRow) {
    if (tileRow < 0) {
      return -(tileCol+1);
    }
    if (tileRow >= 3 || tileCol >= 10 || tileCol < 0) {
      return 30;
    }
    return TBL_LINE[tileRow]+tileCol;
  } // getTilepos

  /**
   * `set_objtile_at_char` (+ `get_tilepos_nominus`): the tile the prince is
   * drawn "at" — the room is redrawn tile by tile and he goes in when his
   * tile's turn comes, so what is drawn for later tiles covers him.
   * @returns {number} 0..29, or 30 for outside (drawn before everything).
   */
  objtileAtChar() {
    var c = this.char;
    var tileRow, tileCol;
    if (c.action === ACTION.RUN_JUMP) {
      tileRow = this.charBottomRow;
      tileCol = this.charColLeft;
    } else {
      tileRow = c.currRow;
      tileCol = c.currCol;
    }
    if ((c.frame >= FRAME.CLIMBING_1 && c.frame < 149) || c.action === ACTION.HANG_CLIMB ||
        c.action === ACTION.IN_MIDAIR || c.action === ACTION.IN_FREEFALL || c.action === ACTION.HANG_STRAIGHT) {
      tileCol--;
    }
    var tilepos = this.getTilepos(tileCol, tileRow);
    return tilepos < 0 ? 30 : tilepos;
  } // objtileAtChar

  /**
   * `redraw_at_char2`: while the prince hangs, falls or climbs, the tiles
   * of his columns are drawn once more in the middle layer, over him
   * (`draw_other_overlay`), and while he climbs onto a floor its left edge
   * goes over him too (`draw_floor_overlay`). Which tiles and which kind.
   * @returns {{overlays: Object[], aboveColumns: number[]}} `{tilepos, kind}`
   *          with kind 'floor' or 'other'; the columns of the row above the
   *          room whose strip is drawn in front as well (`redraw_frames_above`).
   */
  redrawAtChar2() {
    var c = this.char;
    var action = c.action, frame = c.frame;
    var kind = 'other';
    var out = {overlays: [], aboveColumns: []};
    if (frame < FRAME.JUMPHANG_78 || frame >= FRAME.JUMPHANG_80) {
      if (frame >= FRAME.CLIMBING_3 && frame < FRAME.CLIMBING_11) {
        kind = 'floor';
      } else if (action !== ACTION.HANG_CLIMB && action !== ACTION.IN_MIDAIR &&
                 action !== ACTION.IN_FREEFALL && action !== ACTION.HANG_STRAIGHT &&
                 (action !== ACTION.BUMPED || frame < FRAME.START_FALL_1 || frame > FRAME.FALL)) {
        return out;
      }
    }
    var self = this;
    var mark = function(tilepos) {
      if (tilepos >= 30) return;
      if (tilepos < 0) {
        out.aboveColumns.push(-tilepos-1);
      } else {
        out.overlays.push({tilepos: tilepos, kind: kind});
      }
    };
    for (var tileCol = this.charColRight; tileCol >= this.charColLeft; tileCol--) {
      if (action !== ACTION.HANG_CLIMB) {
        mark(self.getTilepos(tileCol, this.charBottomRow));
      }
      if (this.charTopRow !== this.charBottomRow) {
        mark(self.getTilepos(tileCol, this.charTopRow));
      }
    }
    return out;
  } // redrawAtChar2

  /** `clip_char`: the prince behind walls and floors */
  clipChar() {
    var c = this.char;
    var frame = c.frame, action = c.action, room = c.room, row = c.currRow;
    this.resetObjClip();
    if (frame >= FRAME.EXIT_STAIRS_8 && frame < 229) {
      this.objClipTop = this.leveldoorYBottom+1;
      this.objClipRight = this.leveldoorRight;
      return;
    }
    if (this.getTile(room, this.charColLeft, this.charTopRow) === TILE.WALL || tileIsFloor(this.currTile2)) {
      if ((action === ACTION.STAND && (frame === FRAME.JUMPHANG_79 || frame === FRAME.HANGDROP_1)) ||
          this.getTile(room, this.charColRight, this.charTopRow) === TILE.WALL || tileIsFloor(this.currTile2)) {
        var clipRow = row+1;
        var clipY = Y_CLIP[clipRow];
        if (clipRow === 1 || (clipY < this.objY && clipY-15 < this.charTopY)) {
          this.objClipTop = this.charTopY = clipY;
        }
      }
    }
    var col = this.getTileDivMod(this.charXLeftColl-4);
    if (this.getTile(room, col+1, row) === TILE.DOORTOP_WITH_FLOOR || this.currTile2 === TILE.DOORTOP) {
      this.objClipRight = (this.tileCol << 5)+32;
    } else {
      if ((this.getTile(room, col, row) !== TILE.DOORTOP_WITH_FLOOR && this.currTile2 !== TILE.DOORTOP) ||
          action === ACTION.IN_MIDAIR ||
          (action === ACTION.IN_FREEFALL && frame === FRAME.FALL) ||
          (action === ACTION.BUMPED && frame === FRAME.FALL_LAND_1) ||
          (c.direction < DIR.RIGHT && (action === ACTION.HANG_CLIMB || action === ACTION.HANG_STRAIGHT ||
            (action === ACTION.RUN_JUMP && frame >= FRAME.CLIMBING_3 && frame < FRAME.CLIMBING_6)))) {
        col = this.getTileDivMod(this.charXRightColl);
        if ((this.getTile(room, col, row) === TILE.WALL || (this.currTile2 === TILE.MIRROR && c.direction === DIR.RIGHT)) &&
            (this.getTile(room, col, this.charTopRow) === TILE.WALL || this.currTile2 === TILE.MIRROR) &&
            room === this.currRoom) {
          this.objClipRight = this.tileCol << 5;
        }
      } else {
        this.objClipRight = (this.tileCol << 5)+32;
      }
    }
  } // clipChar

  // ====================================================== hooks: P4, P5, P6

  /**
   * `play_sound`: sound `index` asked for this frame. The scheduler keeps
   * the loudest; `sounds` lists every request for the tools.
   */
  playSound(index) {
    this.sounds.push(index);
    this.scheduler.request(index);
  } // playSound

  /**
   * `check_sound_playing`: whether the sound that won a frame still plays,
   * by its length in frames — the level 1 crouch, the feather fall and the
   * end of a level wait for it.
   */
  checkSoundPlaying() {
    return this.scheduler.playing();
  } // checkSoundPlaying

  /** `stop_sounds` */
  stopSounds() {
    this.scheduler.stop();
  } // stopSounds

  /**
   * `play_next_sound`, at the end of the frame: what the owner is to play.
   * @returns {{start, stop, loop}|null}
   */
  playNextSound() {
    return this.scheduler.playNext();
  } // playNextSound

  // ======================================================= trobs (seg007.c)
  //
  // A trob is a tile that is being animated: `{tilepos, room, type}`. Every
  // frame `processTrobs()` steps each of them once and drops those whose
  // type went negative. What the type means depends on the tile (a gate:
  // 0 closing, 1 open, 2 open for good, 3..8 slamming shut; a loose floor:
  // 0 about to fall, 1 shaking). The code works on `this.trob` and on a
  // copy of the tile's modifier, `this.trobMod`, written back at the end
  // the way `animate_tile` writes `curr_modifier` back — into the room that
  // is addressed at that moment, which the level-4 mirror may have changed.

  /** `process_trobs` */
  processTrobs() {
    if (this.trobs.length === 0) {
      return;
    }
    var needDelete = false;
    for (var index = 0; index < this.trobs.length; index++) {
      this.trob = this.trobs[index];
      this.animateTile();
      if (this.trob.type < 0) {
        needDelete = true;
      }
    }
    if (needDelete) {
      this.trobs = this.trobs.filter(function(trob) { return trob.type >= 0; });
    }
  } // processTrobs

  /** `animate_tile` */
  animateTile() {
    var trob = this.trob;
    this.getRoomAddress(trob.room);
    this.trobMod = this.modAt(trob.tilepos);
    switch (this.tileAt(trob.tilepos)) {
      case TILE.TORCH:
      case TILE.TORCH_WITH_DEBRIS:
        this.animateTorch();
        break;
      case TILE.CLOSER:
      case TILE.OPENER:
        this.animateButton();
        break;
      case TILE.SPIKE:
        this.animateSpike();
        break;
      case TILE.LOOSE:
        this.animateLoose();
        break;
      case TILE.EMPTY:
        trob.type = -1;   // animate_empty
        break;
      case TILE.CHOMPER:
        this.animateChomper();
        break;
      case TILE.GATE:
        this.animateDoor();
        break;
      case TILE.LEVEL_DOOR_LEFT:
        this.animateLeveldoor();
        break;
      case TILE.POTION:
        this.animatePotion();
        break;
      case TILE.SWORD:
        this.animateSword();
        break;
      default:
        trob.type = -1;
        break;
    }
    this.setModAt(trob.tilepos, this.trobMod);
  } // animateTile

  /** `is_trob_in_drawn_room`: a trob out of sight is dropped */
  isTrobInDrawnRoom() {
    if (this.trob.room !== this.drawnRoom) {
      this.trob.type = -1;
      return false;
    }
    return true;
  } // isTrobInDrawnRoom

  /** `animate_torch`: the flames of the room and of the column just left of it */
  animateTorch() {
    var trob = this.trob;
    if (trob.room === this.drawnRoom || (trob.room === this.roomL && trob.tilepos % 10 === 9)) {
      this.trobMod = this.getTorchFrame(this.trobMod);
    } else {
      trob.type = -1;
    }
  } // animateTorch

  /** `get_torch_frame` */
  getTorchFrame(curr) {
    var next = this.random.next(255);
    if (next !== curr) {
      if (next < 9) {
        return next;
      }
      next = curr;
    }
    next++;
    if (next >= 9) {
      next = 0;
    }
    return next;
  } // getTorchFrame

  /** `animate_potion`: the bubbles */
  animatePotion() {
    if (this.trob.type >= 0 && this.isTrobInDrawnRoom()) {
      var type = this.trobMod & 0xF8;
      this.trobMod = this.bubbleNextFrame(this.trobMod & 0x07) | type;
    }
  } // animatePotion

  /** `bubble_next_frame` */
  bubbleNextFrame(curr) {
    var next = curr+1;
    return next >= 8 ? 1 : next;
  } // bubbleNextFrame

  /** `animate_sword`: the sword on the floor glints now and then */
  animateSword() {
    if (this.isTrobInDrawnRoom()) {
      this.trobMod = (this.trobMod-1) & 0xFF;
      if (this.trobMod === 0) {
        this.trobMod = (this.random.next(255) & 0x3F)+0x28;
      }
    }
  } // animateSword

  /** `animate_chomper` */
  animateChomper() {
    var trob = this.trob;
    if (trob.type >= 0) {
      var blood = this.trobMod & 0x80;
      var frame = (this.trobMod & 0x7F)+1;
      if (frame > 15) {
        frame = 1;
      }
      this.trobMod = blood | frame;
      if (frame === 2) {
        this.playSound(47);
      }
      // stops past frame 6 once the prince left the room or the row, or
      // died elsewhere
      if ((trob.room !== this.drawnRoom || cdiv(trob.tilepos, 10) !== this.kid.currRow ||
           (this.kid.alive >= 0 && blood === 0)) && (this.trobMod & 0x7F) >= 6) {
        trob.type = -1;
      }
    }
  } // animateChomper

  /** `animate_spike` */
  animateSpike() {
    if (this.trob.type >= 0) {
      if (this.trobMod === 0xFF) {
        return;   // a disabled spike
      }
      if (this.trobMod & 0x80) {
        this.trobMod = (this.trobMod-1) & 0xFF;
        if (this.trobMod & 0x7F) {
          return;
        }
        this.trobMod = 6;
      } else {
        this.trobMod = (this.trobMod+1) & 0xFF;
        if (this.trobMod === 5) {
          this.trobMod = 0x8F;
        } else if (this.trobMod === 9) {
          this.trobMod = 0;
          this.trob.type = -1;
        }
      }
    }
  } // animateSpike

  /**
   * `animate_door`: a gate. Type 0 closes slowly, 1 opens and then closes
   * again, 2 opens for good, 3..8 slam shut ever faster. The modifier is
   * the openness: 0 closed, 188 fully open, 238 waiting to close, 0xFF
   * open for good.
   */
  animateDoor() {
    var trob = this.trob;
    var animType = trob.type;
    if (animType >= 0) {
      if (animType >= 3) {
        if (animType < 8) {
          animType++;
          trob.type = animType;
        }
        var newMod = this.trobMod-PrinceLogic.GATE_CLOSE_SPEEDS[animType];
        this.trobMod = newMod & 0xFF;
        if (newMod < 0) {
          this.trobMod = 0;
          trob.type = -1;
          this.playSound(6);
        }
      } else if (this.trobMod !== 0xFF) {
        this.trobMod = (this.trobMod+PrinceLogic.DOOR_DELTA[animType]) & 0xFF;
        if (animType === 0) {
          if (this.trobMod !== 0) {
            if (this.trobMod < 188 && (this.trobMod & 3) === 3) {
              this.playDoorSoundIfVisible(4);
            }
          } else {
            this.gateStop();
          }
        } else if (this.trobMod < 188) {
          if ((this.trobMod & 7) === 0) {
            this.playSound(5);
          }
        } else if (animType < 2) {
          this.trobMod = 238;   // stays open a while, then closes
          trob.type = 0;
          this.playSound(7);
        } else {
          this.trobMod = 0xFF;   // open for good
          this.gateStop();
        }
      } else {
        this.gateStop();
      }
    }
  } // animateDoor

  /** `gate_stop` */
  gateStop() {
    this.trob.type = -1;
    this.playDoorSoundIfVisible(7);
  } // gateStop

  /** `play_door_sound_if_visible` — the original's condition, bug included (no FIX_GATE_SOUNDS) */
  playDoorSoundIfVisible(soundId) {
    var tilepos = this.trob.tilepos, gateRoom = this.trob.room;
    var visible = gateRoom === this.roomL ? tilepos % 10 === 9 : (gateRoom === this.drawnRoom && tilepos % 10 !== 9);
    if ((this.levelNumber === 3 && gateRoom === 2) || visible) {
      this.playSound(soundId);
    }
  } // playDoorSoundIfVisible

  /**
   * `animate_leveldoor`: the exit door. Type 0..2 opens (the modifier is
   * how far), 3..6 slams shut with growing speed. When it is open the
   * prince may leave; on level 4 the mirror appears at that moment.
   */
  animateLeveldoor() {
    var trob = this.trob;
    if (trob.type >= 0) {
      if (trob.type >= 3) {
        trob.type++;
        this.trobMod = (this.trobMod-PrinceLogic.LEVELDOOR_CLOSE_SPEEDS[trob.type-3]) & 0xFF;
        if (s8(this.trobMod) < 0) {
          this.trobMod = 0;
          trob.type = -1;
          this.playSound(14);
        } else if (trob.type === 4) {
          this.playSound(15);   // sliding (closing), the sample is a loop
        }
      } else {
        this.trobMod = (this.trobMod+1) & 0xFF;
        if (this.trobMod >= 43) {
          trob.type = -1;
          this.stopSounds();
          if (this.leveldoorOpen === 0 || this.leveldoorOpen === 2) {
            this.leveldoorOpen = 1;
            if (this.levelNumber === 4) {
              // level 4: the mirror appears; get_tile moves the address,
              // so the modifier written back below lands in room 4
              this.getTile(4, 4, 0);
              this.setCurrTile(TILE.MIRROR);
            }
          }
        } else {
          this.playSound(15);   // sliding (opening)
        }
      }
    }
  } // animateLeveldoor

  /** `animate_button`: the event timer runs down */
  animateButton() {
    if (this.trob.type >= 0) {
      var timer = (this.level.doorlinkTimer(this.trobMod)-1) & 0xFFFF;
      this.level.setDoorlinkTimer(this.trobMod, timer);
      if (timer < 2) {
        this.trob.type = -1;
      }
    }
  } // animateButton

  /**
   * `animate_loose`: a loose floor. A negative-looking modifier (bit 7)
   * is a shake; otherwise something stands on it and it counts up to 11,
   * then drops out of the room as a mob.
   */
  animateLoose() {
    var trob = this.trob;
    if (trob.type >= 0) {
      this.trobMod = (this.trobMod+1) & 0xFF;
      if (this.trobMod & 0x80) {
        // just shaking; level 13 never stops (the floors fall by themselves)
        if (this.levelNumber === 13) {
          return;
        }
        if (this.trobMod >= 0x84) {
          this.trobMod = 0;
          trob.type = -1;
        }
        this.looseShake(this.trobMod === 0);
      } else if (this.trobMod >= 11) {
        var room = trob.room, tilepos = trob.tilepos;
        this.trobMod = this.removeLoose(room, tilepos);
        trob.type = -1;
        var row = cdiv(tilepos, 10);
        this.curmob = {
          xh: (tilepos % 10) << 2, y: PrinceLogic.Y_LOOSE_LAND[row+1] & 0xFF, room: room,
          speed: 0, type: 0, row: row
        };
        this.addMob();
      } else {
        this.looseShake(false);
      }
    }
  } // animateLoose

  /** `loose_shake`: one of three shaking sounds, never the same twice */
  looseShake(force) {
    if (force || PrinceLogic.LOOSE_SOUND[this.trobMod & 0x7F]) {
      var soundId;
      do {
        soundId = this.random.next(2)+20;
      } while (soundId === this.lastLooseSound);
      this.random.next(2);   // a cycle the original wastes
      this.lastLooseSound = soundId;
      this.playSound(soundId);
    }
  } // looseShake

  /** `remove_loose`: the tile becomes empty; the modifier left behind is the level type */
  removeLoose(room, tilepos) {
    this.getRoomAddress(room);
    this.setTileAt(tilepos, TILE.EMPTY);
    return this.level.constructor.TYPE_OF_LEVEL[this.levelNumber];
  } // removeLoose

  /**
   * `make_loose_fall`: the loose floor the prince stands on starts its
   * count (modifier 1), or a knock sets it shaking (negative). Bit 5 of
   * the tile byte marks a loose floor that never falls.
   */
  makeLooseFall(modifier) {
    if ((this.tileByteAt(this.currTilepos) & 0x20) === 0) {
      if (s8(this.modAt(this.currTilepos)) <= 0) {
        this.setModAt(this.currTilepos, modifier);
        this.addTrob(this.currRoom, this.currTilepos, 0);
      }
    }
  } // makeLooseFall

  /** `loose_make_shake` */
  looseMakeShake() {
    if (this.modAt(this.currTilepos) === 0 && this.levelNumber !== 13) {
      this.setModAt(this.currTilepos, 0x80);
      this.addTrob(this.currRoom, this.currTilepos, 1);
    }
  } // looseMakeShake

  /** `do_knock`: a landing shakes every loose floor of the row */
  doKnock(room, tileRow) {
    for (var tileCol = 0; tileCol < 10; tileCol++) {
      if (this.getTile(room, tileCol, tileRow) === TILE.LOOSE) {
        this.looseMakeShake();
      }
    }
  } // doKnock

  /** `start_chompers`: the chompers of the prince's row start in a staggered rhythm */
  startChompers() {
    var timing = 15;
    var c = this.char;
    if ((c.currRow & 0xFF) < 3) {
      this.getRoomAddress(c.room);
      for (var column = 0, tilepos = TBL_LINE[c.currRow]; column < 10; column++, tilepos++) {
        if (this.tileAt(tilepos) === TILE.CHOMPER) {
          var mod = this.modAt(tilepos);
          var modifier = mod & 0x7F;
          if (modifier === 0 || modifier >= 6) {
            this.startAnimChomper(c.room, tilepos, timing | (mod & 0x80));
            timing = this.nextChomperTiming(timing);
          }
        }
      }
    }
  } // startChompers

  /** `next_chomper_timing`: 15, 12, 9, 6, 13, 10, 7, 14, 11, 8, ... */
  nextChomperTiming(timing) {
    timing -= 3;
    if (timing < 6) {
      timing += 10;
    }
    return timing;
  } // nextChomperTiming

  /** `start_anim_chomper` */
  startAnimChomper(room, tilepos, modifier) {
    var old = this.modAt(tilepos);
    if (old === 0 || old >= 6) {
      this.setModAt(tilepos, modifier);
      this.addTrob(room, tilepos, 1);
    }
  } // startAnimChomper

  /** `start_anim_spike`: spikes shoot up under the prince */
  startAnimSpike(room, tilepos) {
    var old = s8(this.modAt(tilepos));
    if (old <= 0) {
      if (old === 0) {
        this.addTrob(room, tilepos, 1);
        this.playSound(49);
      } else if (old !== -1) {
        this.setModAt(tilepos, 0x8F);   // -1 is a disabled spike
      }
    }
  } // startAnimSpike

  /** `start_anim_torch` */
  startAnimTorch(room, tilepos) {
    this.setModAt(tilepos, this.random.next(8));
    this.addTrob(room, tilepos, 1);
  } // startAnimTorch

  /** `start_anim_potion` */
  startAnimPotion(room, tilepos) {
    this.setModAt(tilepos, (this.modAt(tilepos) & 0xF8) | (this.random.next(6)+1));
    this.addTrob(room, tilepos, 1);
  } // startAnimPotion

  /** `start_anim_sword` */
  startAnimSword(room, tilepos) {
    this.setModAt(tilepos, this.random.next(0xFF) & 0x1F);
    this.addTrob(room, tilepos, 1);
  } // startAnimSword

  /** `start_level_door`: the door of the start room, fully open, slams shut */
  startLevelDoor(room, tilepos) {
    this.setModAt(tilepos, 43);
    this.addTrob(room, tilepos, 3);
  } // startLevelDoor

  /**
   * `anim_tile_modif`: entering a room sets its potions, torches and
   * swords going — and the torches of the column just left of it, which
   * show through. Reads the tiles of the room addressed last, as the
   * original does (the drawn room after `loadRoomLinks`).
   */
  animTileModif() {
    for (var tilepos = 0; tilepos < 30; tilepos++) {
      switch (this.tileAt(tilepos)) {
        case TILE.POTION:
          this.startAnimPotion(this.drawnRoom, tilepos);
          break;
        case TILE.TORCH:
        case TILE.TORCH_WITH_DEBRIS:
          this.startAnimTorch(this.drawnRoom, tilepos);
          break;
        case TILE.SWORD:
          this.startAnimSword(this.drawnRoom, tilepos);
          break;
      }
    }
    for (var row = 0; row <= 2; row++) {
      var tile = this.getTile(this.roomL, 9, row);
      if (tile === TILE.TORCH || tile === TILE.TORCH_WITH_DEBRIS) {
        this.startAnimTorch(this.roomL, row*10+9);
      }
    }
  } // animTileModif

  /** `check_fall_flo`: level 13 — the floors above the two rooms come down by themselves */
  checkFallFlo() {
    if (this.levelNumber === 13 && (this.drawnRoom === 23 || this.drawnRoom === 16)) {
      this.currRoom = this.roomA;
      this.getRoomAddress(this.currRoom);
      for (this.currTilepos = 22; this.currTilepos <= 27; this.currTilepos++) {
        this.makeLooseFall(-(this.random.next(0xFF) & 0x0F) & 0xFF);
      }
    }
  } // checkFallFlo

  /** `add_trob`: a new trob, or a new type for one already there */
  addTrob(room, tilepos, type) {
    if (this.trobs.length >= 30) {
      return;   // "Trobs Overflow"
    }
    for (var index = 0; index < this.trobs.length; index++) {
      if (this.trobs[index].tilepos === tilepos && this.trobs[index].room === room) {
        this.trobs[index].type = type;
        return;
      }
    }
    this.trobs.push({tilepos: tilepos, room: room, type: type});
  } // addTrob

  // ------------------------------------------------------- buttons and gates

  /**
   * `trigger_button`: a button pressed. Its modifier is the index of the
   * first of its door events; the event's timer (5 bits) is set to 5 and
   * the trob of the button counts it down; the list of targets is run.
   * A timer of 31 means a jammed event that never fires.
   * @param {boolean|number} playsound
   * @param {number} buttonType - A tile type, or 0 for the addressed tile's.
   * @param {number} modifier - An event index, or -1 for the addressed tile's.
   */
  triggerButton(playsound, buttonType, modifier) {
    var tile = this.tileAt(this.currTilepos);
    var mod = this.modAt(this.currTilepos);
    if (buttonType === 0) {
      buttonType = tile;
    }
    if (modifier === -1) {
      modifier = mod;
    }
    var linkTimer = s8(this.level.doorlinkTimer(modifier));
    if (linkTimer !== 0x1F) {
      this.level.setDoorlinkTimer(modifier, 5);
      if (linkTimer < 2) {
        this.addTrob(this.currRoom, this.currTilepos, 1);
        this.isGuardNotice = 1;
        if (playsound) {
          this.playSound(3);
        }
      }
      this.doTriggerList(modifier, buttonType);
    }
  } // triggerButton

  /** `do_trigger_list`: every target of an event list gets its trob */
  doTriggerList(index, buttonType) {
    for (;;) {
      var room = this.level.doorlinkRoom(index);
      this.getRoomAddress(room);
      var tilepos = this.level.doorlinkTile(index);
      var targetType = this.tileAt(tilepos);
      var result = this.trigger1(targetType, room, tilepos, buttonType);
      if (result >= 0) {
        this.addTrob(room, tilepos, result);
      }
      if (!this.level.doorlinkNext(index)) {
        break;
      }
      index++;
    }
  } // doTriggerList

  /** `trigger_1`: what a button does to one target */
  trigger1(targetType, room, tilepos, buttonType) {
    if (targetType === TILE.GATE) {
      return this.triggerGate(room, tilepos, buttonType);
    }
    if (targetType === TILE.LEVEL_DOOR_LEFT) {
      return this.modAt(tilepos) !== 0 ? -1 : 1;
    }
    return -1;
  } // trigger1

  /** `trigger_gate`: the trob type a button gives a gate, -1 for none */
  triggerGate(room, tilepos, buttonType) {
    var modifier = this.modAt(tilepos);
    if (buttonType === TILE.OPENER) {
      if (modifier === 0xFF) {
        return -1;   // open for good
      }
      if (modifier >= 188) {
        this.setModAt(tilepos, 238);   // already open: keep it so a while longer
        return -1;
      }
      this.setModAt(tilepos, (modifier+3) & 0xFC);
      return 1;
    }
    if (buttonType === TILE.DEBRIS) {
      // a loose floor crushed the button: open for good
      if (modifier < 188) {
        return 2;
      }
      this.setModAt(tilepos, 0xFF);
      return -1;
    }
    return modifier !== 0 ? 3 : -1;   // a closer: slam shut unless closed
  } // triggerGate

  /** `died_on_button`: the prince dies on a button — an opener opens for good, a closer jams */
  diedOnButton() {
    var buttonType = this.tileAt(this.currTilepos);
    var modifier = this.modAt(this.currTilepos);
    if (buttonType === TILE.OPENER) {
      this.setTileAt(this.currTilepos, TILE.FLOOR);
      this.setModAt(this.currTilepos, 0);
      buttonType = TILE.DEBRIS;
    } else {
      this.setTileAt(this.currTilepos, TILE.STUCK);
    }
    this.triggerButton(1, buttonType, modifier);
  } // diedOnButton

  // ======================================================== mobs (seg007.c)
  //
  // A mob is a loose floor on its way down: `{xh, y, room, speed, type,
  // row}` — x in 8-pixel columns, y a byte that wraps, speed a signed byte
  // (-1 marks a mob to drop, -2 one that just landed). The code works on
  // `this.curmob`, a copy written back, as the original's `curmob` is.

  /** `do_mobs` */
  doMobs() {
    var count = this.mobs.length;
    for (this.curmobIndex = 0; this.curmobIndex < count; this.curmobIndex++) {
      this.curmob = Object.assign({}, this.mobs[this.curmobIndex]);
      this.moveMob();
      this.checkLooseFallOnKid();
      this.mobs[this.curmobIndex] = this.curmob;
    }
    this.mobs = this.mobs.filter(function(mob) { return mob.speed !== -1; });
  } // doMobs

  /** `move_mob` */
  moveMob() {
    if (this.curmob.type === 0) {
      this.moveLoose();
    }
    if (this.curmob.speed <= 0) {
      this.curmob.speed++;
    }
  } // moveMob

  /** `move_loose`: falls, and lands or drops a row when it reaches a floor line */
  moveLoose() {
    var mob = this.curmob;
    if (mob.speed < 0) {
      return;
    }
    if (mob.speed < 29) {
      mob.speed += 3;
    }
    mob.y = (mob.y+mob.speed) & 0xFF;
    if (mob.room === 0) {
      if (mob.y >= 210) {
        mob.speed = -2;
      }
      return;
    }
    if (mob.y < 226 && PrinceLogic.Y_SOMETHING[mob.row+1] <= mob.y) {
      // at the floor line of its row
      var tile = this.getTile(mob.room, mob.xh >> 2, mob.row);
      if (tile === TILE.LOOSE) {
        this.looseFall();
      }
      if (tile === TILE.EMPTY || tile === TILE.LOOSE) {
        this.mobDownARow();
        return;
      }
      this.playSound(2);
      this.doKnock(mob.room, mob.row);
      mob.y = PrinceLogic.Y_SOMETHING[mob.row+1];
      mob.speed = -2;
      this.looseLand();
    }
  } // moveLoose

  /**
   * `loose_land`: what the tile it lands on becomes — debris, a torch with
   * debris; a button under it is pressed for good (an opener) or jammed
   * (a closer). The original's switch falls through, so a button becomes
   * debris too.
   */
  looseLand() {
    var mob = this.curmob;
    var buttonType = 0;
    var tiletype = this.getTile(mob.room, mob.xh >> 2, mob.row);
    var pressed = false;
    if (tiletype === TILE.OPENER) {
      this.setCurrTile(TILE.DEBRIS);
      buttonType = TILE.DEBRIS;
      pressed = true;
    }
    if (pressed || tiletype === TILE.CLOSER) {
      this.triggerButton(1, buttonType, -1);
      tiletype = this.getTile(mob.room, mob.xh >> 2, mob.row);
      pressed = true;
    }
    if (pressed || tiletype === TILE.FLOOR || tiletype === TILE.SPIKE || tiletype === TILE.POTION ||
        tiletype === TILE.TORCH || tiletype === TILE.TORCH_WITH_DEBRIS) {
      if (tiletype === TILE.TORCH || tiletype === TILE.TORCH_WITH_DEBRIS) {
        this.setCurrTile(TILE.TORCH_WITH_DEBRIS);
      } else {
        this.setCurrTile(TILE.DEBRIS);
      }
    }
  } // looseLand

  /** `loose_fall`: a falling floor knocks the loose floor it hits down with it */
  looseFall() {
    this.setModAt(this.currTilepos, this.removeLoose(this.currRoom, this.currTilepos));
    this.curmob.speed >>= 1;
    this.mobs[this.curmobIndex] = Object.assign({}, this.curmob);
    this.curmob.y = (this.curmob.y+6) & 0xFF;
    this.mobDownARow();
    this.addMob();
    this.curmob = Object.assign({}, this.mobs[this.curmobIndex]);
  } // looseFall

  /** `mob_down_a_row` */
  mobDownARow() {
    var mob = this.curmob;
    mob.row++;
    if (mob.row >= 3) {
      mob.y = (mob.y-192) & 0xFF;
      mob.row = 0;
      mob.room = mob.room ? this.level.roomlinks[mob.room-1].down : 0;
    }
  } // mobDownARow

  /** `add_mob` */
  addMob() {
    if (this.mobs.length >= 14) {
      return;   // "Mobs Overflow"
    }
    this.mobs.push(Object.assign({}, this.curmob));
  } // addMob

  /** `check_loose_fall_on_kid` */
  checkLooseFallOnKid() {
    var c = this.kid, mob = this.curmob;
    if (c.room === mob.room && c.currCol === (mob.xh >> 2) && mob.y < c.y && c.y-30 < mob.y) {
      this.fellOnYourHead();
    }
  } // checkLooseFallOnKid

  /** `fell_on_your_head`: a loose floor on the prince costs a point, or his life */
  fellOnYourHead() {
    var c = this.char;
    var frame = c.frame, action = c.action;
    // running frames 5..14 are safe, except on level 13
    if ((this.levelNumber === 13 || (frame < FRAME.START_RUN_5 || frame >= 15)) &&
        (action < ACTION.HANG_CLIMB || action === ACTION.TURN)) {
      c.y = Y_LAND[c.currRow+1] & 0xFF;
      if (this.takeHp(1)) {
        this.seqtblOffsetChar(SEQ.CRUSHED);
        if (frame === FRAME.SPIKED) {
          c.x = this.charDxForward(-12) & 0xFF;
        }
      } else if (frame !== FRAME.CROUCH) {
        if (this.getTileBehindChar() === TILE.EMPTY) {
          c.x = this.charDxForward(-2) & 0xFF;
        }
        this.seqtblOffsetChar(SEQ.LOOSE_FLOOR_FELL_ON_KID);
      }
    }
  } // fellOnYourHead

  /**
   * The falling floors to draw this frame (`draw_mobs`, `draw_mob`): x in
   * 8-pixel columns and the bottom y in the drawn room's coordinates; a
   * mob of the room below or above shows only near the edge.
   * @returns {Object[]} `{xh, yBottom}` per visible mob.
   */
  mobObjects() {
    var out = [];
    for (var index = 0; index < this.mobs.length; index++) {
      var mob = this.mobs[index];
      var ypos = mob.y;
      if (mob.room === this.drawnRoom) {
        if (mob.y >= 210) continue;
      } else if (mob.room === this.roomB) {
        if (Math.abs(s8(ypos)) >= 18) continue;
        ypos = mob.y+192;
      } else if (mob.room === this.roomA) {
        if (mob.y < 174) continue;
        ypos = mob.y-189;
      } else {
        continue;
      }
      out.push({xh: mob.xh, yBottom: ypos});
    }
    return out;
  } // mobObjects

  // ================================================================= mirror

  /**
   * `check_mirror`: the prince's reflection in the mirror of level 4, an
   * object drawn like the prince himself (type 4 of the object table); the
   * jump through the mirror creates the shadow — that is P5.
   * @returns {Object|null} As `kidObject()`, or null.
   */
  mirrorObject() {
    if (this.jumpedThroughMirror === -1) {
      this.jumpThroughMirror();
      return null;
    }
    var c = this.char;
    if (this.getTileAtChar() !== TILE.MIRROR) {
      return null;
    }
    this.loadFrame();
    var savedX = c.x, savedDirection = c.direction;
    this.checkMirrorImage();
    var object = null;
    if (this.distanceMirror >= 0 && c.room === this.drawnRoom) {
      this.loadFrameToObj();
      this.resetObjClip();
      var clipTop = Y_CLIP[c.currRow+1];
      if (clipTop < this.objY) {
        this.objClipTop = clipTop;
        this.objClipLeft = (c.currCol << 5)+9;
        if (this.objId !== 0xFF) {
          object = {
            chtab: this.objChtab, image: this.objId+1, x: cdiv(this.objX*320, 280), yBottom: this.objY,
            flip: this.objDirection === DIR.RIGHT,
            clip: {left: this.objClipLeft, right: this.objClipRight, top: this.objClipTop, bottom: this.objClipBottom}
          };
        }
      }
    }
    // the original mirrors Char and draws it; the prince himself is Kid,
    // which the mirroring did not touch — so restore
    c.x = savedX;
    c.direction = savedDirection;
    return object;
  } // mirrorObject

  /** `check_mirror_image`: the character mirrored about the mirror's glass */
  checkMirrorImage() {
    var c = this.char;
    var xpos = X_BUMP[c.currCol+FIRST_ONSCREEN_COLUMN]+10;
    var distance = this.distanceToEdgeWeight();
    if (c.direction >= DIR.RIGHT) {
      distance = (~distance)+TILE_SIZEX;
    }
    this.distanceMirror = distance-2;
    c.x = ((xpos << 1)-c.x) & 0xFF;
    c.direction = ~c.direction;
  } // checkMirrorImage

  /** `jump_through_mirror` — the sound; the shadow that steps out is P5 */
  jumpThroughMirror() {
    this.jumpedThroughMirror = 0;
    this.playSound(45);
  } // jumpThroughMirror

  // ================================================================= hooks
  /** the end of the game, level 14 room 5 (P7) */
  endSequence() { }
  /** the mouse of level 8 (P5) */
  doMouse() { }
  /** the guards of P5 */
  checkSkel() { }
  checkCanGuardSeeKid() { this.canGuardSeeKid = 0; }
  playGuardFrame() { }
  checkSwordHurting() { }
  checkSwordHurt() { }
  checkSwordVsSword() { }
  checkGuardFallout() { }
  checkShadow() { }

} // PrinceLogic

// tables of the tile mechanisms (seg007.c)
/** the closing speed of a gate by trob type 3..8 (data:27B2) */
PrinceLogic.GATE_CLOSE_SPEEDS = [0, 0, 0, 20, 40, 60, 80, 100, 120];
/** what a gate's openness changes by per frame: closing, opening, opening for good (data:27C0) */
PrinceLogic.DOOR_DELTA = [0xFF, 4, 4];
/** the closing speed of the level door by trob type 3..6 (data:27B8) */
PrinceLogic.LEVELDOOR_CLOSE_SPEEDS = [0, 5, 17, 99, 0];
/** where a loose floor starts falling from, by row+1 (data:2284) */
PrinceLogic.Y_LOOSE_LAND = [2, 65, 128, 191, 254];
/** the line a falling floor lands on, by row+1 (data:227A) */
PrinceLogic.Y_SOMETHING = [-1, 62, 125, 188, 25];
/** which shaking frames make a sound (data:2734) */
PrinceLogic.LOOSE_SOUND = [0, 1, 1, 1, 0, 1, 0, 0, 1, 0, 0, 0];
