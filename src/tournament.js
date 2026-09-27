// The fishing tournaments: now and then a marina the player calls at is
// hosting one, out on the water round it, with a field of other boats
// entered. A podium pays the top three by the tournament's prestige, the
// entry fee is the stake, and — as with every wager here — the place is
// DRAWN when the fee is paid (rtp.js tournamentBet, whose expected return
// is the game RTP to the cent) and the tournament is then staged to end
// that way: the other baskets fill, fish by fish, to land the player's
// honest catch exactly where the draw said.
//
// Each tournament has its rules (a target family or species, a minimum
// weight, a hull the field is limited to) and some carry a "golden fish"
// stipulation: hook it and the tournament is yours outright. That is only
// ever how a win the draw already gave is delivered, and sparingly.
//
// And the weights. During a tournament a $1 weight can be slipped into
// the fish at any time, and each one is a $1 wager of its own: a small
// chance (RTP / the prize step) that the judge looks the other way and the
// player's entitlement moves up a place, at which point everything stuffed
// so far is "laundered" — the other baskets are re-staged over it as if it
// were honest. A player who stuffs past what they are entitled to is
// caught at the weigh-in ("we got weights in fish!"), disqualified from
// the place they claimed, and paid for the place their honest catch (plus
// whatever was laundered) truly held — which, for someone who needed to
// stuff, is usually nothing. Every dollar, fee or weight, returns the RTP
// in expectation whatever the player does with it.

import { TOURNEY_TIERS } from './rtp.js';
import { CONFIG } from './config.js';
import { speciesInTiers, poolFor } from './fishdata.js';
import { BOATS } from './boats.js';
import { waterKind } from './lake.js';
import { hullSkins } from './skins.js';

const MIN_GAP_S = 480;            // seconds between tournaments at the least
const LONG_GAP_S = 1200;          // after this long without one, the next call is likely
const TIER_W = { local: 45, regional: 30, major: 18, iconic: 7 };
const FAMILY_NAMES = {
  catfish: 'catfish', bullhead: 'bullheads', carp: 'carp and suckers', trout: 'trout', bass: 'bass',
  panfish: 'panfish', perch: 'perch and walleye', pike: 'pike', minnow: 'bait fish', gar: 'gar',
  sturgeon: 'sturgeon', salmon: 'salmon', eel: 'eels', flatfish: 'flatfish', shark: 'sharks', ray: 'rays',
  tuna: 'tuna and mackerel', snapper: 'snapper', grouper: 'grouper', drum: 'drum', jack: 'jacks',
};
const BOTTOM = new Set(['catfish', 'bullhead', 'carp', 'sturgeon', 'flatfish', 'ray', 'drum', 'eel']);
const WEIGHT_MIN_KG = 0.2;        // the least a $1 weight adds
const WEIGHT_SHARE = 0.025;       // ... else this share of the leading basket

/** How settled the order is by the clock, 0..1. */
function settle(k) { const c = Math.max(0, Math.min(1, (k - 0.5) / 0.36)); return c * c * (3 - 2 * c); }
const arch = (s) => (s.style && s.style.arch) || 'other';

export class Tournaments {
  constructor(scene, player, rtp, hud, fishing, npcs, docks, ambientFish, opts = {}) {
    this.scene = scene; this.player = player; this.rtp = rtp; this.hud = hud; this.fishing = fishing;
    this.npcs = npcs; this.docks = docks; this.ambientFish = ambientFish;
    this.rng = opts.rng || Math.random;
    this.audio = opts.audio || null;      // an HTMLAudioElement for the weigh-in
    this.offer = null;                    // the card on the table
    this.live = null;                     // the tournament under way
    this.time = 0;
    this.lastAt = -MIN_GAP_S + 240;       // the first can come a few minutes in
    this.visitsSince = 0;
    this.lastDock = null;
    this.lastResult = null;
    // The rods report every hook to the fleet already; the tournament listens too.
    const prev = fishing.onCatch;
    fishing.onCatch = (c) => { if (prev) prev(c); this.playerCaught(c); };
    hud.onTourneyWeight = () => this.dropWeight();
  }

