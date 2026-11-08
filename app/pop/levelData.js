const { TILE } = await import('./tileTable.js?ver='+window.srcVersion);
// begin code

/**
 * One level: 24 rooms of 10x3 tiles with their links, the door events,
 * the starting position and the guards. The binary shape is the 2305-byte
 * `level_type` of the original (SDLPoP `types.h`), which the class reads
 * and writes back byte for byte so a level can be checked round trip.
 *
 * Tiles are addressed by room 1..24 and position 0..29 (row*10+column); the
 * arrays here keep the original's flat layout `(room-1)*30 + position`.
 */
export class PoPLevel {

  /** the binary size of a level */
  static get BYTES() { return 2305; }
  static get ROOMS() { return 24; }
  static get TILES() { return 30; }

  /**
   * Which levels are palaces (1) and which dungeons (0), by level number
   * 0..15 — level 0 is the demo, 14 the vizier's, 15 the copy protection
   * (SDLPoP `data.h`, `tbl_level_type`).
   */
  static get TYPE_OF_LEVEL() { return [0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 1, 1, 0, 0, 1, 0]; }

  /**
   * Which guard set a level uses: 0 guard, 1 fat, 2 skeleton, 3 vizier,
   * 4 shadow, -1 none (`tbl_guard_type`).
   */
  static get GUARD_OF_LEVEL() { return [0, 0, 0, 2, 0, 0, 1, 0, 0, 0, 0, 0, 4, 3, -1, -1]; }

  constructor() {
    this.id = 'PoPLevel';
    /** tile types, 720 bytes, the whole byte kept (the game uses the low 5 bits) */
    this.fg = new Uint8Array(720);
    /** tile modifiers, 720 bytes */
    this.bg = new Uint8Array(720);
    /** door events, low bytes: tile (5 bits), room low bits, "last" flag */
    this.doorlinks1 = new Uint8Array(256);
    /** door events, high bytes: timer (5 bits), room high bits */
    this.doorlinks2 = new Uint8Array(256);
    /** neighbours of every room, {left, right, up, down}, 0 = none */
    this.roomlinks = [];
    for (var i = 0; i < 24; i++) {
      this.roomlinks.push({left: 0, right: 0, up: 0, down: 0});
    }
    this.usedRooms = 0;
    /** editor coordinates of the rooms, 255 = unused */
    this.roomX = new Uint8Array(24);
    this.roomY = new Uint8Array(24);
    this.fill1 = new Uint8Array(15);
    this.startRoom = 0;
    this.startPos = 0;
    /** -1 left, 0 right (a signed byte in the file) */
    this.startDir = 0;
    this.fill2 = new Uint8Array(4);
    this.guardsTile = new Uint8Array(24);
    this.guardsDir = new Uint8Array(24);
    this.guardsX = new Uint8Array(24);
    this.guardsSeqLo = new Uint8Array(24);
    this.guardsSkill = new Uint8Array(24);
    this.guardsSeqHi = new Uint8Array(24);
    this.guardsColor = new Uint8Array(24);
    this.fill3 = new Uint8Array(18);
    /** how many bytes the level had in the file: 2305, or 2304 for level 15 */
    this.byteLength = PoPLevel.BYTES;
  } // constructor

  // ------------------------------------------------------------------ binary

  /**
   * Reads the 2305 bytes of a level resource.
   * @param {Uint8Array} bytes - Exactly 2305 bytes.
   * @returns {PoPLevel}
   */
  static fromBytes(bytes) {
    // ★ level 15 (the copy protection) is 2304 bytes in LEVELS.DAT of 1.0:
    // the last filler byte is missing; the original reads what is there
    // (`load_from_opendats_to_area`, MIN(size, length)) — measured on the
    // operator's files, checkdat.mjs
    if (bytes.length !== PoPLevel.BYTES && bytes.length !== PoPLevel.BYTES-1) {
      throw new Error('PoPLevel.fromBytes: '+bytes.length+' bytes, expected '+PoPLevel.BYTES);
    }
    var level = new PoPLevel();
    level.byteLength = bytes.length;
    var at = 0;
    var take = function(target) {
      target.set(bytes.subarray(at, Math.min(bytes.length, at+target.length)));
      at += target.length;
    };
    take(level.fg);
    take(level.bg);
    take(level.doorlinks1);
    take(level.doorlinks2);
    for (var i = 0; i < 24; i++) {
      level.roomlinks[i] = {left: bytes[at], right: bytes[at+1], up: bytes[at+2], down: bytes[at+3]};
      at += 4;
    }
    level.usedRooms = bytes[at++];
    take(level.roomX);
    take(level.roomY);
    take(level.fill1);
    level.startRoom = bytes[at++];
    level.startPos = bytes[at++];
    level.startDir = bytes[at] > 127 ? bytes[at]-256 : bytes[at];
    at++;
    take(level.fill2);
    take(level.guardsTile);
    take(level.guardsDir);
    take(level.guardsX);
    take(level.guardsSeqLo);
    take(level.guardsSkill);
    take(level.guardsSeqHi);
    take(level.guardsColor);
    take(level.fill3);
    return level;
  } // fromBytes

