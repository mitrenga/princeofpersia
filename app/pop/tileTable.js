// begin code

/**
 * The tile types of a level (`level.fg`, low 5 bits). Names follow the
 * common vocabulary of the level editors; SDLPoP `types.h` `enum tiles`.
 */
export const TILE = {
  EMPTY: 0, FLOOR: 1, SPIKE: 2, PILLAR: 3, GATE: 4, STUCK: 5, CLOSER: 6,
  DOORTOP_WITH_FLOOR: 7, BIGPILLAR_BOTTOM: 8, BIGPILLAR_TOP: 9, POTION: 10,
  LOOSE: 11, DOORTOP: 12, MIRROR: 13, DEBRIS: 14, OPENER: 15,
  LEVEL_DOOR_LEFT: 16, LEVEL_DOOR_RIGHT: 17, CHOMPER: 18, TORCH: 19, WALL: 20,
  SKELETON: 21, SWORD: 22, BALCONY_LEFT: 23, BALCONY_RIGHT: 24,
  LATTICE_PILLAR: 25, LATTICE_DOWN: 26, LATTICE_SMALL: 27, LATTICE_LEFT: 28,
  LATTICE_RIGHT: 29, TORCH_WITH_DEBRIS: 30
};

/**
 * What every tile type is built from: image numbers (1-based, into the
 * environment chtab; 0 = nothing) and offsets of the pieces the room drawer
 * assembles a tile of. One entry per tile type 0..30, in the order of the
 * original's table (SDLPoP `seg008.c`, `tile_table`, data:259C).
 *
 * base: the left part of the floor and what stands on it; right: the right
 * part, drawn as part of the tile to the right; stripe: the palace stripe
 * above; topright: the piece the tile below-left shows through an empty
 * tile; bottom: the floor's front face; fore: the part drawn in front of
 * the characters. `floorLeft`/`floorRight` say whether the tile has a floor
 * on that side; `*Y`/`foreX` are pixel (or 8-pixel column) offsets.
 */
const PIECE_FIELDS = ['base', 'floorLeft', 'baseY', 'right', 'floorRight', 'rightY',
                      'stripe', 'topright', 'bottom', 'fore', 'foreX', 'foreY'];
