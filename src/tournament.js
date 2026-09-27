// The fishing tournaments: now and then a marina the player comes to is
// hosting one, out on the water round it, with a field of other boats
// entered. The marina is dressed for it before the player gets there —
// bunting along the pier, a banner, a podium with the trophy on it, a
// crowd of fishermen on the planking, the contestants' boats moored in
// the harbour — and the card comes up as they draw near and goes as they
// leave, for two minutes after they first see it.
//
// A podium pays the top three by the tournament's prestige, with a cash
// spot for fourth; the entry fee is the stake; and — as with every wager
// here — the place is DRAWN when the fee is paid (rtp.js tournamentBet,
// whose expected return is the game RTP to the cent) and the tournament
// is then staged to end that way: the other baskets fill, fish by fish,
// to land the player's honest catch exactly where the draw said. The
// boats that are to finish ahead make their move over the last third of
// the clock, each on its own timing, racing one another for it.
//
// Each tournament has its rules (a target family or species, a minimum
// weight, a hull the field is limited to) and some carry a "golden fish"
// stipulation: hook it and the tournament is yours outright. That is only
// ever how a win the draw already gave is delivered, and sparingly.
//
// And the weights. During a tournament a $1 weight can be slipped into
// the fish at any time, and each one is a $1 wager of its own: a chance
// (RTP over the next prize step) that the judge looks the other way and
// the player's entitlement moves up a place, at which point everything
// stuffed so far is "laundered" — the other baskets are re-staged over it
// as if it were honest. A player who stuffs past what they are entitled
// to is caught at the weigh-in ("we got weights in fish!"), disqualified
// from the place they claimed, and paid for the place their honest catch
// (plus whatever was laundered) truly held. Every dollar, fee or weight,
// returns the RTP in expectation whatever the player does with it.

import * as THREE from 'three';
import { TOURNEY_TIERS } from './rtp.js';
import { CONFIG } from './config.js';
import { speciesInTiers, poolFor } from './fishdata.js';
import { BOATS } from './boats.js';
import { hullSkins } from './skins.js';
import { waterKind } from './lake.js';
import { Character } from './crew.js';
import { lookFor } from './crewlook.js';

const MIN_GAP_S = 480;            // seconds between tournaments at the least
const LONG_GAP_S = 1200;          // after this long without one, the next marina is likely hosting
const DECIDE_R = 420;             // metres: a marina is decided (and dressed) this far out
const CARD_R = 50, CARD_OFF_R = 80;    // the card comes up this near, goes this far
const CLOCK_S = 60;               // a tournament is a minute of fishing
const CARD_WINDOW_S = 120;        // seconds the card keeps coming back after it is first seen
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
const DECK_Y = 0.51;              // the pier's planking, above the water, in the marina's frame
const PIER_W = 2.8;
const CROWD = ['captain', 'bosun', 'deckhand', 'engineer', 'deckhand', 'bosun'];
const CROWD_UPDATE_R = 170;       // metres: the crowd is posed within this, and at a third of the frames
const DECO_R = 260;               // metres: the dressing is drawn within this

/** How settled the order is by the clock, 0..1. */
function settle(k) { const c = Math.max(0, Math.min(1, (k - 0.5) / 0.36)); return c * c * (3 - 2 * c); }
const smooth = (x) => { const c = Math.max(0, Math.min(1, x)); return c * c * (3 - 2 * c); };
const arch = (s) => (s.style && s.style.arch) || 'other';
const ORD = (n) => ['1st', '2nd', '3rd'][n - 1] || `${n}th`;
const dockKey = (d) => `${Math.round(d.x)},${Math.round(d.z)}`;

export class Tournaments {
  constructor(scene, player, rtp, hud, fishing, npcs, docks, ambientFish, opts = {}) {
    this.scene = scene; this.player = player; this.rtp = rtp; this.hud = hud; this.fishing = fishing;
    this.npcs = npcs; this.docks = docks; this.ambientFish = ambientFish;
    this.rng = opts.rng || Math.random;
    this.audio = opts.audio || null;      // an HTMLAudioElement for the weigh-in
    this.hosting = new Map();             // dock key -> spec of the tournament it hosts (dressed, waiting)
    this.decided = new Set();             // dock keys already decided, hosting or not
    this.offer = null;                    // the spec whose card is up
    this.live = null;                     // the tournament under way
    this.time = 0;
    this.lastAt = -MIN_GAP_S + 240;       // the first can come a few minutes in
    this.marinasSince = 0;                // marinas come to since the last one
    this.lastResult = null;
    this._frame = 0;
    // The rods report every hook to the fleet already; the tournament listens too.
    const prev = fishing.onCatch;
    fishing.onCatch = (c) => { if (prev) prev(c); this.playerCaught(c); };
    hud.onTourneyWeight = () => this.dropWeight();
  }