  /**
   * Writes the level back in the binary shape.
   * @returns {Uint8Array} 2305 bytes.
   */
  toBytes() {
    var bytes = new Uint8Array(PoPLevel.BYTES);
    var at = 0;
    var put = function(source) {
      bytes.set(source, at);
      at += source.length;
    };
    put(this.fg);
    put(this.bg);
    put(this.doorlinks1);
    put(this.doorlinks2);
    for (var i = 0; i < 24; i++) {
      var link = this.roomlinks[i];
      bytes[at] = link.left; bytes[at+1] = link.right; bytes[at+2] = link.up; bytes[at+3] = link.down;
      at += 4;
    }
    bytes[at++] = this.usedRooms;
    put(this.roomX);
    put(this.roomY);
    put(this.fill1);
    bytes[at++] = this.startRoom;
    bytes[at++] = this.startPos;
    bytes[at++] = this.startDir & 0xFF;
    put(this.fill2);
    put(this.guardsTile);
    put(this.guardsDir);
    put(this.guardsX);
    put(this.guardsSeqLo);
    put(this.guardsSkill);
    put(this.guardsSeqHi);
    put(this.guardsColor);
    put(this.fill3);
    return bytes.subarray(0, this.byteLength);
  } // toBytes

  // -------------------------------------------------------------------- JSON

  /**
   * The readable shape kept in `data/levels/`: rooms with their tiles and
   * links, decoded door events, guards per room. Everything needed to
   * rebuild the 2305 bytes is here, the filler bytes included.
   * @param {number} [number] - The level number, for the record.
   * @returns {Object}
   */
  toJSON(number) {
    var rooms = [];
    for (var r = 0; r < 24; r++) {
      rooms.push({
        fg: Array.from(this.fg.subarray(r*30, r*30+30)),
        bg: Array.from(this.bg.subarray(r*30, r*30+30)),
        links: this.roomlinks[r],
        x: this.roomX[r],
        y: this.roomY[r]
      });
    }
    var events = [];
    for (var e = 0; e < 256; e++) {
      events.push({
        room: this.doorlinkRoom(e), tile: this.doorlinkTile(e),
        timer: this.doorlinkTimer(e), next: this.doorlinkNext(e)
      });
    }
    var guards = [];
    for (var g = 0; g < 24; g++) {
      guards.push({
        tile: this.guardsTile[g], dir: this.guardsDir[g], x: this.guardsX[g],
        seqLo: this.guardsSeqLo[g], skill: this.guardsSkill[g],
        seqHi: this.guardsSeqHi[g], color: this.guardsColor[g]
      });
    }
    return {
      format: 'pop-level-1',
      level: number,
      type: number === undefined ? undefined : (PoPLevel.TYPE_OF_LEVEL[number] ? 'palace' : 'dungeon'),
      bytes: this.byteLength,
      usedRooms: this.usedRooms,
      start: {room: this.startRoom, pos: this.startPos, dir: this.startDir},
      rooms: rooms,
      doorlinks: {low: Array.from(this.doorlinks1), high: Array.from(this.doorlinks2), events: events},
      guards: guards,
      fill: {f1: Array.from(this.fill1), f2: Array.from(this.fill2), f3: Array.from(this.fill3)}
    };
  } // toJSON

  /**
   * Rebuilds a level from its JSON shape.
   * @param {Object} data - What `toJSON` produced.
   * @returns {PoPLevel}
   */
  static fromJSON(data) {
    var level = new PoPLevel();
    for (var r = 0; r < 24; r++) {
      var room = data.rooms[r];
      level.fg.set(room.fg, r*30);
      level.bg.set(room.bg, r*30);
      level.roomlinks[r] = {left: room.links.left, right: room.links.right, up: room.links.up, down: room.links.down};
      level.roomX[r] = room.x;
      level.roomY[r] = room.y;
    }
    level.doorlinks1.set(data.doorlinks.low);
    level.doorlinks2.set(data.doorlinks.high);
    level.usedRooms = data.usedRooms;
    level.startRoom = data.start.room;
    level.startPos = data.start.pos;
    level.startDir = data.start.dir;
    for (var g = 0; g < 24; g++) {
      var guard = data.guards[g];
      level.guardsTile[g] = guard.tile; level.guardsDir[g] = guard.dir; level.guardsX[g] = guard.x;
      level.guardsSeqLo[g] = guard.seqLo; level.guardsSkill[g] = guard.skill;
      level.guardsSeqHi[g] = guard.seqHi; level.guardsColor[g] = guard.color;
    }
    level.fill1.set(data.fill.f1);
    level.fill2.set(data.fill.f2);
    level.fill3.set(data.fill.f3);
    if (data.bytes) {
      level.byteLength = data.bytes;
    }
    return level;
  } // fromJSON

