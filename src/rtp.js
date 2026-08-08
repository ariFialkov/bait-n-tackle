// RTP engine: every wager (trawl distance or lure cost) is booked as `spent`,
// every catch as `earned`. The round target is RTP * spent; each catch is
// value-selected to pull the player's round total back toward that target.

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

  // Positive => we owe the player fish value; negative => player is ahead.
  deficit() { return CONFIG.RTP * this.spent - this.earned; }

  netRound() { return this.earned - this.spent; }

  /**
   * Pick a catch for a wager of `baseCost` from species tiers [minTier, maxTier].
   * Returns { species, sizeMult, kg, value } or null on a miss.
   * `valueBoost` (hotspots) and `allowMiss` tune the roll.
   */
  resolveCatch(baseCost, minTier, maxTier, { valueBoost = 1, allowMiss = true, rng = Math.random } = {}) {
    const deficit = this.deficit();

    // Where this catch should land in dollars.
    let target = baseCost * CONFIG.RTP * valueBoost;
    target += clamp(deficit * CONFIG.RTP_PULL, -0.75 * target, 4 * target + 5);
    target = Math.max(0.05, target);

    const pool = speciesInTiers(minTier, maxTier);

    // Miss logic. High-tier pools have a price floor (their cheapest possible
    // catch); when the target sits below that floor, the miss probability
    // scales so the *expected* payout still lands on the target. A small base
    // miss keeps casts from feeling automatic.
    if (allowMiss) {
      let cheapest = Infinity;
      for (const s of pool) cheapest = Math.min(cheapest, s.value);
      const floorValue = cheapest * 0.62; // cheapest species at minimum size
      let missChance = CONFIG.MISS_CHANCE_BASE;
      if (target < floorValue) {
        missChance = Math.max(missChance, 1 - target / floorValue);
        target = floorValue;
      } else {
        // Slightly more misses when the player is ahead, scaled to the wager.
        const aheadness = clamp(-deficit / Math.max(baseCost * 3, 20), 0, 1);
        missChance += (CONFIG.MISS_CHANCE_AHEAD - CONFIG.MISS_CHANCE_BASE) * aheadness;
      }
      if (rng() < Math.min(missChance, 0.9)) return null;
      // Survived a corrective miss roll: pay the floor, not more.
    }

    // Weight species in the allowed band by closeness to the target value,
    // then sample — keeps variety while trending toward the target.
    let totalW = 0;
    const weights = pool.map((s) => {
      const rel = Math.abs(Math.log((s.value + 0.01) / target));
      const w = 1 / (0.1 + rel * rel * 4);
      totalW += w;
      return w;
    });
    let pick = rng() * totalW;
    let species = pool[pool.length - 1];
    for (let i = 0; i < pool.length; i++) {
      pick -= weights[i];
      if (pick <= 0) { species = pool[i]; break; }
    }

    // Size roll fine-tunes toward the target within a believable band.
    const ideal = clamp(target / species.value, 0.58, 1.45);
    const sizeMult = clamp(ideal + (rng() - 0.5) * 0.22, 0.55, 1.5);
    const value = Math.max(0.05, Math.round(species.value * sizeMult * 100) / 100);
    const kg = Math.max(0.005, species.kg * sizeMult * sizeMult); // weight scales harder than value

    return { species, sizeMult, kg, value };
  }
}
