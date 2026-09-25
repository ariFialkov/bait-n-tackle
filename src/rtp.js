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

// The paytable's chance of a multiplier of at least 1, and the expected
// multiplier over the draws below 1 — the mass a loss forfeits.
let odds = null;
export function sideBetOdds() {
  if (odds) return odds;
  let pWin = 0, lostMass = 0;
  for (const b of CONFIG.PAYTABLE) {
    const lo = b.lo, hi = b.hi;
    if (lo >= 1) { pWin += b.p; continue; }
    if (hi <= 1) { lostMass += b.p * (lo + hi) / 2; continue; }
    // The band straddles 1: split it.
    const fWin = (hi - 1) / (hi - lo);
    pWin += b.p * fWin;
    lostMass += b.p * (1 - fWin) * (lo + 1) / 2;
  }
  odds = { pWin, lostMass };
  return odds;
}

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

  /**
   * Weighted pick of a species whose inherent value sits near `value`, from
   * the pool of the water it is caught in ('fresh' | 'salt' | 'both'). The
   * water only decides which fish is shown for a value already drawn.
   */
  pickSpecies(value, minTier, maxTier, rng = Math.random, water = 'fresh') {
    const pool = speciesInTiers(minTier, maxTier, water);
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
  describeCatch(payout, minTier, maxTier, rng = Math.random, water = 'fresh') {
    const value = Math.max(0.01, Math.round(payout * 100) / 100);
    const species = this.pickSpecies(value, minTier, maxTier, rng, water);
    const sizeMult = clamp(value / species.value, 0.5, 1.6);
    const kg = Math.max(0.005, species.kg * sizeMult * sizeMult);
    return { species, sizeMult, kg, value };
  }

  /**
   * A side bet against another boat — a race, a run through the rocks, a
   * fishing match. It is a binary bet with the same expected value as any
   * other wager here: the payout P is drawn from the paytable exactly as
   * for a catch; the bet is WON when P is at least the stake, and lost
   * otherwise. A loss pays nothing, so the mass a catch would have paid on
   * those draws (E[P; P < stake]) is added to every win instead, spread by
   * the odds of winning, and E[payout] = RTP * stake to the cent. The
   * outcome is fixed the moment the bet is placed; what happens on the
   * water afterward is staged to match it, and nothing the player does
   * can move it. Returns { win, payout }.
   */
  sideBet(stake, rng = Math.random) {
    const { pWin, lostMass } = sideBetOdds();
    const p = this.samplePayout(stake, rng);
    const win = p >= stake;
    return { win, payout: win ? p + stake * lostMass / pWin : 0 };
  }

  /** Convenience: resolve a full isolated bet in one go. */
  resolveBet(stake, minTier, maxTier, rng = Math.random, water = 'fresh') {
    return this.describeCatch(this.samplePayout(stake, rng), minTier, maxTier, rng, water);
  }
}
