const { TILE, TILE_PIECES, tileIsFloor, WALL_IMAGE, WALL_JOIN } = await import('./tileTable.js?ver='+window.srcVersion);
const { PoPRandom } = await import('./popRandom.js?ver='+window.srcVersion);
// begin code

/** how an image is put on the screen (SDLPoP `types.h`, `enum blitters`) */
export const BLIT = {
  /** every pixel, colour 0 included */
  COPY: 0,
  /** OR-ed into what is there; equal to TRANSPARENT wherever the ground is black */
  OR: 2,
  /** XOR — the shadow */
  XOR: 3,
  /** the shape of the image in black (colour 0) */
  BLACK: 9,
  /** colour 0 left out */
  TRANSPARENT: 0x10,
  /** 0x40+c: the shape of the image in palette colour c */
  MONO: 0x40
};

/**
 * Draws one room of a level into a 320-pixel-wide buffer the way the
 * original does it (SDLPoP `seg008.c`, `draw_room` and the `draw_tile_*`
 * family): three rows of ten tiles, bottom row first, every tile assembled
 * from pieces of the environment chtab into three lists — background,
 * middle (objects) and foreground — which are then painted in that order,
 * with solid rectangles ("wipes") between them. The row of the room above
 * shows through the top three pixel lines.
 *
 * Of the characters the drawer knows only where the prince stands (`kid`),
 * for the one piece of a room that depends on it: the gate he stands in is
 * drawn in front of him (`draw_gate_fore`). The remake draws the whole
 * room every frame from the tiles as they are, so the mechanisms of P4
 * (gates, spikes, chompers, loose floors, torches, potions) show through
 * their modifiers without the original's partial-redraw bookkeeping
 * (`redraw_frames_*`) — except the one piece of it that shows: the tiles
 * the prince hangs from, falls past or climbs onto are drawn once more in
 * the middle layer over him (`draw_other_overlay`, `draw_floor_overlay`),
 * which is what puts him behind the edge of a floor. The owner asks for
 * them through `overlays` and `aboveColumns` and paints the `overlay`
 * list around him in the order of the tiles.
 *
 * Coordinates: a tile is 32 pixels wide and 63 high; the bottom line of the
 * floor of row `r` is at `63*r + 65`, and x is counted in 8-pixel columns
 * (`xh`) plus a pixel offset (`xl`), as in the original.
 */
export class RoomRenderer {

  /**
   * @param {PoPLevel} level - The level, with `alterMods()` applied.
   * @param {Object} chtabs - `{environment, wall, flame}` — the tiles, the
   *        wall pieces (resources 200 and 360 of the dungeon or palace DAT)
   *        and the flame/sword/potion set (PRINCE.DAT 150).
   * @param {Object} [options]
   * @param {number} [options.levelNumber=1] - Decides dungeon or palace.
   * @param {boolean} [options.palace] - Overrides the level table.
   */
  constructor(level, chtabs, options) {
    var settings = options || {};
    this.level = level;
    this.chtabs = chtabs;
    this.levelNumber = settings.levelNumber === undefined ? 1 : settings.levelNumber;
    /** 0 dungeon, 1 palace — the `tbl_level_type` of the original */
    this.palace = settings.palace === undefined ?
      (level.constructor.TYPE_OF_LEVEL[this.levelNumber] ? 1 : 0) : (settings.palace ? 1 : 0);

    /** the tile drawn above the top row when there is no room above */
    this.topEdgeTile = TILE.FLOOR;
    /** the tile at the left when there is no room to the left */
    this.leftEdgeTile = TILE.WALL;

    this.random = new PoPRandom(0);
    /** the colours of the palace bricks, 3 rows x 4 sub-rows x 11 columns */
    this.palaceWallColors = new Uint8Array(44*3);
    /** where the prince stands, `{room, row, col, frame}` (`Kid.room`, `curr_row`, `curr_col`, `frame`), or null */
    this.kid = null;
    /** tiles to draw once more over the prince, `{tilepos, kind: 'floor'|'other'}` (`redraw_frames2`, `redraw_frames_floor_overlay`) */
    this.overlays = [];
    /** columns of the row above whose floor front goes in front too (`redraw_frames_above`) */
    this.aboveColumns = [];
    /** what came of them: entries as in the other lists, each with its `tilepos` */
    this.overlay = [];
    /** the clip box of the level door as drawn last (`leveldoor_ybottom`, `leveldoor_right`) */
    this.leveldoorYBottom = 0;
    this.leveldoorRight = 0;

    this.back = [];
    this.mid = [];
    this.fore = [];
    this.wipes = [];
    this.overlayTilepos = 0;
    this.target = null;
    /** drawRoom() only collects the lists when set (drawRoomBackground) */
    this.collectOnly = false;
    this.reset();
  } // constructor

  reset() {
    this.drawnRoom = 0;
    this.roomL = 0; this.roomR = 0; this.roomA = 0; this.roomB = 0;
    this.roomAL = 0; this.roomAR = 0; this.roomBL = 0; this.roomBR = 0;
    this.leftroom = [{tile: 0, mod: 0}, {tile: 0, mod: 0}, {tile: 0, mod: 0}];
    this.rowBelowLeft = [];
    for (var i = 0; i < 10; i++) {
      this.rowBelowLeft.push({tile: 0, mod: 0});
    }
    this.drawnRow = 0;
    this.drawnCol = 0;
    this.drawXh = 0;
    this.drawMainY = 0;
    this.drawBottomY = 0;
    this.currTile = 0;
    this.currMod = 0;
    this.tileLeft = 0;
    this.modLeft = 0;
    this.addTable = 'back';
  } // reset

  // ------------------------------------------------------------------- entry

