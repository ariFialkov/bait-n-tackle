// Player state: cash, and the boat you own and sail.
//
// IMPORTANT (RTP): a landed catch is paid straight into the balance the
// moment it comes over the rail. There is no hold, no storage and no trip
// ashore between winning a bet and being paid for it, so the realised RTP is
// exactly the paytable's and nothing a player does with a catch afterwards
// can change what a bet was worth.

import { DEFAULT_BOAT, resolveBoat } from './boats.js';
import { SKINS } from './skins.js';
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
    this.autoReel = false;
    this.load();
  }

  get boat() { return resolveBoat(this.boatId); }

  has(id) { return this.owned.includes(id); }

  /** Pay a landed catch straight into the balance. */
  bank(c) {
    this.balance += c.value;
    this.save();
    return c.value;
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

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        balance: Math.round(this.balance * 100) / 100,
        boatId: this.boatId,
        owned: this.owned,
        autoReel: this.autoReel,
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
      if (typeof s.autoReel === 'boolean') this.autoReel = s.autoReel;
      // A save from before auto-cashout may still carry a `hold` array. Those
      // fish were won but never cashed, so pay them out now at face value —
      // exactly what pulling up to a market would have done. Dropping them
      // instead would destroy value the player had already staked for.
      if (Array.isArray(s.hold)) {
        for (const f of s.hold) if (Number.isFinite(f?.value)) this.balance += f.value;
      }
    } catch { /* corrupt save — start fresh rather than crash */ }
  }

  /** Reset progress. */
  resetAll() {
    this.balance = CONFIG.START_BALANCE;
    this.boatId = DEFAULT_BOAT;
    this.owned = [DEFAULT_BOAT];
    this.save();
  }
}