  // --- scheduling ---
  /** The player has pulled up to a marina: now and then one is hosting. */
  onMarinaVisit(dock, force = false) {
    if (this.live || this.offer) return null;
    if (dock !== this.lastDock) this.visitsSince++;
    this.lastDock = dock;
    if (!force) {
      if (this.npcs.challenge || this.npcs.offer) return null;
      const since = this.time - this.lastAt;
      if (since < MIN_GAP_S || this.visitsSince < 2) return null;
      if (this.player.balance < TOURNEY_TIERS.local.fee[0]) return null;
      const chance = since >= LONG_GAP_S ? 0.7 : Math.min(0.6, 0.12 + 0.11 * (this.visitsSince - 2));
      if (this.rng() >= chance) return null;
    }
    const spec = this.build(dock, force && typeof force === 'object' ? force : {});
    if (!spec) return null;
    this.offerAt(spec);
    return spec;
  }

  /** A tournament for this marina: its tier, rules, fee, purse and field. */
  build(dock, opts = {}) {
    const rng = this.rng;
    const pick = (w) => { const tot = Object.values(w).reduce((a, b) => a + b, 0); let r = rng() * tot; for (const [k, v] of Object.entries(w)) { r -= v; if (r <= 0) return k; } return Object.keys(w)[0]; };
    const tierId = opts.tier || pick(TIER_W);
    const tier = TOURNEY_TIERS[tierId];
    // The fee, to a five, within what the wallet holds (a tenner at least).
    let fee = Math.round((tier.fee[0] + rng() * (tier.fee[1] - tier.fee[0])) / 5) * 5;
    fee = Math.min(fee, Math.floor(this.player.balance / 5) * 5);
    if (opts.fee) fee = opts.fee;
    if (fee < 10) return null;
    // The water: what swims here decides the target and the stock.
    const kind = waterKind(dock.headX, dock.headZ);
    const pool = poolFor(kind);
    const all = speciesInTiers(1, 3, pool);
    const byArch = {};
    for (const s of all) (byArch[arch(s)] = byArch[arch(s)] || []).push(s);
    const families = Object.keys(byArch).filter((a) => byArch[a].length >= 2 && a !== 'other');
    // The rule (or two): a family, a species, the bottom feeders, a floor
    // on weight, anything at all — and sometimes only one hull allowed.
    const rules = [];
    let kindOfRule = opts.rule || pick({ family: 32, species: 22, bottom: 10, minKg: 14, any: 12, hull: 10 });
    if (kindOfRule === 'hull') { rules.push({ type: 'hull' }); kindOfRule = pick({ family: 40, species: 25, any: 20, minKg: 15 }); }
    let stock = all, target = 'anything that swims';
    if (kindOfRule === 'family' && families.length) {
      const a = opts.arch || families[Math.floor(rng() * families.length)];
      stock = byArch[a]; target = `any ${FAMILY_NAMES[a] || a}`;
      rules.push({ type: 'family', arch: a, text: `Target: ${target}` });
    } else if (kindOfRule === 'bottom' && all.some((s) => BOTTOM.has(arch(s)))) {
      stock = all.filter((s) => BOTTOM.has(arch(s))); target = 'any bottom feeder';
      rules.push({ type: 'bottom', text: 'Target: any bottom feeder' });
    } else if (kindOfRule === 'species') {
      const sp = opts.species || all[Math.floor(rng() * all.length)];
      stock = [sp]; target = sp.name;
      rules.push({ type: 'species', species: sp, text: `Target: ${sp.name} only` });
    } else if (kindOfRule === 'minKg') {
      const med = all.map((s) => s.kg).sort((a, b) => a - b)[Math.floor(all.length / 2)] || 1;
      const min = Math.max(0.5, Math.round(med * (0.8 + rng() * 0.8) * 2) / 2);
      rules.push({ type: 'minKg', kg: min, text: `Only fish over ${min} kg count` });
    } else {
      rules.push({ type: 'any', text: 'Heaviest basket of anything' });
    }
    let hull = null;
    if (rules[0].type === 'hull') {
      const hulls = BOATS.filter((b) => b.id !== 'steamboat');
      hull = opts.hull || hulls[Math.floor(rng() * hulls.length)].id;
      rules[0].hull = hull; rules[0].text = `${BOATS.find((b) => b.id === hull).name} class only`;
    }
    const counts = (c) => {
      for (const r of rules) {
        if (r.type === 'family' && arch(c.species) !== r.arch) return false;
        if (r.type === 'bottom' && !BOTTOM.has(arch(c.species))) return false;
        if (r.type === 'species' && c.species !== r.species) return false;
        if (r.type === 'minKg' && c.kg < r.kg) return false;
      }
      return true;
    };
    // The golden fish: a prize fish of these waters, named on the card,
    // that would win outright — on some tournaments.
    let golden = null;
    if (opts.golden !== false && (opts.golden || rng() < 0.3)) {
      const prize = speciesInTiers(3, 4, pool).filter((s) => !stock.includes(s));
      if (prize.length) golden = opts.golden && opts.golden.name ? opts.golden : prize[Math.floor(rng() * prize.length)];
    }
    const seconds = opts.seconds || (tierId === 'local' ? 150 : tierId === 'regional' ? 180 : 210);
    const field = opts.field || tier.field;
    return { dock, tierId, tier, fee, prizes: tier.mult.map((m) => fee * m), rules, hull, stock, target, counts, golden, seconds, field, title: `${tier.name} · ${dock.name}` };
  }