  /**
   * Draws a room.
   * @param {number} room - 1..24.
   * @param {VGAVideoRAM} target - 320 pixels wide, at least 192 high.
   * @returns {VGAVideoRAM} The target.
   */
  drawRoom(room, target) {
    this.reset();
    this.target = target;
    this.back.length = 0;
    this.mid.length = 0;
    this.fore.length = 0;
    this.wipes.length = 0;
    this.overlay.length = 0;
    this.drawnRoom = room;
    this.loadRoomLinks();
    if (this.palace) {
      this.genPalaceWallColors();
    }
    this.loadLeftroom();
    for (this.drawnRow = 2; this.drawnRow >= 0; this.drawnRow--) {
      this.loadRowBelow();
      this.drawBottomY = 63*this.drawnRow+65;
      this.drawMainY = this.drawBottomY-3;
      for (this.drawnCol = 0; this.drawnCol < 10; this.drawnCol++) {
        this.loadCurrAndLeftTile();
        this.drawTile();
        this.drawOverlayAt(this.drawnRow*10+this.drawnCol);
      }
    }
    // the bottom row of the room above shows in the top lines
    var saved = this.drawnRoom;
    this.drawnRoom = this.roomA;
    this.loadRoomLinks();
    this.loadLeftroom();
    this.drawnRow = 2;
    this.loadRowBelow();
    for (this.drawnCol = 0; this.drawnCol < 10; this.drawnCol++) {
      this.loadCurrAndLeftTile();
      this.drawMainY = -1;
      this.drawBottomY = 2;
      this.drawTileAboveRoom(this.aboveColumns.indexOf(this.drawnCol) >= 0);
    }
    this.drawnRoom = saved;
    this.loadRoomLinks();
    if (!this.collectOnly) {
      this.paintBackground(target);
      this.paintForeground(target);
    }
    return target;
  } // drawRoom

  /**
   * Collects the lists of a room and paints only what lies **behind** the
   * characters (see {@link RoomRenderer#paintBackground}); the foreground
   * list stays collected for {@link RoomRenderer#paintForeground}, so a
   * caller draws the characters between the two the way the original's
   * `draw_tables` does.
   * @param {number} room - 1..24.
   * @param {VGAVideoRAM} target
   * @returns {VGAVideoRAM} The target.
   */
  drawRoomBackground(room, target) {
    this.collectOnly = true;
    try {
      this.drawRoom(room, target);
    } finally {
      this.collectOnly = false;
    }
    this.paintBackground(target);
    return target;
  } // drawRoomBackground

  // --------------------------------------------------------- room and tiles

  loadRoomLinks() {
    var links = this.level.roomlinks;
    this.roomBR = 0; this.roomBL = 0; this.roomAR = 0; this.roomAL = 0;
    if (this.drawnRoom) {
      var link = links[this.drawnRoom-1];
      this.roomL = link.left; this.roomR = link.right; this.roomA = link.up; this.roomB = link.down;
      if (this.roomA) {
        this.roomAL = links[this.roomA-1].left;
        this.roomAR = links[this.roomA-1].right;
      } else {
        if (this.roomL) { this.roomAL = links[this.roomL-1].up; }
        if (this.roomR) { this.roomAR = links[this.roomR-1].up; }
      }
      if (this.roomB) {
        this.roomBL = links[this.roomB-1].left;
        this.roomBR = links[this.roomB-1].right;
      } else {
        if (this.roomL) { this.roomBL = links[this.roomL-1].down; }
        if (this.roomR) { this.roomBR = links[this.roomR-1].down; }
      }
    } else {
      this.roomB = 0; this.roomA = 0; this.roomR = 0; this.roomL = 0;
    }
  } // loadRoomLinks

  /**
   * The tile type and modifier to draw at a position, with the pressed
   * buttons shown as what they turn into (`get_tile_to_draw`).
   * @param {number} room - 1..24, or 0 for "no room" (then `tileRoom0` is used).
   * @param {number} column - -1 for the last column of the room to the left.
   * @param {number} row - 0..2.
   * @param {number} tileRoom0 - The type to assume where there is no room.
   * @returns {{tile: number, mod: number}}
   */
  tileToDraw(room, column, row, tileRoom0) {
    var out = {tile: 0, mod: 0};
    if (column === -1) {
      out.tile = this.leftroom[row].tile;
      out.mod = this.leftroom[row].mod;
    } else if (room) {
      var pos = row*10+column;
      out.tile = this.level.fg[(room-1)*30+pos] & 0x1F;
      out.mod = this.level.bg[(room-1)*30+pos];
    } else {
      out.tile = tileRoom0;
      out.mod = 0;
    }
    var tile = out.tile & 0x1F;
    if (tile === TILE.CLOSER) {
      if (this.level.doorlinkTimer(out.mod) > 1) {
        out.tile = TILE.STUCK;
      }
    } else if (tile === TILE.OPENER) {
      if (this.level.doorlinkTimer(out.mod) > 1) {
        out.mod = 0;
        out.tile = TILE.FLOOR;
      }
    }
    return out;
  } // tileToDraw

  loadCurrAndLeftTile() {
    var edge = this.drawnRow === 2 ? this.topEdgeTile : TILE.WALL;
    var curr = this.tileToDraw(this.drawnRoom, this.drawnCol, this.drawnRow, edge);
    var left = this.tileToDraw(this.drawnRoom, this.drawnCol-1, this.drawnRow, edge);
    this.currTile = curr.tile; this.currMod = curr.mod;
    this.tileLeft = left.tile; this.modLeft = left.mod;
    this.drawXh = this.drawnCol*4;
  } // loadCurrAndLeftTile

  loadLeftroom() {
    for (var row = 0; row < 3; row++) {
      this.leftroom[row] = this.tileToDraw(this.roomL, 9, row, this.leftEdgeTile);
    }
  } // loadLeftroom

  loadRowBelow() {
    var room, roomLeft, rowBelow;
    if (this.drawnRow === 2) {
      room = this.roomB; roomLeft = this.roomBL; rowBelow = 0;
    } else {
      room = this.drawnRoom; roomLeft = this.roomL; rowBelow = this.drawnRow+1;
    }
    for (var column = 1; column < 10; column++) {
      this.rowBelowLeft[column] = this.tileToDraw(room, column-1, rowBelow, TILE.EMPTY);
    }
    this.rowBelowLeft[0] = this.tileToDraw(roomLeft, 9, rowBelow, TILE.WALL);
  } // loadRowBelow

  // -------------------------------------------------------------- the lists

  /**
   * Adds an image to one of the lists (`add_backtable` & co.). Numbers are
   * 1-based; 0 and missing images add nothing.
   * @param {string} which - 'back', 'mid' or 'fore'.
   * @param {Chtab} chtab
   * @param {number} number - 1-based image number.
   * @param {number} xh - x in 8-pixel columns.
   * @param {number} xl - x offset in pixels.
   * @param {number} yBottom - The bottom line of the image.
   * @param {number} blit - A BLIT value.
   * @returns {boolean} Whether anything was added.
   */
  add(which, chtab, number, xh, xl, yBottom, blit) {
    if (!number) {
      return false;
    }
    var image = chtab.image(number);
    if (!image) {
      return false;
    }
    var list = which === 'back' ? this.back : (which === 'fore' ? this.fore : (which === 'overlay' ? this.overlay : this.mid));
    list.push({chtab: chtab, image: image, x: xh*8+xl, y: yBottom-image.height+1, blit: blit, tilepos: this.overlayTilepos});
    return true;
  } // add

