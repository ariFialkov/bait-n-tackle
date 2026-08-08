// The betting engine. Every wager is an ISOLATED bet: the payout is a
// multiplier drawn from CONFIG.PAYTABLE (whose expected value is the game
// RTP) applied to that bet's stake alone. The engine also keeps a running
// spent/earned ledger, but only for the round P/L display — the ledger
// never influences an outcome, and neither does player position or skill.
//
// The fish is chosen to *fit* the payout, not the other way around: species
// are weighted by how close their inherent value is to the drawn payout,
// then the size roll makes the displayed catch worth exactly the payout.

import { CONFIG } from './config.js';
import { speciesInTiers } from './fishdata.js';
import { clamp } from './noise.js';

export class RTPEngine {
  constructor() {
    this.reset();
  }

  reset() {
    this.spent = 0;
    this.earned = 0;
  }

  wager(amount) { this.spent += amount; }
  book(amount) { this.earned += amount; }
  netRound() { return this.earned - this.spent; }

  /** Draw a payout for `stake` from the paytable. E[payout] = RTP * stake. */
  samplePayout(stake, rng = Math.random) {
    const r = rng();
    let acc = 0;
    for (const band of CONFIG.PAYTABLE) {
      acc += band.p;
      if (r <= acc) return stake * (band.lo + rng() * (band.hi - band.lo));
    }
    const last = CONFIG.PAYTABLE[CONFIG.PAYTABLE.length - 1];
    return stake * (last.lo + rng() * (last.hi - last.lo));
  }

  /** Weighted pick of a species whose inherent value sits near `value`. */
  pickSpecies(value, minTier, maxTier, rng = Math.random) {
    const pool = speciesInTiers(minTier, maxTier);
    let totalW = 0;
    const weights = pool.map((s) => {
      const rel = Math.abs(Math.log((s.value + 0.01) / Math.max(value, 0.02)));
      const w = 1 / (0.1 + rel * rel * 4);
      totalW += w;
      return w;
    });
    let pick = rng() * totalW;
    for (let i = 0; i < pool.length; i++) {
      pick -= weights[i];
      if (pick <= 0) return pool[i];
    }
    return pool[pool.length - 1];
  }

  /**
   * Build the catch for a payout that has already been drawn.
   * Returns { species, sizeMult, kg, value } with value === payout (rounded).
   */
  describeCatch(payout, minTier, maxTier, rng = Math.random) {
    const value = Math.max(0.01, Math.round(payout * 100) / 100);
    const species = this.pickSpecies(value, minTier, maxTier, rng);
    const sizeMult = clamp(value / species.value, 0.5, 1.6);
    const kg = Math.max(0.005, species.kg * sizeMult * sizeMult);
    return { species, sizeMult, kg, value };
  }

  /** Convenience: resolve a full isolated bet in one go. */
  resolveBet(stake, minTier, maxTier, rng = Math.random) {
    return this.describeCatch(this.samplePayout(stake, rng), minTier, maxTier, rng);
  }
}