const PIECE_ROWS = [
  [  0, 0,   0,   0, 0, 0,   0,  0,  0,   0, 0,   0], // 0 empty
  [ 41, 1,   0,  42, 1, 2, 145,  0, 43,   0, 0,   0], // 1 floor
  [127, 1,   0, 133, 1, 2, 145,  0, 43,   0, 0,   0], // 2 spike
  [ 92, 1,   0,  93, 1, 2,   0, 94, 43,  95, 1,   0], // 3 pillar
  [ 46, 1,   0,  47, 1, 2,   0, 48, 43,  49, 3,   0], // 4 gate
  [ 41, 1,   1,  35, 1, 3, 145,  0, 36,   0, 0,   0], // 5 stuck floor (pressed button)
  [ 41, 1,   0,  42, 1, 2, 145,  0, 96,   0, 0,   0], // 6 close button
  [ 46, 1,   0,   0, 0, 2,   0,  0, 43,  49, 3,   0], // 7 door top with floor
  [ 86, 1,   0,  87, 1, 2,   0,  0, 43,  88, 1,   0], // 8 big pillar bottom
  [  0, 0,   0,  89, 0, 3,   0, 90,  0,  91, 1,   3], // 9 big pillar top
  [ 41, 1,   0,  42, 1, 2, 145,  0, 43,  12, 2,  -3], // 10 potion
  [  0, 1,   0,   0, 0, 0, 145,  0,  0,   0, 0,   0], // 11 loose floor
  [  0, 0,   0,   0, 0, 2,   0,  0, 85,  49, 3,   0], // 12 door top
  [ 75, 1,   0,  42, 1, 2,   0,  0, 43,  77, 0,   0], // 13 mirror
  [ 97, 1,   0,  98, 1, 2, 145,  0, 43, 100, 0,   0], // 14 debris
  [147, 1,   0,  42, 1, 1, 145,  0,149,   0, 0,   0], // 15 open button
  [ 41, 1,   0,  37, 0, 0,   0, 38, 43,   0, 0,   0], // 16 level door left
  [  0, 0,   0,  39, 1, 2,   0, 40, 43,   0, 0,   0], // 17 level door right
  [  0, 0,   0,  42, 1, 2, 145,  0, 43,   0, 0,   0], // 18 chomper
  [ 41, 1,   0,  42, 1, 2,   0,  0, 43,   0, 0,   0], // 19 torch
  [  0, 0,   0,   1, 1, 2,   0,  2,  0,   0, 0,   0], // 20 wall
  [ 30, 1,   0,  31, 1, 2,   0,  0, 43,   0, 0,   0], // 21 skeleton
  [ 41, 1,   0,  42, 1, 2, 145,  0, 43,   0, 0,   0], // 22 sword
  [ 41, 1,   0,  10, 0, 0,   0, 11, 43,   0, 0,   0], // 23 balcony left
  [  0, 0,   0,  12, 1, 2,   0, 13, 43,   0, 0,   0], // 24 balcony right
  [ 92, 1,   0,  42, 1, 2, 145,  0, 43,  95, 1,   0], // 25 lattice pillar
  [  1, 0,   0,   0, 0, 0,   0,  0,  2,   9, 0, -53], // 26 lattice down
  [  3, 0, -10,   0, 0, 0,   0,  0,  0,   9, 0, -53], // 27 lattice small
  [  4, 0, -10,   0, 0, 0,   0,  0,  0,   9, 0, -53], // 28 lattice left
  [  5, 0, -10,   0, 0, 0,   0,  0,  0,   9, 0, -53], // 29 lattice right
  [ 97, 1,   0,  98, 1, 2,   0,  0, 43, 100, 0,   0]  // 30 debris with torch
];

export const TILE_PIECES = PIECE_ROWS.map(function(row) {
  var piece = {};
  for (var i = 0; i < PIECE_FIELDS.length; i++) {
    piece[PIECE_FIELDS[i]] = row[i];
  }
  return piece;
});

/**
 * Whether a tile type has a floor one can stand on (SDLPoP `seg006.c`,
 * `tile_is_floor`).
 * @param {number} tile - Tile type.
 * @returns {boolean}
 */
export function tileIsFloor(tile) {
  switch (tile) {
    case TILE.EMPTY:
    case TILE.BIGPILLAR_TOP:
    case TILE.DOORTOP:
    case TILE.WALL:
    case TILE.LATTICE_DOWN:
    case TILE.LATTICE_SMALL:
    case TILE.LATTICE_LEFT:
    case TILE.LATTICE_RIGHT:
      return false;
    default:
      return true;
  }
} // tileIsFloor

/**
 * The images of the wall chtab (resource 360 of the environment DAT),
 * 1-based like everything the drawer refers to.
 */
export const WALL_IMAGE = {
  FACE_MAIN: 1, FACE_TOP: 2, CENTRE_BASE: 3, CENTRE_MAIN: 4, RIGHT_BASE: 5,
  RIGHT_MAIN: 6, SINGLE_BASE: 7, SINGLE_MAIN: 8, LEFT_BASE: 9, LEFT_MAIN: 10,
  DIVIDER1: 11, DIVIDER2: 12, RANDOM_BLOCK: 13,
  MARK_TL: 14, MARK_BL: 15, MARK_TR: 16, MARK_BR: 17
};

/**
 * Wall modifiers after `alterMods`: bit 0 = a wall to the right, bit 1 = a
 * wall to the left (the "S" and "W" of the original's names read
 * left-centre-right: SWS stands alone, WWW is joined on both sides).
 */
export const WALL_JOIN = {SWS: 0, SWW: 1, WWS: 2, WWW: 3};