  addBack(chtab, number, xh, xl, yBottom, blit) { return this.add('back', chtab, number, xh, xl, yBottom, blit); }
  addFore(chtab, number, xh, xl, yBottom, blit) { return this.add('fore', chtab, number, xh, xl, yBottom, blit); }
  addMid(chtab, number, xh, xl, yBottom, blit) { return this.add('mid', chtab, number, xh, xl, yBottom, blit); }
  /** the redirectable insertion (`ptr_add_table`), normally the background */
  addCurrent(chtab, number, xh, xl, yBottom, blit) { return this.add(this.addTable, chtab, number, xh, xl, yBottom, blit); }

  /**
   * A solid rectangle painted before the background (layer 0) or before the
   * foreground (layer 1).
   */
  addWipe(layer, left, bottom, height, width, color) {
    this.wipes.push({layer: layer, left: left, top: bottom+1-height, height: height, width: width, color: color});
  } // addWipe

  // ------------------------------------------------------------- the pieces

  drawTile() {
    this.drawTileFloorRight();
    this.drawTileAnimTopRight();
    this.drawTileRight();
    this.drawTileAnimRight();
    this.drawTileBottom(false);
    this.drawLoose();
    this.drawTileBase();
    this.drawTileAnim();
    this.drawTileFore();
  } // drawTile

  /**
   * @param {boolean} [inFront] - The floor front once more in the foreground
   *        (`redraw_needed_above`, `draw_tile_bottom(1)`): the prince climbing
   *        into the room above goes behind it.
   */
  drawTileAboveRoom(inFront) {
    this.drawTileFloorRight();
    this.drawTileAnimTopRight();
    this.drawTileRight();
    this.drawTileBottom(!!inFront);
    this.drawLoose();
    this.drawTileFore();
  } // drawTileAboveRoom

  /** `draw_tile2`: the pieces a tile is drawn once more with, over the prince */
  drawTile2() {
    this.drawTileRight();
    this.drawTileAnimRight();
    this.drawTileBase();
    this.drawTileAnim();
    this.drawTileBottom(false);
    this.drawLoose();
  } // drawTile2

  /**
   * The overlay asked for at a tile (`redraw_needed`: `redraw_frames2` →
   * `draw_other_overlay`, `redraw_frames_floor_overlay` → `draw_floor_overlay`),
   * collected into the `overlay` list tagged with the tile.
   */
  drawOverlayAt(tilepos) {
    var request = null;
    for (var i = 0; i < this.overlays.length; i++) {
      if (this.overlays[i].tilepos === tilepos) {
        request = this.overlays[i];
        break;
      }
    }
    if (!request) {
      return;
    }
    this.overlayTilepos = tilepos;
    if (request.kind === 'floor') {
      this.drawFloorOverlay();
    } else {
      this.drawOtherOverlay();
    }
    this.addTable = 'back';
  } // drawOverlayAt

  /** `draw_other_overlay`: the tile right of an empty one, over the prince */
  drawOtherOverlay() {
    if (this.tileLeft === TILE.EMPTY) {
      this.addTable = 'overlay';
      this.drawTile2();
    } else if (this.currTile !== TILE.EMPTY && this.drawnCol > 0 &&
               this.tileToDraw(this.drawnRoom, this.drawnCol-2, this.drawnRow, TILE.EMPTY).tile === TILE.EMPTY) {
      this.addTable = 'overlay';
      this.drawTile2();
      this.addTable = 'back';
      this.drawTile2();
    }
    this.addTable = 'back';
  } // drawOtherOverlay

  /** `draw_floor_overlay`: the left edge of the floor the prince climbs onto, over him */
  drawFloorOverlay() {
    if (this.tileLeft !== TILE.EMPTY) {
      return;
    }
    var tile = this.currTile;
    if (tile === TILE.FLOOR || tile === TILE.PILLAR || tile === TILE.STUCK || tile === TILE.TORCH) {
      var frame = this.kid ? this.kid.frame : 0;
      if (frame >= 137 && frame <= 144) {
        this.add('overlay', this.chtabs.environment, RoomRenderer.FLOOR_LEFT_OVERLAY[frame-137], this.drawXh, 0,
                 (tile === TILE.STUCK ? 1 : 0)+this.drawMainY, BLIT.TRANSPARENT);
      }
      this.addTable = 'overlay';
      this.drawTileBottom(false);
      this.addTable = 'back';
    } else {
      this.drawOtherOverlay();
    }
  } // drawFloorOverlay

  canSeeBottomLeft() {
    return this.currTile === TILE.EMPTY || this.currTile === TILE.BIGPILLAR_TOP ||
      this.currTile === TILE.DOORTOP || this.currTile === TILE.LATTICE_DOWN;
  } // canSeeBottomLeft

  drawTileFloorRight() {
    if (!this.canSeeBottomLeft()) {
      return;
    }
    this.drawTileTopRight();
    if (TILE_PIECES[this.tileLeft].floorRight === 0) {
      return;
    }
    // the right part of the floor to the left, in black — the shadow under the floor
    this.addBack(this.chtabs.environment, 42, this.drawXh, 0, TILE_PIECES[TILE.FLOOR].rightY+this.drawMainY, BLIT.BLACK);
  } // drawTileFloorRight

  drawTileTopRight() {
    var env = this.chtabs.environment;
    var below = this.rowBelowLeft[this.drawnCol];
    if (below.tile === TILE.DOORTOP_WITH_FLOOR || below.tile === TILE.DOORTOP) {
      if (!this.palace) {
        return;
      }
      this.addBack(env, RoomRenderer.DOORTOP_TOP[below.mod], this.drawXh, 0, this.drawBottomY, BLIT.OR);
    } else if (below.tile === TILE.WALL) {
      this.addBack(this.chtabs.wall, WALL_IMAGE.FACE_TOP, this.drawXh, 0, this.drawBottomY, BLIT.OR);
    } else {
      this.addBack(env, TILE_PIECES[below.tile].topright, this.drawXh, 0, this.drawBottomY, BLIT.OR);
    }
  } // drawTileTopRight

