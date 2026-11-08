// begin code

/**
 * The pseudo-random generator of the original: a 32-bit linear congruential
 * generator, `seed = seed*214013 + 2531011`, of which the upper 16 bits are
 * taken modulo `max+1`. The game reseeds it deliberately — the wall pattern
 * of a tile is seeded with room, row and column, so every visit draws the
 * same bricks — which is why the generator has to be reproduced exactly and
 * not replaced by any other PRNG (SDLPoP `seg009.c`, `prandom`).
 *
 * It is also the seeded, substitutable source of randomness the remake uses
 * everywhere else (R-009): a run is repeatable from its seed.
 */
export class PoPRandom {

  /**
   * @param {number} seed - The initial state, any 32-bit value.
   */
  constructor(seed) {
    /** the current state, unsigned 32 bits */
    this.seed = seed >>> 0;
  } // constructor

  /**
   * The next number in 0..max, advancing the state.
   * @param {number} max - The largest value wanted (inclusive).
   * @returns {number} 0..max.
   */
  next(max) {
    this.seed = (Math.imul(this.seed, 214013) + 2531011) >>> 0;
    return (this.seed >>> 16) % (max+1);
  } // next

} // PoPRandom