  /** The card goes up; it stays while the player is about the marina. */
  offerAt(spec) {
    this.offer = spec;
    this.hud.showTourneyCard(spec, () => this.enter(), () => this.decline());
  }

  decline() {
    if (!this.offer) return;
    this.offer = null;
    this.hud.hideTourneyCard();
  }

  /** Can this boat enter? A hull rule has to be met at the rail. */
  eligible(spec = this.offer) {
    if (!spec) return { ok: false, why: '' };
    if (spec.hull && this.player.boat.hullId !== spec.hull) return { ok: false, why: `${BOATS.find((b) => b.id === spec.hull).name} class only — swap boats at the marina` };
    if (this.player.balance < spec.fee) return { ok: false, why: 'Not enough in the wallet for the entry' };
    return { ok: true, why: '' };
  }

  /** The fee is paid, the place drawn, the field put on the water, lines in. */
  enter() {
    const spec = this.offer; if (!spec) return false;
    const el = this.eligible(spec);
    if (!el.ok) { this.hud.hint(el.why, 3200); return false; }
    this.offer = null; this.hud.hideTourneyCard();
    this.player.balance -= spec.fee; this.rtp.wager(spec.fee); this.player.save();
    const draw = this.rtp.tournamentBet(spec.fee, spec.tierId, this.rng);
    const T = this.live = {
      ...spec, t: 0, limit: spec.seconds, place: draw.place, place0: draw.place, payout: draw.payout,
      honest: 0, laundered: 0, weights: 0, weightsKg: 0, bonus: 0, catches: 0,
      boats: [], board: null, order: null, goldenPlan: false, goldenAt: 0, goldenSent: false, done: false,
    };
    // Off the podium, the player still finishes somewhere: mid-field.
    T.dispPlace = draw.place <= 3 ? draw.place : 4 + Math.floor(this.rng() * Math.max(1, spec.field - 2));
    T.aboveN = T.dispPlace - 1;
    T.fishKg = spec.stock.reduce((a, s) => a + s.kg, 0) / Math.max(1, spec.stock.length);
    // A win is delivered by the golden fish now and then — never a loss.
    if (spec.golden && draw.place === 1 && this.rng() < 0.35) { T.goldenPlan = true; T.goldenAt = 0.6 + this.rng() * 0.25; }
    this.lastAt = this.time; this.visitsSince = 0;
    // The field: boats fishing on the water round the marina, in the hull
    // the rules call for. Nobody calls across during a tournament.
    this.spawnField(T);
    this.npcs.holdSpawns = true; this.npcs.enabled = false;
    this.fishing.startMatch({ name: `${spec.tier.name} — ${spec.rules.map((r) => r.text).join(', ')}`, stock: spec.stock, counts: spec.counts, never: spec.golden ? [spec.golden] : [], quiet: true });
    if (this.ambientFish) this.ambientFish.setFeature(spec.stock);
    this.hud.toast(`<div class="catch-body"><div class="catch-name">Lines in — ${spec.tier.name}</div><div class="catch-sub">${spec.rules.map((r) => r.text).join(' · ')}${spec.golden ? ` · golden fish: ${spec.golden.name}` : ''}</div></div>`, 'win', 4200);
    this.hud.setTourney(T, this.boardOf(T));
    return true;
  }