  drawTileAnimTopRight() {
    var below = this.rowBelowLeft[this.drawnCol];
    if ((this.currTile === TILE.EMPTY || this.currTile === TILE.BIGPILLAR_TOP || this.currTile === TILE.DOORTOP) &&
        below.tile === TILE.GATE) {
      var env = this.chtabs.environment;
      this.addBack(env, 68, this.drawXh, 0, this.drawBottomY, BLIT.MONO);   // gate top mask, black
      var mod = Math.min(below.mod, 188);
      this.addBack(env, RoomRenderer.DOOR_TOP[(mod >> 2) % 8], this.drawXh, 0, this.drawBottomY, BLIT.OR);
    }
  } // drawTileAnimTopRight

  drawTileRight() {
    var env = this.chtabs.environment;
    var pieces = TILE_PIECES[this.tileLeft];
    if (this.currTile === TILE.WALL) {
      return;
    }
    switch (this.tileLeft) {
      case TILE.EMPTY:
        if (this.modLeft > 3) {
          return;
        }
        this.addBack(env, RoomRenderer.BLUELINE_1[this.modLeft], this.drawXh, 0,
                     RoomRenderer.BLUELINE_Y[this.modLeft]+this.drawMainY, BLIT.OR);
        break;
      case TILE.FLOOR: {
        this.addCurrent(env, 42, this.drawXh, 0, pieces.rightY+this.drawMainY, BLIT.TRANSPARENT);
        var num = this.modLeft > 3 ? 0 : this.modLeft;
        if (num === this.palace) {
          return;
        }
        this.addBack(env, RoomRenderer.BLUELINE_3[num], this.drawXh, 0, this.drawMainY-20, BLIT.COPY);
        break;
      }
      case TILE.DOORTOP_WITH_FLOOR:
      case TILE.DOORTOP:
        if (!this.palace) {
          return;
        }
        this.addBack(env, RoomRenderer.DOORTOP_BOTTOM[this.modLeft], this.drawXh, 0, pieces.rightY+this.drawMainY, BLIT.OR);
        break;
      case TILE.WALL:
        if (this.palace && (this.modLeft & 0x80) === 0) {
          this.addBack(env, 84, this.drawXh+3, 0, this.drawMainY-27, BLIT.COPY);   // wall stripe
        }
        this.addBack(this.chtabs.wall, WALL_IMAGE.FACE_MAIN, this.drawXh, 0, pieces.rightY+this.drawMainY, BLIT.OR);
        break;
      default: {
        var id = pieces.right;
        if (id) {
          var blit = BLIT.OR;
          if (this.tileLeft === TILE.STUCK) {
            blit = BLIT.TRANSPARENT;
            if (this.currTile === TILE.EMPTY || this.currTile === TILE.STUCK || !tileIsFloor(this.currTile)) {
              id = 42;   // plain floor right part
            }
          }
          this.addBack(env, id, this.drawXh, 0, pieces.rightY+this.drawMainY, blit);
        }
        if (this.palace) {
          this.addBack(env, pieces.stripe, this.drawXh, 0, this.drawMainY-27, BLIT.OR);
        }
        if (this.tileLeft === TILE.TORCH || this.tileLeft === TILE.TORCH_WITH_DEBRIS) {
          this.addBack(env, 146, this.drawXh, 0, this.drawBottomY-28, BLIT.COPY);   // torch base
        }
        break;
      }
    }
  } // drawTileRight

  spikeFrame(mod) {
    return (mod & 0x80) ? 5 : mod;
  } // spikeFrame

  looseFrame(mod) {
    if (mod & 0x80) {
      mod &= 0x7F;
      if (mod > 10) {
        return 1;
      }
    }
    return mod;
  } // looseFrame

  drawTileAnimRight() {
    var env = this.chtabs.environment;
    switch (this.tileLeft) {
      case TILE.SPIKE:
        this.addBack(env, RoomRenderer.SPIKES_RIGHT[this.spikeFrame(this.modLeft)], this.drawXh, 0, this.drawMainY-7, BLIT.TRANSPARENT);
        break;
      case TILE.GATE:
        this.drawGateBack();
        break;
      case TILE.LOOSE:
        this.addBack(env, RoomRenderer.LOOSE_RIGHT[this.looseFrame(this.modLeft)], this.drawXh, 0, this.drawBottomY-1, BLIT.OR);
        break;
      case TILE.LEVEL_DOOR_LEFT:
        this.drawLevelDoor();
        break;
      case TILE.TORCH:
      case TILE.TORCH_WITH_DEBRIS:
        if (this.modLeft < 9) {
          // images 1..9 of the flame set are the flames
          this.addBack(this.chtabs.flame, this.modLeft+1, this.drawXh+1, 0, this.drawMainY-40, BLIT.COPY);
        }
        break;
    }
  } // drawTileAnimRight

  /**
   * @param {boolean} alsoFore - Repeat the piece in the foreground (used
   *        when redrawing the row above a moving character).
   */
  drawTileBottom(alsoFore) {
    var id = 0;
    var blit = BLIT.COPY;
    var chtab = this.chtabs.environment;
    switch (this.currTile) {
      case TILE.WALL:
        if (!this.palace) {
          id = RoomRenderer.WALL_BOTTOM[this.currMod & 0x7F];
        }
        chtab = this.chtabs.wall;
        break;
      case TILE.DOORTOP:
        blit = BLIT.OR;
        id = TILE_PIECES[this.currTile].bottom;
        break;
      default:
        id = TILE_PIECES[this.currTile].bottom;
        break;
    }
    if (this.addCurrent(chtab, id, this.drawXh, 0, this.drawBottomY, blit) && alsoFore) {
      this.addFore(chtab, id, this.drawXh, 0, this.drawBottomY, blit);
    }
    if (chtab === this.chtabs.wall) {
      this.wallPattern(0, 'back');
    }
  } // drawTileBottom

  drawLoose() {
    if (this.currTile === TILE.LOOSE) {
      var id = RoomRenderer.LOOSE_BOTTOM[this.looseFrame(this.currMod)];
      this.addBack(this.chtabs.environment, id, this.drawXh, 0, this.drawBottomY, BLIT.COPY);
      this.addFore(this.chtabs.environment, id, this.drawXh, 0, this.drawBottomY, BLIT.COPY);
    }
  } // drawLoose