  // --- deciding, and dressing the marina ---
  /** A marina come within range for the first time: is it hosting? */
  decide(dock, me) {
    const key = dockKey(dock);
    if (this.decided.has(key)) return null;
    this.decided.add(key);
    this.marinasSince++;
    if (this.live || this.npcs.challenge) return null;
    const since = this.time - this.lastAt;
    if (since < MIN_GAP_S || this.marinasSince < 2) return null;
    if (this.player.balance < TOURNEY_TIERS.local.fee[0]) return null;
    const chance = since >= LONG_GAP_S ? 0.7 : Math.min(0.6, 0.12 + 0.11 * (this.marinasSince - 2));
    if (this.rng() >= chance) return null;
    return this.hostAt(dock);
  }

  /** This marina hosts: the tournament is built, and the marina dressed for it. */
  hostAt(dock, opts = {}) {
    const key = dockKey(dock);
    if (this.hosting.has(key)) return this.hosting.get(key);
    const spec = this.build(dock, opts);
    if (!spec) return null;
    this.hosting.set(key, spec); this.decided.add(key);
    this.lastAt = this.time; this.marinasSince = 0;
    this.dress(spec);
    return spec;
  }

  /** (The old hook: pulling up to a marina. Kept for a forced tournament, as the tests use it.) */
  onMarinaVisit(dock, force = false) {
    if (!force) return null;
    if (this.live) return null;
    const spec = this.hostAt(dock, typeof force === 'object' ? force : {});
    if (spec && !this.offer) this.showCard(spec);
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
    const seconds = opts.seconds || CLOCK_S;
    const field = opts.field || tier.field;
    return { dock, key: dockKey(dock), tierId, tier, fee, prizes: tier.mult.map((m) => fee * m), rules, hull, stock, target, counts, golden, seconds, field, title: `${tier.name} · ${dock.name}`, boats: [], deco: null, crowd: [], firstSeen: null, declined: false };
  }

