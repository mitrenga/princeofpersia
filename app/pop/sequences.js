// begin code

/**
 * The animation "bytecode" of the original. Every character is driven by a
 * sequence: a stream of frame numbers with instructions between them —
 * move by dx/dy, set the action, jump to another sequence, play a sound.
 * One frame number is consumed per game frame (1/12 s); everything before
 * it runs at once. The table itself is data of the original program
 * (2282 bytes at data:196E of PRINCE.EXE 1.0), unpacked by
 * `tools/dumpdat.mjs` into data/exe/tables.json together with the table of
 * sequence start addresses; SDLPoP `seqtbl.c` documents it and
 * `doc/internals_sequence-table.txt` reads it out.
 */

/** the instruction bytes; anything below 0xF1 is a frame number */
export const SEQ_OP = {
  END_LEVEL: 0xF1, SOUND: 0xF2, GET_ITEM: 0xF3, KNOCK_DOWN: 0xF4, KNOCK_UP: 0xF5,
  DIE: 0xF6, JMP_IF_FEATHER: 0xF7, SET_FALL: 0xF8, ACTION: 0xF9, DY: 0xFA,
  DX: 0xFB, DOWN: 0xFC, UP: 0xFD, FLIP: 0xFE, JMP: 0xFF
};

/** the sounds a sequence names (`snd(...)`) */
export const SEQ_SOUND = {SILENT: 0, FOOTSTEP: 1, BUMP: 2, DRINK: 3, LEVEL: 4};

/**
 * The sequences by number — the index into the table of start addresses
 * (SDLPoP `enum seqids`; the numbers are the original's).
 */
export const SEQ = {
  START_RUN: 1, STAND: 2, STANDING_JUMP: 3, RUN_JUMP: 4, TURN: 5, RUN_TURN: 6, FALL: 7,
  JUMP_UP_AND_GRAB_STRAIGHT: 8, GRAB_WHILE_JUMPING: 9, CLIMB_UP: 10, RELEASE_LEDGE_AND_LAND: 11,
  STOP_RUN: 13, JUMP_UP_INTO_CEILING: 14, GRAB_LEDGE_MIDAIR: 15, JUMP_UP_AND_GRAB: 16,
  SOFT_LAND: 17, FALL_AFTER_STANDING_JUMP: 18, FALL_19: 19, MEDIUM_LAND: 20,
  FALL_AFTER_RUNNING_JUMP: 21, CRUSHED: 22, RELEASE_LEDGE_AND_FALL: 23,
  JUMP_UP_AND_GRAB_FORWARD: 24, HANG_AGAINST_WALL: 25, CROUCH_WHILE_RUNNING: 26,
  JUMP_UP_WITH_NOTHING_ABOVE: 28,
  SAFE_STEP_1: 29,   // 29..42: step 1..14 pixels
  SAFE_STEP_11: 39, START_RUN_AFTER_TURN: 43, STEP_ON_EDGE: 44, BUMPFALL: 45, HARDBUMP: 46,
  BUMP: 47, STAND_UP_FROM_CROUCH: 49, CROUCH: 50, SPIKED: 51, LOOSE_FLOOR_FELL_ON_KID: 52,
  CHOMPED: 54, DRAW_SWORD: 55, GUARD_FORWARD_WITH_SWORD: 56, BACK_WITH_SWORD: 57,
  GUARD_STRIKE: 58, TURN_WITH_SWORD: 60, PARRY_AFTER_STRIKE: 61, PARRY: 62,
  GUARD_ACTIVE_AFTER_FALL: 63, PUSHED_BACK_WITH_SWORD: 64, BUMP_FORWARD_WITH_SWORD: 65,
  STRIKE_AFTER_PARRY: 66, CLIMB_DOWN: 68, ATTACK_WAS_PARRIED: 69, GO_UP_ON_LEVEL_DOOR: 70,
  DYING: 71, CLIMB_UP_TO_CLOSED_GATE: 73, HIT_BY_SWORD: 74, STRIKE: 75,
  GUARD_STAND_INACTIVE: 77, DRINK: 78, CROUCH_HOP: 79, STAND_FLIPPED: 80,
  KID_PUSHED_OFF_LEDGE: 81, GUARD_PUSHED_OFF_LEDGE: 82, GUARD_FALL: 83, RUN: 84,
  STABBED_TO_DEATH: 85, FORWARD_WITH_SWORD: 86, GUARD_BECOME_INACTIVE: 87, SKEL_WAKE_UP: 88,
  TURN_DRAW_SWORD: 89, EN_GARDE: 90, GET_SWORD: 91, PUT_SWORD_AWAY: 92, PUT_SWORD_AWAY_FAST: 93,
  START_FALL_IN_FRONT_OF_WALL: 104
};

export class SequenceTable {

  /**
   * @param {Uint8Array} bytes - The table as it sits in memory from `base` on.
   * @param {number} base - The address of its first byte (0x196E).
   * @param {number[]} offsets - Start address of every sequence, by SEQ number.
   */
  constructor(bytes, base, offsets) {
    this.bytes = bytes;
    this.base = base;
    this.offsets = offsets;
  } // constructor

  /**
   * One byte at an address (`*(SEQTBL_0 + addr)`).
   * @param {number} address
   * @returns {number} 0..255.
   */
  read(address) {
    var i = address-this.base;
    if (i < 0 || i >= this.bytes.length) {
      throw new Error('SequenceTable.read: '+address.toString(16)+' outside the table');
    }
    return this.bytes[i];
  } // read

  /** a 16-bit little-endian address operand */
  readWord(address) {
    return this.read(address) | (this.read(address+1) << 8);
  } // readWord

  /**
   * The start address of a sequence (`seqtbl_offsets[seq]`).
   * @param {number} seq - A SEQ number.
   * @returns {number}
   */
  offsetOf(seq) {
    return this.offsets[seq];
  } // offsetOf

  /**
   * From data/exe/tables.json.
   * @param {Object} data - The parsed file.
   * @returns {SequenceTable}
   */
  static fromData(data) {
    var s = data.seqtbl;
    var binary = atob(s.bytes);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new SequenceTable(bytes, s.base, data.seqOffsets);
  } // fromData

} // SequenceTable