  drawTileBase() {
    var id;
    var yBottom = this.drawMainY;
    if (this.tileLeft === TILE.LATTICE_DOWN && this.currTile === TILE.DOORTOP) {
      id = 6;   // lattice with door top
      yBottom += 3;
    } else if (this.currTile === TILE.LOOSE) {
      id = RoomRenderer.LOOSE_LEFT[this.looseFrame(this.currMod)];
    } else if (this.currTile === TILE.OPENER && this.tileLeft === TILE.EMPTY && !this.palace) {
      id = 148;   // left half of an open button with nothing to its left
    } else {
      id = TILE_PIECES[this.currTile].base;
    }
    this.addCurrent(this.chtabs.environment, id, this.drawXh, 0, TILE_PIECES[this.currTile].baseY+yBottom, BLIT.TRANSPARENT);
  } // drawTileBase

  drawTileAnim() {
    var env = this.chtabs.environment;
    var flame = this.chtabs.flame;
    switch (this.currTile) {
      case TILE.SPIKE:
        this.addCurrent(env, RoomRenderer.SPIKES_LEFT[this.spikeFrame(this.currMod)], this.drawXh, 0, this.drawMainY-2, BLIT.TRANSPARENT);
        break;
      case TILE.POTION: {
        var potSize = 0;
        var color = 12;   // red
        switch ((this.currMod & 0xF8) >> 3) {
          case 0:   // empty
            return;
          case 5:   // hurt
          case 6:   // open
            color = 9;   // blue
            break;
          case 3:   // slow fall
          case 4:   // upside down
            color = 10;   // green
            potSize = 1;
            break;
          case 2:   // life
            potSize = 1;
            break;
        }
        var y = this.drawMainY-(potSize << 2)-14;
        this.addBack(flame, 23, this.drawXh+3, 1, y, BLIT.MONO);   // bubble mask, black
        this.addFore(flame, RoomRenderer.POTION_BUBBLE[this.currMod & 7], this.drawXh+3, 1, y, BLIT.MONO+color);
        break;
      }
      case TILE.SWORD:
        this.addMid(flame, (this.currMod === 1 ? 1 : 0)+10, this.drawXh, 0, this.drawMainY-3, BLIT.TRANSPARENT);
        break;
      case TILE.CHOMPER: {
        var num = RoomRenderer.CHOMPER_FRAME[Math.min(this.currMod & 0x7F, 6)];
        this.addBack(env, RoomRenderer.CHOMPER_BOTTOM[num], this.drawXh, 0, this.drawMainY, BLIT.TRANSPARENT);
        if (this.currMod & 0x80) {   // blood
          this.addBack(env, num+114, this.drawXh+1, 4, this.drawMainY-6, BLIT.MONO+12);
        }
        this.addBack(env, RoomRenderer.CHOMPER_TOP[num], this.drawXh, 0, this.drawMainY-RoomRenderer.CHOMPER_Y[num], BLIT.TRANSPARENT);
        break;
      }
    }
  } // drawTileAnim

  drawTileFore() {
    var env = this.chtabs.environment;
    var kid = this.kid;
    if (this.tileLeft === TILE.GATE && kid && kid.row === this.drawnRow && kid.col === this.drawnCol-1 &&
        kid.room !== this.roomR) {
      this.drawGateFore();   // the prince stands in the gate: its bars go in front of him
    }
    switch (this.currTile) {
      case TILE.SPIKE:
        this.addFore(env, RoomRenderer.SPIKES_FORE[this.spikeFrame(this.currMod)], this.drawXh, 0, this.drawMainY-2, BLIT.TRANSPARENT);
        break;
      case TILE.CHOMPER: {
        var num = RoomRenderer.CHOMPER_FRAME[Math.min(this.currMod & 0x7F, 6)];
        this.addFore(env, RoomRenderer.CHOMPER_FORE[num], this.drawXh, 0, this.drawMainY, BLIT.TRANSPARENT);
        if (this.currMod & 0x80) {
          this.addFore(env, num+119, this.drawXh+1, 4, this.drawMainY-6, BLIT.MONO+12);
        }
        break;
      }
      case TILE.WALL:
        if (!this.palace) {
          this.addFore(this.chtabs.wall, RoomRenderer.WALL_MAIN[this.currMod & 0x7F], this.drawXh, 0, this.drawMainY, BLIT.COPY);
        }
        this.wallPattern(1, 'fore');
        break;
      default: {
        var pieces = TILE_PIECES[this.currTile];
        var id = pieces.fore;
        if (id === 0) {
          return;
        }
        if (this.currTile === TILE.POTION) {
          var potionType = (this.currMod & 0xF8) >> 3;
          if (potionType < 5 && potionType >= 2) {
            id = 13;   // the large pot; 12 is the small one
          }
        }
        var xh = pieces.foreX+this.drawXh;
        var yBottom = pieces.foreY+this.drawMainY;
        if (this.currTile === TILE.POTION) {
          if (this.palace) {
            id += 2;   // potions look different in the palace
          }
          this.addFore(this.chtabs.flame, id, xh, 6, yBottom, BLIT.TRANSPARENT);
        } else if ((this.currTile === TILE.PILLAR && !this.palace) ||
                   (this.currTile >= TILE.LATTICE_SMALL && this.currTile < TILE.TORCH_WITH_DEBRIS)) {
          this.addFore(env, id, xh, 0, yBottom, BLIT.COPY);
        } else {
          this.addFore(env, id, xh, 0, yBottom, BLIT.TRANSPARENT);
        }
        break;
      }
    }
  } // drawTileFore

  // --------------------------------------------------------- gates and doors

  drawGateBack() {
    var env = this.chtabs.environment;
    var gateTopY = this.drawBottomY-62;
    var openness = (Math.min(this.modLeft, 188) >> 2)+1;
    var gateBottomY = this.drawMainY-openness;
    if (gateBottomY+12 < this.drawMainY) {
      this.addBack(env, 50, this.drawXh, 0, gateBottomY, BLIT.COPY);   // gate bottom with the floor part
    } else {
      // ★ the original redraws the floor part without transparency here and
      // then repairs what that erased — kept as is, bug included (no FIX_*)
      this.addBack(env, TILE_PIECES[TILE.GATE].right, this.drawXh, 0, TILE_PIECES[TILE.GATE].rightY+this.drawMainY, BLIT.COPY);
      if (this.canSeeBottomLeft()) {
        this.drawTileTopRight();
      }
      this.drawTileBottom(false);
      this.drawLoose();
      this.drawTileBase();
      this.addBack(env, 51, this.drawXh, 0, gateBottomY-2, BLIT.TRANSPARENT);   // gate bottom
    }
    var yBottom = gateBottomY-12;
    if (yBottom < 192) {
      for (; yBottom >= 0 && yBottom > 7 && yBottom-7 > gateTopY; yBottom -= 8) {
        this.addBack(env, 52, this.drawXh, 0, yBottom, BLIT.COPY);   // an 8-pixel slice of the gate
      }
    }
    var gateFrame = yBottom-gateTopY+1;
    if (gateFrame > 0 && gateFrame < 9) {
      this.addBack(env, RoomRenderer.DOOR_SLICE[gateFrame], this.drawXh, 0, yBottom, BLIT.COPY);
    }
  } // drawGateBack

