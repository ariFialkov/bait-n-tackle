// Player state: cash, the boat you own and sail, and the fish hold.
//
// IMPORTANT (RTP): a landed catch is credited to the hold as *stored value*
// and can always be sold later — nothing in the hold can ever be destroyed,
// expire or shrink. The hold only gates PACING: when it is full you cannot
// place new bets until you sell. That keeps realized RTP identical to the
// paytable and keeps the game free of any skill component (a player who
// never returns to market simply stops being able to bet).

import { BOATS, BOAT_BY_ID, DEFAULT_BOAT, resolveBoat } from './boats.js';
import { SKINS } from './skins.js';
import { SPECIES } from './fishdata.js';
import { CONFIG } from './config.js';

const KEY = 'bnt-save-v1';

/**
 * Accept either a current skin key ("cuddy:cherry-red") or a pre-skin save's
 * bare hull id ("cuddy"), which is granted that hull's standard skin.
 */
function migrateKey(id) {
  if (typeof id !== 'string' || !id) return null;
  if (id.includes(':')) {
    const [hullId, skinId] = id.split(':');
    const list = SKINS[hullId];
    return list && list.some((s) => s.id === skinId) ? id : null;
  }
  const list = SKINS[id];
  return list ? `${id}:${list[0].id}` : null;
}

export class Player {
  constructor() {
    this.balance = CONFIG.START_BALANCE;
    this.boatId = DEFAULT_BOAT;
    this.owned = [DEFAULT_BOAT];
    this.hold = [];              // [{ id, kg, value, sizeMult }]
    this.onboardProcessing = true;
    this.load();
  }

  get boat() { return resolveBoat(this.boatId); }
  get capacity() { return this.boat.hold; }
  get holdKg() { return this.hold.reduce((a, f) => a + f.kg, 0); }
  get holdValue() { return this.hold.reduce((a, f) => a + f.value, 0); }
  get holdFrac() { return Math.min(1, this.holdKg / this.capacity); }

  /** Onboard processing pays at the rail instead of filling the hold. */
  get processing() {
    return !!(this.boat.features.onboard && this.onboardProcessing);
  }

  /** Can a new wager be placed, or is the boat too full to work? */
  canFish() { return this.processing || this.holdKg < this.capacity; }

  has(id) { return this.owned.includes(id); }

  /**
   * Store a landed catch. Always succeeds — the last fish always fits, so a
   * bet's payout can never be lost to a full hold. Returns 'paid' | 'stored'.
   */
  store(c) {
    if (this.processing) {
      this.balance += c.value;
      this.save();
      return 'paid';
    }
    this.hold.push({
      id: c.species.id, kg: c.kg, value: c.value, sizeMult: c.sizeMult,
    });
    this.save();
    return 'stored';
  }

  /** Sell everything in the hold. Returns { count, value, rows, best }. */
  sellAll() {
    if (!this.hold.length) return { count: 0, value: 0, rows: [], best: null };
    const count = this.hold.length;
    const value = this.holdValue;
    const rows = this.holdSummary();
    let best = null;
    for (const f of this.hold) if (!best || f.value > best.value) best = f;
    this.balance += value;
    const bestOut = best && {
      species: SPECIES[best.id], kg: best.kg, value: best.value, sizeMult: best.sizeMult,
    };
    this.hold = [];
    this.save();
    return { count, value, rows, best: bestOut };
  }

  /** Buy a skin by its key ("cuddy:cherry-red"). */
  buy(key) {
    const b = resolveBoat(key);
    if (!b || b.key !== key || this.has(key) || this.balance < b.price) return false;
    this.balance -= b.price;
    this.owned.push(key);
    this.save();
    return true;
  }

  equip(id) {
    if (!this.has(id)) return false;
    this.boatId = id;
    this.save();
    return true;
  }

  /** Summary of the hold grouped by species, best first. */
  holdSummary() {
    const byId = new Map();
    for (const f of this.hold) {
      const e = byId.get(f.id) || { species: SPECIES[f.id], n: 0, kg: 0, value: 0 };
      e.n++; e.kg += f.kg; e.value += f.value;
      byId.set(f.id, e);
    }
    return [...byId.values()].sort((a, b) => b.value - a.value);
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        balance: Math.round(this.balance * 100) / 100,
        boatId: this.boatId,
        owned: this.owned,
        hold: this.hold,
        onboardProcessing: this.onboardProcessing,
      }));
    } catch { /* private mode / quota — play on without persistence */ }
  }

  load() {
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch { return; }
    if (!raw) {
      // Migrate the old balance-only save from before boats existed.
      // Guard the null case: Number(null) is 0, which would silently wipe
      // the starting balance on a fresh install.
      try {
        const legacy = localStorage.getItem('bnt-balance');
        if (legacy !== null && legacy !== '') {
          const old = Number(legacy);
          if (Number.isFinite(old)) this.balance = old;
        }
      } catch { /* ignore */ }
      return;
    }
    try {
      const s = JSON.parse(raw);
      if (Number.isFinite(s.balance)) this.balance = s.balance;
      if (Array.isArray(s.owned) && s.owned.length) {
        this.owned = s.owned.map(migrateKey).filter(Boolean);
        if (!this.owned.includes(DEFAULT_BOAT)) this.owned.unshift(DEFAULT_BOAT);
        this.owned = [...new Set(this.owned)];
      }
      const boatKey = migrateKey(s.boatId);
      if (boatKey && this.owned.includes(boatKey)) this.boatId = boatKey;
      if (Array.isArray(s.hold)) {
        this.hold = s.hold.filter(
          (f) => SPECIES[f.id] && Number.isFinite(f.kg) && Number.isFinite(f.value));
      }
      if (typeof s.onboardProcessing === 'boolean') this.onboardProcessing = s.onboardProcessing;
    } catch { /* corrupt save — start fresh rather than crash */ }
  }

  /** Reset progress (used by the marina's 'sell the fleet' debug path). */
  resetAll() {
    this.balance = CONFIG.START_BALANCE;
    this.boatId = DEFAULT_BOAT;
    this.owned = [DEFAULT_BOAT];
    this.hold = [];
    this.save();
  }
}

export { BOATS };