  spawnField(T) {
    const d = T.dock, rng = this.rng;
    const hull = T.hull ? BOATS.find((b) => b.id === T.hull) : null;
    const keys = hull ? hullSkins(hull).map((s) => s.key) : null;
    for (let i = 0; i < T.field && T.boats.length < T.field; i++) {
      // Spread over the water off the marina, a hundred metres out or so.
      const a = d.angle + Math.PI + (rng() - 0.5) * 2.4;
      const spot = this.npcs.spotAt(d.headX, d.headZ, a, 70 + rng() * 90, 0.5, 9) || this.npcs.spotAt(d.headX, d.headZ, rng() * Math.PI * 2, 120, Math.PI, 8);
      if (!spot) continue;
      const key = keys ? keys[Math.floor(rng() * keys.length)] : null;
      const f = this.npcs.newBoat(spot.x, spot.z, rng() * Math.PI * 2, null, key);
      f.idle = true; f.tourney = true; f.age = 0;
      f.startFishing(rng); f.state = 'match'; f.timer = 1e9; f.matchSpecies = T.stock;
      T.boats.push({ f, kg: 0, phase: rng(), rank: i, nextFish: 6 + rng() * 10 });
    }
    // Who finishes above the player: the first `aboveN`, with margins that
    // spread them out; the rest below.
    T.boats.forEach((b, i) => { b.above = i < T.aboveN; b.margin = b.above ? 0.12 + i * 0.16 : 0.15 + (i - T.aboveN) * 0.14; });
  }

  // --- the live tournament ---
  /** The prize a place pays, in dollars (fourth and beyond: nothing). */
  prizeFor(T, place) { return place >= 1 && place <= 3 ? T.prizes[place - 1] : 0; }

  /** What the player's basket weighs at the scales: honest catch plus the weights. */
  scaleKg(T) { return T.honest + T.weightsKg; }

  /** Every entrant's basket, and the player's place among them as things stand. */
  boardOf(T) {
    const S = this.scaleKg(T);
    const rows = [{ name: 'You', you: true, kg: S, weights: T.weights }, ...T.boats.map((b) => ({ name: b.f.name, you: false, kg: b.kg }))];
    rows.sort((a, b) => b.kg - a.kg);
    T.shownPlace = 1 + T.boats.filter((b) => b.kg > S).length;
    return rows;
  }

  playerCaught(c) {
    const T = this.live; if (!T || T.done) return;
    if (T.golden && c.species === T.golden) { this.finish('golden'); return; }
    if (!c.counts) return;
    T.honest += c.kg; T.catches++;
    this.hud.hint(`${c.species.name} counts — ${this.scaleKg(T).toFixed(1)} kg on the scales`, 2200);
  }