  /** `draw_gate_fore`: the bars of a gate over the prince standing in it */
  drawGateFore() {
    var env = this.chtabs.environment;
    var gateTopY = this.drawBottomY-62;
    var openness = (Math.min(this.modLeft, 188) >> 2)+1;
    var gateBottomY = this.drawMainY-openness;
    this.addFore(env, 51, this.drawXh, 0, gateBottomY-2, BLIT.TRANSPARENT);   // gate bottom
    var yBottom = gateBottomY-12;
    if (yBottom < 192) {
      for (; yBottom >= 0 && yBottom > 7 && yBottom-7 > gateTopY; yBottom -= 8) {
        this.addFore(env, 52, this.drawXh, 0, yBottom, BLIT.TRANSPARENT);   // an 8-pixel slice
      }
    }
  } // drawGateFore

  drawLevelDoor() {
    var env = this.chtabs.environment;
    var yBottom = this.drawMainY-13;
    // the clip box of the prince climbing the stairs (`clip_char`)
    this.leveldoorRight = (this.drawXh << 3)+48+(this.palace ? 8 : 0);
    this.addBack(env, 99, this.drawXh+1, 0, yBottom, BLIT.COPY);   // the bottom of the stairs
    if (this.modLeft) {
      if (this.level.startRoom !== this.drawnRoom) {
        this.addBack(env, 144, this.drawXh+1, 0, yBottom-4, BLIT.COPY);   // the stairs
      } else {
        var width = this.palace ? 48 : 39;
        var xLow = this.palace ? 0 : 2;   // the dungeon door sits 2 pixels to the right
        this.addWipe(0, 8*(this.drawXh+1)+xLow, yBottom-4, 45, width, 0);
      }
    }
    var doorBottom = yBottom-(this.modLeft & 3)-48;
    var y = yBottom-this.modLeft;
    do {
      this.addBack(env, 33, this.drawXh+1, 0, doorBottom, BLIT.COPY);   // a slice of the door
      if (y > doorBottom) {
        doorBottom += 4;
      } else {
        break;
      }
    } while (true);
    this.leveldoorYBottom = doorBottom;
    this.addBack(env, 34, this.drawXh+1, 0, this.drawMainY-64, BLIT.COPY);   // the top of the door
  } // drawLevelDoor

  // ------------------------------------------------------------ wall pattern

  /**
   * The colours of the bricks of a palace room, drawn from the generator
   * seeded with the room number (SDLPoP `seg000.c`, `gen_palace_wall_colors`).
   */
  genPalaceWallColors() {
    var random = new PoPRandom(this.drawnRoom);
    random.next(1);
    for (var row = 0; row < 3; row++) {
      for (var subrow = 0; subrow < 4; subrow++) {
        var base = (subrow % 2) ? 0x61 : 0x66;
        var prev = -1;
        for (var column = 0; column <= 10; column++) {
          var color;
          do {
            color = base+random.next(3);
          } while (color === prev);
          this.palaceWallColors[44*row+11*subrow+column] = color;
          prev = color;
        }
      }
    }
  } // genPalaceWallColors

  /**
   * The bricks and marks of a wall tile, seeded with the tile's place so the
   * pattern never changes (`wall_pattern`).
   * @param {number} part - 0 the base line, 1 the whole face.
   * @param {string} table - 'back' or 'fore'.
   */
  wallPattern(part, table) {
    var savedTable = this.addTable;
    this.addTable = table;
    var wall = this.chtabs.wall;
    var random = this.random;
    random.seed = (this.drawnRoom+this.drawnRow*10+this.drawnCol) >>> 0;
    random.next(1);
    var layer = table === 'fore' ? 1 : 0;
    var xh = this.drawXh;
    var colors = this.palaceWallColors;
    var row = this.drawnRow;
    var col = this.drawnCol;

    if (this.palace) {
      if (part) {
        this.addWipe(layer, 8*xh,     this.drawMainY-40, 20, 32, colors[44*row+col]);
        this.addWipe(layer, 8*xh,     this.drawMainY-19, 21, 16, colors[44*row+11+col]);
        this.addWipe(layer, 8*(xh+2), this.drawMainY-19, 21, 16, colors[44*row+12+col]);
        this.addWipe(layer, 8*xh,     this.drawMainY,    19,  8, colors[44*row+22+col]);
        this.addWipe(layer, 8*(xh+1), this.drawMainY,    19, 24, colors[44*row+23+col]);
        this.addCurrent(wall, random.next(2)+3,  xh+3, 0, this.drawMainY-53, BLIT.MONO+6);
        this.addCurrent(wall, random.next(2)+6,  xh,   0, this.drawMainY-34, BLIT.MONO+6);
        this.addCurrent(wall, random.next(2)+9,  xh,   0, this.drawMainY-13, BLIT.MONO+6);
        this.addCurrent(wall, random.next(2)+12, xh,   0, this.drawMainY,    BLIT.MONO+6);
      }
      this.addWipe(layer, 8*xh, this.drawBottomY, 3, 32, colors[44*row+33+col]);
      this.addCurrent(wall, random.next(2)+15, xh, 0, this.drawBottomY, BLIT.MONO+6);
    } else {
      var middleDivider = random.next(1);         // 0 broad, 1 narrow
      var middleOffset = random.next(4);
      var bottomDivider = random.next(1);
      var bottomOffset = random.next(4);
      var join = this.currMod & 0x7F;
      switch (join) {
        case WALL_JOIN.WWW:
          if (part) {
            if (random.next(4) === 0) {
              this.addCurrent(wall, WALL_IMAGE.RANDOM_BLOCK, xh, 0, this.drawBottomY-42, BLIT.COPY);
            }
            this.addCurrent(wall, WALL_IMAGE.DIVIDER1+middleDivider, xh+1, middleOffset, this.drawBottomY-21, BLIT.TRANSPARENT);
          }
          this.addCurrent(wall, WALL_IMAGE.DIVIDER1+bottomDivider, xh, bottomOffset, this.drawBottomY, BLIT.TRANSPARENT);
          if (part) {
            if (random.next(4) === 0) {
              this.drawRightMark(random.next(3), middleOffset);
            }
            if (random.next(4) === 0) {
              this.drawLeftMark(random.next(4), middleOffset-middleDivider, bottomOffset-bottomDivider);
            }
          }
          break;
        case WALL_JOIN.SWS:
          if (part) {
            if (random.next(6) === 0) {
              this.drawLeftMark(random.next(1), middleOffset-middleDivider, bottomOffset-bottomDivider);
            }
          }
          break;
        case WALL_JOIN.SWW:
          if (part) {
            if (random.next(4) === 0) {
              this.addCurrent(wall, WALL_IMAGE.RANDOM_BLOCK, xh, 0, this.drawBottomY-42, BLIT.COPY);
            }
            this.addCurrent(wall, WALL_IMAGE.DIVIDER1+middleDivider, xh+1, middleOffset, this.drawBottomY-21, BLIT.TRANSPARENT);
            if (random.next(4) === 0) {
              this.drawRightMark(random.next(3), middleOffset);
            }
            if (random.next(4) === 0) {
              this.drawLeftMark(random.next(3), middleOffset-middleDivider, bottomOffset-bottomDivider);
            }
          }
          break;
        case WALL_JOIN.WWS:
          if (part) {
            this.addCurrent(wall, WALL_IMAGE.DIVIDER1+middleDivider, xh+1, middleOffset, this.drawBottomY-21, BLIT.TRANSPARENT);
          }
          this.addCurrent(wall, WALL_IMAGE.DIVIDER1+bottomDivider, xh, bottomOffset, this.drawBottomY, BLIT.TRANSPARENT);
          if (part) {
            if (random.next(4) === 0) {
              this.drawRightMark(random.next(1)+2, middleOffset);
            }
            if (random.next(4) === 0) {
              this.drawLeftMark(random.next(4), middleOffset-middleDivider, bottomOffset-bottomDivider);
            }
          }
          break;
      }
    }
    this.addTable = savedTable;
  } // wallPattern