  // ------------------------------------------------------------------- tiles

  /**
   * The tile type at a position (low 5 bits).
   * @param {number} room - 1..24.
   * @param {number} pos - 0..29.
   * @returns {number}
   */
  tile(room, pos) {
    return this.fg[(room-1)*30+pos] & 0x1F;
  } // tile

  modifier(room, pos) {
    return this.bg[(room-1)*30+pos];
  } // modifier

  // -------------------------------------------------------------- door links

  /** the timer of a door event (SDLPoP `seg007.c`, `get_doorlink_timer`) */
  doorlinkTimer(index) { return this.doorlinks2[index] & 0x1F; }
  doorlinkTile(index) { return this.doorlinks1[index] & 0x1F; }
  /** whether another event follows this one */
  doorlinkNext(index) { return (this.doorlinks1[index] & 0x80) === 0; }
  /** `set_doorlink_timer`: the low 5 bits of the high byte */
  setDoorlinkTimer(index, value) {
    this.doorlinks2[index] = (this.doorlinks2[index] & 0xE0) | (value & 0x1F);
    return this.doorlinks2[index];
  } // setDoorlinkTimer
  doorlinkRoom(index) {
    return ((this.doorlinks1[index] & 0x60) >> 5) + ((this.doorlinks2[index] & 0xE0) >> 3);
  } // doorlinkRoom

  // ------------------------------------------------------------ preparation

  /**
   * Rewrites the modifiers the way the game does when it loads a level
   * (SDLPoP `seg008.c`, `alter_mods_allrm` / `load_alter_mod`): a gate's 1
   * becomes 188 (open), else 0 (closed); a loose floor starts at 0; a
   * potion's type moves up three bits to make room for the animation frame;
   * a wall's 1 ("no blue line") becomes bit 7, and bits 0-1 record whether
   * the neighbours are walls too, which the wall pattern is drawn from.
   * Fake tiles and the copy-protection potion of SDLPoP are not part of the
   * original and are left out.
   * @returns {PoPLevel} This.
   */
  alterMods() {
    var used = Math.min(this.usedRooms, 24);
    for (var room = 1; room <= used; room++) {
      var base = (room-1)*30;
      var roomL = this.roomlinks[room-1].left;
      var roomR = this.roomlinks[room-1].right;
      for (var pos = 0; pos < 30; pos++) {
        var tile = this.fg[base+pos] & 0x1F;
        var mod = this.bg[base+pos];
        switch (tile) {
          case TILE.GATE:
            this.bg[base+pos] = mod === 1 ? 188 : 0;
            break;
          case TILE.LOOSE:
            this.bg[base+pos] = 0;
            break;
          case TILE.POTION:
            this.bg[base+pos] = (mod << 3) & 0xFF;
            break;
          case TILE.WALL: {
            var value = mod === 1 ? 0x80 : (mod << 4) & 0xFF;
            var wallLeft = 1;
            var wallRight = 1;
            if (pos % 10 === 0) {
              if (roomL) {
                wallLeft = (this.fg[(roomL-1)*30+pos+9] & 0x1F) === TILE.WALL ? 1 : 0;
              }
            } else {
              wallLeft = (this.fg[base+pos-1] & 0x1F) === TILE.WALL ? 1 : 0;
            }
            if (pos % 10 === 9) {
              if (roomR) {
                wallRight = (this.fg[(roomR-1)*30+pos-9] & 0x1F) === TILE.WALL ? 1 : 0;
              }
            } else {
              wallRight = (this.fg[base+pos+1] & 0x1F) === TILE.WALL ? 1 : 0;
            }
            if (wallLeft && wallRight) {
              value |= 3;
            } else if (wallLeft) {
              value |= 2;
            } else if (wallRight) {
              value |= 1;
            }
            this.bg[base+pos] = value;
            break;
          }
        }
      }
    }
    return this;
  } // alterMods

} // PoPLevel
