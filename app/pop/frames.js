// begin code

/**
 * The frame tables of the original: for every animation frame number the
 * image to draw, the sword image and its set, the offset of the image from
 * the character's position and the flags the physics reads (how wide the
 * character stands, whether he needs a floor). Program data of PRINCE.EXE
 * (241 frames of the prince at 0x1B9A5 of the 1.0 file, 41 of the guards,
 * 86 of the cutscenes, 51 sword positions), unpacked into
 * data/exe/tables.json; SDLPoP `seg006.c` frame_table_kid & co.
 */

/** the flag bits of a frame */
export const FRAME_FLAG = {
  /** the low 5 bits: where the weight of the character is, in pixels from his x */
  WEIGHT_X: 0x1F,
  /** collide with a 4-pixel narrower box */
  THIN: 0x20,
  /** the frame falls when nothing is under it */
  NEEDS_FLOOR: 0x40,
  /** draw one pixel to the right when facing the direction of this bit */
  EVEN_ODD_PIXEL: 0x80
};

/**
 * The frame numbers the physics refers to by name (SDLPoP `enum frame_ids`;
 * every name carries its number).
 */
export const FRAME = {
  NONE: 0, START_RUN_1: 1, START_RUN_3: 3, START_RUN_4: 4, START_RUN_5: 5, RUN_7: 7, RUN_9: 9,
  RUN_11: 11, RUN_13: 13, STAND: 15, STANDING_JUMP_7: 22, STANDING_JUMP_8: 23,
  STANDING_JUMP_9: 24, STANDING_JUMP_10: 25, STANDING_JUMP_11: 26, START_RUN_JUMP_1: 34,
  START_RUN_JUMP_6: 39, RUNNING_JUMP_1: 40, RUNNING_JUMP_4: 43, RUNNING_JUMP_5: 44,
  TURN_45: 45, TURN_48: 48, TURN_50: 50, TURN_52: 52, RUNTURN_53: 53, START_JUMP_UP_1: 67,
  JUMPHANG_70: 70, JUMPHANG_78: 78, JUMPHANG_79: 79, JUMPHANG_80: 80, HANGDROP_1: 81,
  HANGDROP_5: 85, TEST_FOOT: 86, HANGING_1: 87, HANGING_13: 99, START_FALL_1: 102,
  START_FALL_4: 105, FALL: 106, FALL_LAND_1: 107, FALL_LAND_2: 108, CROUCH: 109,
  STAND_UP_FROM_CROUCH_1: 110, STAND_UP_FROM_CROUCH_9: 118, STAND_UP_FROM_CROUCH_10: 119,
  STEPPING_1: 121, STEPPING_7: 127, STEPPING_12: 132, CLIMBING_1: 135, CLIMBING_3: 137,
  CLIMBING_6: 140, CLIMBING_7: 141, CLIMBING_10: 144, CLIMBING_11: 145, CLIMBING_14: 148,
  CLIMBING_15: 149, PARRY_150: 150, STRIKE_1: 151, STRIKE_2: 152, STRIKE_3: 153, POKING: 154,
  WALK_WITH_SWORD_157: 157, STAND_WITH_SWORD_158: 158, FIGHTING_160: 160, PARRY_161: 161,
  BLOCK_TO_STRIKE: 162, WALK_WITH_SWORD_165: 165, STAND_INACTIVE: 166, BLOCKED: 167, BACK: 168,
  BEGIN_BLOCK: 169, STAND_WITH_SWORD_170: 170, STAND_WITH_SWORD_171: 171, SPIKED: 177,
  CHOMPED: 178, DEAD: 185, DRINK_191: 191, DRINK_205: 205, EXIT_STAIRS_1: 217,
  EXIT_STAIRS_3: 219, EXIT_STAIRS_8: 224, EXIT_STAIRS_12: 228, FOUND_SWORD: 229
};

/** an empty frame — what a number outside the table gives */
const BLANK = {image: 255, sword: 0, dx: 0, dy: 0, flags: 0};

export class FrameTable {

  /**
   * @param {Array} rows - [image, sword, dx, dy, flags] per frame; dx and dy
   *        signed, the rest bytes.
   */
  constructor(rows) {
    this.frames = rows.map(function(row) {
      return {image: row[0], sword: row[1], dx: row[2], dy: row[3], flags: row[4]};
    });
  } // constructor

  /**
   * One frame; a number outside the table gives the blank frame, the way
   * SDLPoP answers (the original read whatever lay beyond).
   * @param {number} number
   * @returns {{image, sword, dx, dy, flags}}
   */
  get(number) {
    if (number >= 0 && number < this.frames.length) {
      return this.frames[number];
    }
    return BLANK;
  } // get

  get length() {
    return this.frames.length;
  } // length

} // FrameTable

/**
 * All three tables and the sword positions from data/exe/tables.json.
 * @param {Object} data - The parsed file.
 * @returns {{kid: FrameTable, guard: FrameTable, cuts: FrameTable, swords: Array}}
 */
export function frameTablesFromData(data) {
  return {
    kid: new FrameTable(data.frames.kid),
    guard: new FrameTable(data.frames.guard),
    cuts: new FrameTable(data.frames.cuts),
    swords: data.swords.map(function(row) { return {id: row[0], x: row[1], y: row[2]}; })
  };
} // frameTablesFromData