  drawLeftMark(variant, middle, bottom) {
    var yOffsets = [58, 41, 37, 20, 16];
    var image = (variant % 2) ? WALL_IMAGE.MARK_BL : WALL_IMAGE.MARK_TL;
    var xl = 0;
    if (variant > 3) {
      xl = bottom+6;
    } else if (variant > 1) {
      xl = middle+6;
    }
    this.addCurrent(this.chtabs.wall, image, this.drawXh+((variant === 2 || variant === 3) ? 1 : 0), xl,
                    this.drawBottomY-yOffsets[variant], BLIT.TRANSPARENT);
  } // drawLeftMark

  drawRightMark(variant, middle) {
    var yOffsets = [52, 42, 31, 21];
    var image = (variant % 2) ? WALL_IMAGE.MARK_BR : WALL_IMAGE.MARK_TR;
    var xl = variant < 2 ? 24 : middle-3;
    this.addCurrent(this.chtabs.wall, image, this.drawXh+(variant > 1 ? 1 : 0), xl,
                    this.drawBottomY-yOffsets[variant], BLIT.TRANSPARENT);
  } // drawRightMark

  // ------------------------------------------------------------- characters

  /**
   * Draws a character (or any object of the middle list) straight onto the
   * target: transparent copy, mirrored when it faces right, cut to its clip
   * box — `draw_mid` for an entry of the object table. Called after
   * `drawRoom()` and before the foreground... which this first version
   * `drawRoomBackground()` and before `paintForeground()`, so the pillars
   * and gate posts of the foreground list cover him as in the original.
   * @param {Chtab} chtab - The sprite set.
   * @param {Object} object - `{image (1-based), x, yBottom, flip, clip:{left,right,top,bottom}}`
   *        as `PrinceLogic.kidObject()` gives it; x is the left edge before
   *        the mirror shift.
   * @param {VGAVideoRAM} target
   */
  drawObject(chtab, object, target) {
    var image = chtab.image(object.image);
    if (!image) {
      return;
    }
    var x = object.x;
    if (object.flip) {
      x -= image.width;
    }
    var y = object.yBottom-image.height+1;
    var clip = object.clip;
    // the part of the image inside the clip box
    var left = Math.max(x, clip.left), right = Math.min(x+image.width, clip.right);
    var top = Math.max(y, clip.top), bottom = Math.min(y+image.height, clip.bottom);
    if (left >= right || top >= bottom) {
      return;
    }
    var rect = {x: 0, y: top-y, width: right-left, height: bottom-top};
    // the source column of the visible part; mirrored images count from the other side
    rect.x = object.flip ? (x+image.width-right) : (left-x);
    target.blit(image, left, top, {transparent: chtab.transparent, flipX: object.flip, rect: rect});
  } // drawObject

  /**
   * A falling loose floor (`draw_objtable_item`, type 0x80): the three
   * pieces of the falling frame of the floor — left part, front face, right
   * part on the next column — straight onto the target, unclipped.
   * @param {number} xh - x in 8-pixel columns (`curmob.xh`).
   * @param {number} yBottom - The bottom line in the drawn room.
   * @param {VGAVideoRAM} target
   */
  drawLooseMob(xh, yBottom, target) {
    var env = this.chtabs.environment;
    var frame = 10;
    var left = env.image(RoomRenderer.LOOSE_LEFT[frame]);
    var bottom = env.image(RoomRenderer.LOOSE_BOTTOM[frame]);
    var right = env.image(RoomRenderer.LOOSE_RIGHT[frame]);
    if (left) {
      target.blit(left, xh*8, yBottom-3-left.height+1, {transparent: env.transparent});
    }
    if (bottom) {
      target.blit(bottom, xh*8, yBottom-bottom.height+1);
    }
    if (right) {
      target.blit(right, (xh+4)*8, yBottom-1-right.height+1, {transparent: env.transparent});
    }
  } // drawLooseMob

  /**
   * The hit points in the bottom line (`draw_kid_hp`): full triangles for
   * the points left, empty ones up to the maximum; images 217 and 218 of
   * the prince's set, 7 pixels apart at y 194.
   */
  drawHitPoints(kidChtab, current, maximum, target) {
    var i;
    for (i = current; i < maximum; i++) {
      var empty = kidChtab.image(218);
      if (empty) {
        target.blit(empty, i*7, 194);
      }
    }
    for (i = 0; i < current; i++) {
      var full = kidChtab.image(217);
      if (full) {
        target.blit(full, i*7, 194);
      }
    }
  } // drawHitPoints