  /**
   * A $1 weight, into the fish. It is a wager of its own: with odds of
   * RTP over the next prize step the judge looks away and the entitlement
   * moves up a place, and what is in the fish so far is as good as honest.
   * Already entitled to first, it buys a draw from the paytable instead,
   * paid with the purse as the sponsors' bonus. Either way E = RTP × $1.
   */
  dropWeight() {
    const T = this.live; if (!T || T.done) return false;
    if (this.player.balance < 1) { this.hud.hint('Not a dollar left for a weight', 2000); return false; }
    this.player.balance -= 1; this.rtp.wager(1); this.player.save();
    const top = Math.max(this.scaleKg(T), ...T.boats.map((b) => b.kg));
    T.weights++; T.weightsKg += Math.max(WEIGHT_MIN_KG, WEIGHT_SHARE * top);
    if (T.place > 1) {
      const step = this.prizeFor(T, T.place - 1) - this.prizeFor(T, T.place);
      const q = Math.min(1, CONFIG.RTP / Math.max(0.01, step));
      if (this.rng() < q) { T.place--; T.payout = this.prizeFor(T, T.place); T.laundered = this.scaleKg(T); this.restage(T); }
    } else {
      T.bonus += this.rtp.samplePayout(1, this.rng);
    }
    this.hud.hint(`A weight down the gullet — ${this.scaleKg(T).toFixed(1)} kg on the scales`, 1600);
    this.hud.setTourney(T, this.boardOf(T));
    return true;
  }

  /** The entitlement moved up: one fewer boat is to finish above the player. */
  restage(T) {
    T.dispPlace = T.place <= 3 ? T.place : T.dispPlace;
    T.aboveN = T.dispPlace - 1;
    T.boats.forEach((b, i) => { b.above = i < T.aboveN; });
  }

  /** The weight the other baskets are staged against: the honest catch, or what was laundered over it. */
  baseKg(T) { return Math.max(T.honest, T.laundered); }

  update(dt, t, me) {
    this.time += dt;
    const T = this.live;
    if (!T) {
      // A card left on the table: it is withdrawn once the player has gone.
      if (this.offer && me && Math.hypot(this.offer.dock.headX - me.pos.x, this.offer.dock.headZ - me.pos.z) > 110) this.decline();
      return;
    }
    if (T.done) return;
    T.t += dt;
    const k = T.t / T.limit, settled = settle(k);
    const base = this.baseKg(T), fk = T.fishKg;
    // The other baskets: swinging about while the order is open, then
    // settling to their finals — above the player's honest weight or
    // below it, as drawn — and only ever filling.
    for (const b of T.boats) {
      const swing = Math.sin((k * 1.6 + b.phase) * Math.PI * 2) * (1 - settled);
      const final = b.above ? base * (1 + b.margin) + fk * (0.6 + 0.4 * b.rank) : Math.max(0, Math.min(base - fk * 0.5, base * (1 - b.margin)));
      let want;
      if (settled > 0.5) want = final;
      else if (b.above) want = Math.max(0, final * (0.35 + 0.65 * k) + swing * fk * 0.8);
      else want = Math.max(0, Math.min(final, base * (0.5 + 0.35 * swing)));
      b.nextFish -= dt;
      if (b.kg < want && b.nextFish <= 0 && T.t > 6) {
        const bite = Math.min(want - b.kg, fk * (0.5 + this.rng() * 1.2));
        b.kg += bite; b.nextFish = 5 + this.rng() * 12;
      }
    }
    // The golden fish, if this is how the win comes: sent to the next rod out.
    if (T.goldenPlan && !T.goldenSent && k >= T.goldenAt && this.fishing.match && this.fishing.lines.some((l) => l.state === 'out')) {
      this.fishing.match.forceNext = T.golden; T.goldenSent = true;
    }
    if ((this._hudT = (this._hudT || 0) + dt) > 0.25) { this._hudT = 0; this.hud.setTourney(T, this.boardOf(T)); }
    if (T.t >= T.limit) this.finish('bell');
  }