  /**
   * The marina dressed for the day: bunting along the pier, a banner at
   * the head, the podium with the trophy on it by the shore end, a crowd
   * on the planking (put out a figure a frame), and the contestants'
   * boats moored round the harbour. All of it plain, unlit and unshadowed
   * geometry in a handful of meshes, hidden beyond a few hundred metres.
   */
  dress(spec) {
    const d = spec.dock, L = Math.max(10, d.pierLen || 12);
    const g = new THREE.Group();
    g.position.set(d.x, CONFIG.WATER_LEVEL, d.z); g.rotation.y = d.angle;
    // Poles and strings, with flags: one geometry for all the flags.
    const poleGeo = new THREE.CylinderGeometry(0.04, 0.05, 3.2, 6);
    const poleMat = new THREE.MeshLambertMaterial({ color: 0xd8d0c0 });
    const posts = [];
    for (const sx of [-1, 1]) for (const z of [1.0, L - 0.8]) { const p = new THREE.Mesh(poleGeo, poleMat); p.position.set(sx * (PIER_W / 2 + 0.25), DECK_Y + 1.6, z); g.add(p); posts.push(p.position.clone()); }
    const cols = [0xe63b2e, 0xffd166, 0x3ba0e6, 0xf7f3e8, 0x39b26b];
    const verts = [], colors = [];
    const string = (a, b, sag = 0.35) => {
      const n = Math.max(3, Math.floor(a.distanceTo(b) / 0.75));
      for (let i = 0; i < n; i++) {
        const t0 = i / n, t1 = (i + 0.5) / n, t2 = (i + 1) / n;
        const at = (t) => new THREE.Vector3().lerpVectors(a, b, t).add(new THREE.Vector3(0, -sag * Math.sin(t * Math.PI), 0));
        const p0 = at(t0), p2 = at(t2), p1 = at(t1); p1.y -= 0.42;
        const c = new THREE.Color(cols[i % cols.length]);
        for (const p of [p0, p2, p1]) { verts.push(p.x, p.y + 1.55, p.z); colors.push(c.r, c.g, c.b); }
      }
    };
    string(posts[0], posts[1]); string(posts[2], posts[3]);           // along each side of the pier
    string(posts[1], posts[3], 0.25); string(posts[0], posts[2], 0.25); // across the head, across the root
    const flagGeo = new THREE.BufferGeometry();
    flagGeo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    flagGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const flags = new THREE.Mesh(flagGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    flags.frustumCulled = false;
    g.add(flags);
    // The banner across the head: the tier, painted once.
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 96;
    const cx = cv.getContext('2d');
    cx.fillStyle = '#183a52'; cx.fillRect(0, 0, 512, 96); cx.strokeStyle = '#ffd166'; cx.lineWidth = 6; cx.strokeRect(6, 6, 500, 84);
    cx.fillStyle = '#ffd166'; cx.font = 'bold 44px sans-serif'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
    cx.fillText(spec.tier.name.toUpperCase(), 256, 38);
    cx.fillStyle = '#eaf6fb'; cx.font = 'bold 26px sans-serif'; cx.fillText(`TODAY · ${d.name.toUpperCase()}`, 256, 74);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(PIER_W + 1.6, (PIER_W + 1.6) * 96 / 512), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
    banner.position.set(0, DECK_Y + 2.75, L - 0.8); g.add(banner);
    // The podium by the shore end, the trophy on the top step.
    const step = (w, h, col, x) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.8), new THREE.MeshLambertMaterial({ color: col })); m.position.set(x, DECK_Y + h / 2, 3.2); g.add(m); return m; };
    step(0.7, 0.62, 0xe0b83a, 0); step(0.7, 0.42, 0xc8ccd2, -0.72); step(0.7, 0.3, 0xb8763a, 0.72);
    const gold = new THREE.MeshLambertMaterial({ color: 0xffd166, emissive: 0x4a3a08 });
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.09, 0.26, 12, 1, true), gold); cup.material.side = THREE.DoubleSide;
    cup.position.set(0, DECK_Y + 0.62 + 0.24, 3.2); g.add(cup);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.12, 8), gold); stem.position.set(0, DECK_Y + 0.62 + 0.06, 3.2); g.add(stem);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.12, 0.04, 12), gold); foot.position.set(0, DECK_Y + 0.62 + 0.02, 3.2); g.add(foot);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    this.scene.add(g);
    spec.deco = g;
    // The crowd, to be put out a figure a frame as the marina is drawn.
    spec.crowdTodo = CROWD.slice(0, 4 + Math.floor(this.rng() * 3)).map((id, i) => ({ id, x: (i % 2 ? 1 : -1) * (0.45 + this.rng() * 0.35), z: 5 + (i / 6) * (L - 7) + this.rng() * 1.2, f: this.rng() * Math.PI * 2 }));
    // The contestants, moored about the harbour, waiting: the field.
    this.moorField(spec);
  }

  moorField(spec) {
    const d = spec.dock, rng = this.rng;
    const hull = spec.hull ? BOATS.find((b) => b.id === spec.hull) : null;
    const keys = hull ? hullSkins(hull).map((s) => s.key) : null;
    for (let i = 0; i < spec.field * 2 && spec.boats.length < spec.field; i++) {
      const a = d.angle + (rng() - 0.5) * 2.6;          // off the pier head, over the water
      const spot = this.npcs.spotAt(d.headX, d.headZ, a, 28 + rng() * 40, 0.4, 7) || this.npcs.spotAt(d.headX, d.headZ, rng() * Math.PI * 2, 60, Math.PI, 7);
      if (!spot) continue;
      const key = keys ? keys[Math.floor(rng() * keys.length)] : null;
      const f = this.npcs.newBoat(spot.x, spot.z, rng() * Math.PI * 2, null, key);
      f.idle = true; f.tourney = true; f.age = 0;
      f.state = 'atMarina'; f.timer = 1e9; f.boat.anchored = true;
      spec.boats.push({ f, kg: 0, phase: rng(), rank: i, nextFish: 3 + rng() * 5 });
    }
  }

  /** The dressing comes down; the field goes back to its own life (or, with `keep`, stays entered). */
  undress(spec, keepBoats = false) {
    if (spec.deco) { this.scene.remove(spec.deco); spec.deco.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); if (o.material.map) o.material.map.dispose(); o.material.dispose(); } }); spec.deco = null; }
    for (const ch of spec.crowd) ch.dispose();
    spec.crowd = []; spec.crowdTodo = null;
    if (!keepBoats) for (const b of spec.boats) { const f = b.f; f.tourney = false; f.idle = this.rng() < 0.4; f.state = 'idle'; f.timer = 0; f.boat.anchored = false; f.matchSpecies = null; }
    this.hosting.delete(spec.key);
  }

  // --- the card ---
  showCard(spec) {
    this.offer = spec;
    if (spec.firstSeen == null) spec.firstSeen = this.time;
    this.hud.showTourneyCard(spec, () => this.enter(), () => this.decline());
  }
  hideCard() { this.offer = null; this.hud.hideTourneyCard(); }

  decline() {
    const spec = this.offer; if (!spec) return;
    spec.declined = true;
    this.hideCard();
    this.undress(spec);
  }

  /** Can this boat enter? A hull rule has to be met at the rail. */
  eligible(spec = this.offer) {
    if (!spec) return { ok: false, why: '' };
    if (spec.hull && this.player.boat.hullId !== spec.hull) return { ok: false, why: `${BOATS.find((b) => b.id === spec.hull).name} class only — swap boats at the marina` };
    if (this.player.balance < spec.fee) return { ok: false, why: 'Not enough in the wallet for the entry' };
    return { ok: true, why: '' };
  }

  /** The fee is paid, the place drawn, the field sent out, lines in. */
  enter() {
    const spec = this.offer; if (!spec) return false;
    const el = this.eligible(spec);
    if (!el.ok) { this.hud.hint(el.why, 3200); return false; }
    this.hideCard();
    this.player.balance -= spec.fee; this.rtp.wager(spec.fee); this.player.save();
    const draw = this.rtp.tournamentBet(spec.fee, spec.tierId, this.rng);
    const T = this.live = {
      ...spec, t: 0, limit: spec.seconds, place: draw.place, place0: draw.place, payout: draw.payout,
      honest: 0, laundered: 0, weights: 0, weightsKg: 0, bonus: 0, catches: 0, best: null,
      order: null, goldenPlan: false, goldenAt: 0, goldenSent: false, done: false,
    };
    // Off the podium and the cash spot, the player still finishes somewhere: mid-field.
    T.dispPlace = draw.place <= 4 ? draw.place : 5 + Math.floor(this.rng() * Math.max(1, spec.field - 3));
    T.aboveN = Math.min(T.dispPlace - 1, spec.boats.length);
    T.fishKg = spec.stock.reduce((a, s) => a + s.kg, 0) / Math.max(1, spec.stock.length);
    // A win is delivered by the golden fish now and then — never a loss.
    if (spec.golden && draw.place === 1 && this.rng() < 0.35) { T.goldenPlan = true; T.goldenAt = 0.6 + this.rng() * 0.25; }
    this.undress(spec, true);
    this.sendField(T);
    this.npcs.holdSpawns = true; this.npcs.enabled = false;
    this.fishing.startMatch({ name: `${spec.tier.name} — ${spec.rules.map((r) => r.text).join(', ')}`, stock: spec.stock, counts: spec.counts, never: spec.golden ? [spec.golden] : [], quiet: true });
    if (this.ambientFish) this.ambientFish.setFeature(spec.stock);
    this.hud.toast(`<div class="catch-body"><div class="catch-name">Lines in — ${spec.tier.name}</div><div class="catch-sub">${spec.rules.map((r) => r.text).join(' · ')}${spec.golden ? ` · golden fish: ${spec.golden.name}` : ''}</div></div>`, 'win', 4200);
    this.hud.setTourney(T, this.boardOf(T));
    return true;
  }

  /**
   * The field leaves its moorings for the water off the marina, each boat
   * to a spot of its own, and fishes there; who finishes above the player
   * is settled here, and each of those gets its own moment to make its move.
   */
  sendField(T) {
    const d = T.dock, rng = this.rng;
    T.boats.forEach((b, i) => {
      const f = b.f;
      f.boat.anchored = false; f.timer = 0; f.matchSpecies = T.stock;
      const a = d.angle + (rng() - 0.5) * 2.6;          // off the pier head, over the water
      const spot = this.npcs.spotAt(d.headX, d.headZ, a, 45 + rng() * 65, 0.5, 9);   // not far: a minute's fishing
      if (spot && f.goTo(spot.x, spot.z)) { f.state = 'toFish'; f.throttle = 0.5 + rng() * 0.4; }
      else { f.startFishing(rng); f.state = 'match'; f.timer = 1e9; }
      b.above = i < T.aboveN;
      b.margin = b.above ? 0.12 + i * 0.16 : 0.15 + (i - T.aboveN) * 0.14;
      // Its charge: when it starts to move, and when it is where it means to be.
      b.chargeAt = 0.6 + rng() * 0.26; b.chargeEnd = Math.min(0.97, b.chargeAt + 0.1 + rng() * 0.12);
    });
  }

  // --- the live tournament ---
  /** The prize a place pays, in dollars (fifth and beyond: nothing). */
  prizeFor(T, place) { return place >= 1 && place <= 4 ? T.prizes[place - 1] : 0; }

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
    if (!T.best || c.kg > T.best.kg) T.best = { species: c.species, kg: c.kg };
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
    T.dispPlace = T.place <= 4 ? T.place : T.dispPlace;
    T.aboveN = Math.min(T.dispPlace - 1, T.boats.length);
    T.boats.forEach((b, i) => { b.above = i < T.aboveN; });
  }

  /** The weight the other baskets are staged against: the honest catch, or what was laundered over it. */
  baseKg(T) { return Math.max(T.honest, T.laundered); }

  update(dt, t, me) {
    this.time += dt; this._frame++;
    // The marinas about: a new one within range is decided; the dressed
    // ones are drawn and their crowds posed while near; the card comes and
    // goes with the distance, for two minutes from the first sight of it.
    if (me) {
      const near = this.docks.nearest(me.pos.x, me.pos.z);
      if (near.dock && near.dist < DECIDE_R && !this.decided.has(dockKey(near.dock))) this.decide(near.dock, me);
      for (const spec of this.hosting.values()) {
        const dist = Math.hypot(spec.dock.headX - me.pos.x, spec.dock.headZ - me.pos.z);
        this.tendDressing(spec, dist, dt, t);
        if (this.live) continue;
        if (spec.firstSeen != null && this.time - spec.firstSeen > CARD_WINDOW_S) { if (this.offer === spec) this.hideCard(); spec.declined = true; this.undress(spec); continue; }
        if (this.offer === spec) { if (dist > CARD_OFF_R) this.hideCard(); }
        else if (!this.offer && dist < CARD_R && !spec.declined) this.showCard(spec);
      }
    }
    const T = this.live;
    if (!T || T.done) return;
    T.t += dt;
    const k = T.t / T.limit, settled = settle(k);
    const base = this.baseKg(T), fk = T.fishKg;
    // The other baskets. While the order is open they swing about, under
    // the player's honest weight for the most part. Each boat that is to
    // finish ahead then makes its move on its own timing over the last
    // third — a run of fish, ending where it means to be with a little of
    // the clock to spare — and the rest settle short. Baskets only fill.
    for (const b of T.boats) {
      const swing = Math.sin((k * 1.6 + b.phase) * Math.PI * 2) * (1 - settled);
      const final = b.above ? base * (1 + b.margin) + fk * (0.6 + 0.4 * b.rank) : Math.max(0, Math.min(base - fk * 0.5, base * (1 - b.margin)));
      let want, pace = 1;
      if (b.above) {
        // Short of the player until its move — unless the player has next to nothing, when it shows a fish or two anyway.
        const open = Math.max(0, Math.min(final, base * 0.92, base * (0.55 + 0.3 * swing)) + (base < fk * 0.5 ? fk * 0.3 * (0.5 + swing) : 0));
        const c = smooth((k - b.chargeAt) / Math.max(0.02, b.chargeEnd - b.chargeAt));
        want = open + (final - open) * c;
        if (k > b.chargeAt && c < 1) pace = 0.4;                    // fish come faster on the charge
      } else {
        want = settled > 0.5 ? final : Math.max(0, Math.min(final, base * (0.5 + 0.35 * swing)));
      }
      b.nextFish -= dt;
      if (b.kg < want && b.nextFish <= 0 && T.t > 4) {
        const bite = Math.min(want - b.kg, fk * (0.5 + this.rng() * 1.2));
        b.kg += bite; b.nextFish = (2 + this.rng() * 5) * pace;
      }
    }
    // The golden fish, if this is how the win comes: sent to the next rod out.
    if (T.goldenPlan && !T.goldenSent && k >= T.goldenAt && this.fishing.match && this.fishing.lines.some((l) => l.state === 'out')) {
      this.fishing.match.forceNext = T.golden; T.goldenSent = true;
    }
    if ((this._hudT = (this._hudT || 0) + dt) > 0.25) { this._hudT = 0; this.hud.setTourney(T, this.boardOf(T)); }
    if (T.t >= T.limit) this.finish('bell');
  }

  /** The dressing, by distance: drawn when near, the crowd posed nearer still, a figure put out a frame. */
  tendDressing(spec, dist, dt, t) {
    if (!spec.deco) return;
    const show = dist < DECO_R;
    if (spec.deco.visible !== show) spec.deco.visible = show;
    if (!show) return;
    if (spec.crowdTodo && spec.crowdTodo.length) {
      const c = spec.crowdTodo.shift();
      const ch = new Character(c.id, c.id === 'captain' ? null : lookFor(Math.floor(this.rng() * 1e6)), 1);
      spec.deco.add(ch.actor); ch.placeAt(c.x, c.z, c.f); ch.y = DECK_Y;
      spec.crowd.push(ch);
    }
    if (dist < CROWD_UPDATE_R && (this._frame % 3) === 0) {
      for (const ch of spec.crowd) if (ch.ready) { if (ch.model && ch.model.children[0] && ch.model.children[0].castShadow) ch.model.traverse((o) => { if (o.isMesh) o.castShadow = false; }); ch.update(dt * 3, t, () => DECK_Y); }
    }
  }

  /**
   * The weigh-in. The other baskets take their finals (a last fish on the
   * bell where one is still short); the player's basket is read off the
   * scales; and if it stands higher than the player is entitled to, the
   * judge finds the weights.
   */
  finish(reason) {
    const T = this.live; if (!T || T.done) return;
    T.done = true;
    const base = this.baseKg(T), fk = T.fishKg;
    for (const b of T.boats) {
      if (b.above) b.kg = Math.max(b.kg, base * (1 + b.margin) + fk * (0.6 + 0.4 * b.rank) + 0.05);
      else b.kg = Math.min(b.kg, Math.max(0, base - 0.05));
    }
    const golden = reason === 'golden';
    if (golden) { T.place = 1; T.payout = this.prizeFor(T, 1); for (const b of T.boats) { b.above = false; b.kg = Math.min(b.kg, Math.max(0, base - 0.05)); } }
    const rows = this.boardOf(T);
    const shown = T.shownPlace;
    const caught = !golden && this.prizeFor(T, shown) > this.prizeFor(T, T.place);
    const payout = this.prizeFor(T, T.place) + T.bonus;
    if (payout > 0) { this.player.balance += payout; this.rtp.book(payout); this.player.save(); }
    T.finalPlace = caught ? T.place : shown; T.caught = caught; T.paid = payout; T.golden = golden ? T.golden : T.golden;
    T.climbed = T.place0 - T.place;
    this.lastResult = { tier: T.tierId, place: T.place, shown, caught, golden, payout, weights: T.weights, honest: T.honest, climbed: T.climbed };
    // The word from the scales: the overlay when caught, then the results card.
    const result = { tier: T.tier.name, marina: T.dock.name, place: T.finalPlace, prize: payout, fee: T.fee, best: T.best, golden: golden ? T.golden : null, caught, shown, weights: T.weights, weightsKg: T.weightsKg, climbed: T.climbed, honestPlace: T.place, bonus: T.bonus, top: rows.slice(0, 3), you: rows.find((r) => r.you), field: T.boats.length + 1 };
    if (caught) this.hud.showWeighIn(this.audio);
    this.hud.setTourney(T, rows, true);
    result.podium = !caught && T.place <= 3;
    setTimeout(() => this.hud.showTourneyResult(result), caught ? 4200 : 900);
    // The field goes back to its own life, and the water to its own fish.
    for (const b of T.boats) { const f = b.f; f.tourney = false; f.idle = this.rng() < 0.4; f.state = 'idle'; f.timer = 0; f.endCast(); f.boat.anchored = false; f.matchSpecies = null; }
    this.npcs.holdSpawns = false; this.npcs.enabled = true;
    this.fishing.endMatch();
    if (this.ambientFish) this.ambientFish.setFeature(null);
    this.live = null;
    setTimeout(() => { if (!this.live) this.hud.hideTourney(); }, 6000);
  }
}