  // ---------------------------------------------------------------- painting

  /**
   * Paints the collected lists behind the characters: wipes of layer 0,
   * the background, the middle, wipes of layer 1 (`draw_tables` up to the
   * foreground).
   * @param {VGAVideoRAM} target
   */
  paintBackground(target) {
    var i;
    this.target = target;
    for (i = 0; i < this.wipes.length; i++) {
      if (this.wipes[i].layer === 0) { this.paintWipe(this.wipes[i]); }
    }
    for (i = 0; i < this.back.length; i++) { this.paintEntry(this.back[i]); }
    for (i = 0; i < this.mid.length; i++) { this.paintEntry(this.mid[i]); }
    for (i = 0; i < this.wipes.length; i++) {
      if (this.wipes[i].layer === 1) { this.paintWipe(this.wipes[i]); }
    }
  } // paintBackground

  /**
   * Paints the foreground list — pillars, gate posts, the fronts of
   * chompers and spikes — over whatever is on the target, i.e. in front
   * of the characters drawn since {@link RoomRenderer#paintBackground}.
   * @param {VGAVideoRAM} target
   */
  paintForeground(target) {
    this.target = target;
    for (var i = 0; i < this.fore.length; i++) { this.paintEntry(this.fore[i]); }
  } // paintForeground

  /**
   * Paints the overlay entries of the tiles drawn before or after a tile
   * in the room's redraw order (rows bottom up, columns left to right) —
   * the ones before go under the prince, the ones after over him.
   * @param {number} tilepos - The prince's tile (`obj_tilepos`), 30 = before all.
   * @param {boolean} after - Entries of tiles at or after his, or the ones before.
   * @param {VGAVideoRAM} target
   */
  paintOverlays(tilepos, after, target) {
    this.target = target;
    var order = function(t) { return t >= 30 ? -1 : (2-Math.floor(t/10))*10+(t % 10); };
    var pivot = order(tilepos);
    for (var i = 0; i < this.overlay.length; i++) {
      var entry = this.overlay[i];
      if ((order(entry.tilepos) >= pivot) === after) {
        this.paintEntry(entry);
      }
    }
  } // paintOverlays

  /** both halves at once (`draw_tables`) */
  paintTables() {
    this.paintBackground(this.target);
    this.paintForeground(this.target);
  } // paintTables

  paintWipe(wipe) {
    this.target.fillRect(wipe.left, wipe.top, wipe.width, wipe.height, wipe.color);
  } // paintWipe

  /**
   * One image onto the target with its blit mode.
   */
  paintEntry(entry) {
    var image = entry.image;
    var transparent = entry.chtab.transparent;
    var blit = entry.blit;
    if (blit === BLIT.COPY) {
      this.target.blit(image, entry.x, entry.y);
    } else if (blit === BLIT.TRANSPARENT || blit === BLIT.OR || blit === BLIT.XOR) {
      // ★ OR and XOR are taken as transparent copies until P2 measures
      // them against the original; where the ground is black they are equal
      this.target.blit(image, entry.x, entry.y, {transparent: transparent});
    } else if (blit === BLIT.BLACK) {
      this.paintMono(image, entry.x, entry.y, transparent, 0);
    } else if ((blit & 0xF0) === BLIT.MONO) {
      this.paintMono(image, entry.x, entry.y, transparent, blit & 0x0F);
    } else {
      this.target.blit(image, entry.x, entry.y, {transparent: transparent});
    }
  } // paintEntry

  /**
   * The shape of an image in one colour — an absolute palette register,
   * not one of the set's row.
   */
  paintMono(image, x, y, transparent, color) {
    var target = this.target;
    for (var line = 0; line < image.height; line++) {
      var ty = y+line;
      if (ty < 0 || ty >= target.height) {
        continue;
      }
      for (var col = 0; col < image.width; col++) {
        if (image.bytes[line*image.width+col] !== transparent) {
          target.setPixel(x+col, ty, color);
        }
      }
    }
  } // paintMono

} // RoomRenderer

// frame tables of the original (seg008.c), all image numbers 1-based
RoomRenderer.DOORTOP_TOP = [0, 81, 83, 0];
RoomRenderer.DOOR_TOP = [60, 61, 62, 63, 64, 65, 66, 67];
RoomRenderer.BLUELINE_1 = [0, 124, 125, 126];
RoomRenderer.BLUELINE_Y = [0, -20, -20, 0];
RoomRenderer.BLUELINE_3 = [44, 44, 45, 45];
RoomRenderer.DOORTOP_BOTTOM = [78, 80, 82, 0];
RoomRenderer.SPIKES_RIGHT = [0, 134, 135, 136, 137, 138, 137, 135, 134, 0];
RoomRenderer.LOOSE_RIGHT = [42, 71, 42, 72, 72, 42, 42, 42, 72, 72, 72, 0];
RoomRenderer.WALL_BOTTOM = [7, 9, 5, 3];
RoomRenderer.LOOSE_BOTTOM = [43, 73, 43, 74, 74, 43, 43, 43, 74, 74, 74, 0];
RoomRenderer.LOOSE_LEFT = [41, 69, 41, 70, 70, 41, 41, 41, 70, 70, 70, 0];
RoomRenderer.SPIKES_LEFT = [0, 128, 129, 130, 131, 132, 131, 129, 128, 0];
RoomRenderer.POTION_BUBBLE = [0, 16, 17, 18, 19, 20, 21, 22];
RoomRenderer.CHOMPER_FRAME = [3, 2, 0, 1, 4, 3, 3, 0];
RoomRenderer.CHOMPER_BOTTOM = [101, 102, 103, 104, 105, 0];
RoomRenderer.CHOMPER_TOP = [0, 0, 111, 112, 113, 0];
RoomRenderer.CHOMPER_Y = [0, 0, 0x25, 0x2F, 0x32];
RoomRenderer.SPIKES_FORE = [0, 139, 140, 141, 142, 143, 142, 140, 139, 0];
RoomRenderer.CHOMPER_FORE = [106, 107, 108, 109, 110, 0];
RoomRenderer.WALL_MAIN = [8, 10, 6, 4];
RoomRenderer.DOOR_SLICE = [67, 59, 58, 57, 56, 55, 54, 53, 52];
/** the left edge of a floor over the climbing prince, by frame 137..144 */
RoomRenderer.FLOOR_LEFT_OVERLAY = [32, 151, 151, 150, 150, 151, 32, 32];