  /**
   * The weigh-in. The other baskets take their finals (a fish on the
   * bell); the player's basket is read off the scales; and if it stands
   * higher than the player is entitled to, the judge finds the weights.
   */
  finish(reason) {
    const T = this.live; if (!T || T.done) return;
    T.done = true;
    const base = this.baseKg(T), fk = T.fishKg;
    for (const b of T.boats) {
      if (b.above) b.kg = Math.max(b.kg, base * (1 + b.margin) + fk * (0.6 + 0.4 * b.rank) + 0.05);
      else b.kg = Math.min(b.kg, Math.max(0, base - 0.05));
    }
    let golden = reason === 'golden';
    if (golden) { T.place = 1; T.payout = this.prizeFor(T, 1); for (const b of T.boats) { b.above = false; b.kg = Math.min(b.kg, Math.max(0, base - 0.05)); } }
    const rows = this.boardOf(T);
    const shown = T.shownPlace;
    const caught = !golden && this.prizeFor(T, shown) > this.prizeFor(T, T.place);
    const payout = this.prizeFor(T, T.place) + T.bonus;
    if (payout > 0) { this.player.balance += payout; this.rtp.book(payout); this.player.save(); }
    T.finalPlace = caught ? T.place : shown; T.caught = caught; T.paid = payout;
    this.lastResult = { tier: T.tierId, place: T.place, shown, caught, golden, payout, weights: T.weights, honest: T.honest };
    // The word from the scales.
    const ord = (n) => ['1st', '2nd', '3rd'][n - 1] || `${n}th`;
    if (caught) {
      this.hud.showWeighIn(this.audio);
      const honest = T.place <= 3 ? `Your honest catch stood ${ord(T.place)} — $${this.prizeFor(T, T.place).toFixed(2)}.` : 'Your honest catch was off the podium.';
      this.hud.toast(`<div class="catch-body"><div class="catch-name">Disqualified — weights in the fish</div><div class="catch-sub">Struck from ${ord(shown)}. ${honest}</div></div>`, 'meh', 7000);
    } else if (golden) {
      this.hud.toast(`<div class="catch-body"><div class="catch-name">Golden fish! You win the ${T.tier.name}</div><div class="catch-sub">${T.golden.name} on the hook — the tournament is yours outright</div></div><div class="catch-value">$${payout.toFixed(2)}</div>`, 'win', 6500);
    } else if (T.place <= 3) {
      this.hud.toast(`<div class="catch-body"><div class="catch-name">${ord(T.place)} at the ${T.tier.name}!</div><div class="catch-sub">${this.scaleKg(T).toFixed(1)} kg on the scales${T.bonus > 0 ? ` · sponsors' bonus $${T.bonus.toFixed(2)}` : ''}</div></div><div class="catch-value">$${payout.toFixed(2)}</div>`, 'win', 6500);
    } else {
      this.hud.toast(`<div class="catch-body"><div class="catch-name">${ord(shown)} of ${T.boats.length + 1} — no prize</div><div class="catch-sub">${T.tier.name} · $${T.fee} entry</div></div>`, 'meh', 5000);
    }
    this.hud.setTourney(T, rows, true);
    // The field goes back to its own life, and the water to its own fish.
    for (const b of T.boats) { const f = b.f; f.tourney = false; f.idle = this.rng() < 0.4; f.state = 'idle'; f.timer = 0; f.endCast(); f.boat.anchored = false; f.matchSpecies = null; }
    this.npcs.holdSpawns = false; this.npcs.enabled = true;
    this.fishing.endMatch();
    if (this.ambientFish) this.ambientFish.setFeature(null);
    this.live = null;
    setTimeout(() => { if (!this.live) this.hud.hideTourney(); }, 9000);
  }
}

