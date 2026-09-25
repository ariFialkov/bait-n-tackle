// The marina: a boat store that opens when you pull up to a marina dock.
//
// Boats are sold as skins — same hull, same mechanics, but their own name,
// paint, price and a small speed/handling/wake spread. None of that touches
// the odds or the payout of a bet, which are drawn from the paytable in
// rtp.js against the stake alone. A dearer boat gets you between spots
// sooner; it cannot win you more per wager.

import { fleetCatalog, boatPortraitURL, featureList, BOATS } from './boats.js';
import { hullSkins } from './skins.js';
import { hullYawRate } from './hullphysics.js';

const $ = (id) => document.getElementById(id);

function money(v) {
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(v >= 1e7 ? 0 : 2).replace(/\.00$/, '') + 'M';
  if (v >= 1000) return '$' + Math.round(v).toLocaleString();
  return '$' + v.toFixed(v < 100 && v % 1 ? 2 : 0);
}

// Five pips filled against the best value anywhere in the fleet.
function pips(value, max, min = 0) {
  const span = Math.max(1e-6, max - min);
  const n = Math.max(1, Math.min(5, Math.round(((value - min) / span) * 5)));
  let out = '';
  for (let i = 0; i < 5; i++) out += `<i class="${i < n ? 'on' : ''}"></i>`;
  return out;
}

export class Marina {
  constructor(player, onChanged) {
    this.player = player;
    this.onChanged = onChanged;
    this.el = $('marina');
    this.grid = $('marina-grid');
    this.cashEl = $('marina-cash');
    this.titleEl = $('marina-title');
    this.open = false;
    this.dock = null;

    // Stat ranges across every skin in the game, so the pips mean something.
    // Handling is the hull's REAL yaw rate, not its agility rating: a long
    // hull gets far less out of the same rating, and the shop has to say so
    // or the pips promise a turn the boat cannot make.
    const every = BOATS.flatMap((h) => hullSkins(h).map((s) => ({ ...s, yaw: hullYawRate(s.turn, h.length) })));
    this.range = {
      speed: [Math.min(...every.map((s) => s.maxSpeed)), Math.max(...every.map((s) => s.maxSpeed))],
      turn: [Math.min(...every.map((s) => s.yaw)), Math.max(...every.map((s) => s.yaw))],
      wake: [Math.min(...every.map((s) => s.wake)), Math.max(...every.map((s) => s.wake))],
    };

    $('marina-close').addEventListener('click', () => this.close());
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.open) this.close();
    });
  }

  /** Open the store of a marina (`dock` carries its name and stock). */
  show(dock = null) {
    this.dock = dock;
    this.open = true;
    this.el.classList.remove('hidden');
    this.render();
  }

  close() {
    this.open = false;
    this.el.classList.add('hidden');
  }

  render() {
    const p = this.player;
    this.cashEl.textContent = money(p.balance);
    if (this.titleEl) this.titleEl.textContent = this.dock ? `⚓ ${this.dock.name}` : '⚓ Marina';
    this.grid.innerHTML = '';

    // Every skin of the fleet, keyed, for the two lists below.
    const bySkin = new Map();
    const catalog = fleetCatalog();
    for (const { hull, skins } of catalog) for (const sk of skins) bySkin.set(sk.key, { hull, skin: sk });

    // What this marina has on its docks. Only these can be bought here; a
    // rarer boat means finding the marina that carries it.
    const stock = (this.dock?.stock || []).map((k) => bySkin.get(k)).filter(Boolean);
    const shop = document.createElement('section');
    shop.className = 'hull-section marina-stock';
    shop.innerHTML =
      `<header class="hull-head"><h3>For sale here</h3>` +
      `<span class="hull-tag">${stock.length ? `${stock.length} boat${stock.length > 1 ? 's' : ''} on the docks` : 'nothing on the docks'}</span></header>` +
      `<p class="hull-blurb">Each marina carries its own few boats. The rarer the paint and the bigger the hull, the fewer yards you will find it at.</p>`;
    const srow = document.createElement('div');
    srow.className = 'skin-row';
    for (const { hull, skin } of stock) srow.appendChild(this.skinCard(hull, skin, true));
    shop.appendChild(srow);
    this.grid.appendChild(shop);

    // Everything the player owns, wherever it was bought: the marinas ship a
    // boat between them on the spot, so any of them can be taken from here.
    const owned = [...bySkin.values()].filter(({ skin }) => p.has(skin.key));
    const fleet = document.createElement('section');
    fleet.className = 'hull-section marina-fleet';
    fleet.innerHTML =
      `<header class="hull-head"><h3>Your fleet</h3>` +
      `<span class="hull-tag">${owned.length} boat${owned.length > 1 ? 's' : ''}</span>` +
      `<span class="hull-spec">shipped between marinas, free</span></header>` +
      `<p class="hull-blurb">Marina policy: any boat you own is brought round to whichever yard you are standing in, at once, for nothing. Pick one and it is alongside.</p>`;
    const frow = document.createElement('div');
    frow.className = 'skin-row';
    for (const { hull, skin } of owned) frow.appendChild(this.skinCard(hull, skin, false));
    fleet.appendChild(frow);
    this.grid.appendChild(fleet);

    // The hulls themselves, for reading about what each unlocks.
    const guide = document.createElement('section');
    guide.className = 'hull-section marina-guide';
    guide.innerHTML = `<header class="hull-head"><h3>The fleet</h3><span class="hull-tag">what each hull unlocks</span></header>` +
      catalog.map(({ hull }) => {
        const feats = featureList(hull);
        return `<div class="hull-line"><b>${hull.name}</b> <span class="hull-spec">${hull.rods} rod${hull.rods > 1 ? 's' : ''}</span>` +
          (feats.length ? `<div class="boat-feats">${feats.map((f) => `<span>${f}</span>`).join('')}</div>` : '') +
          `<p class="hull-blurb">${hull.blurb}</p></div>`;
      }).join('');
    this.grid.appendChild(guide);
  }

  skinCard(hull, skin, forSale) {
    const p = this.player;
    const owned = p.has(skin.key);
    const equipped = p.boatId === skin.key;
    const afford = p.balance >= skin.price;

    const card = document.createElement('div');
    card.className = `boat-card rar-${skin.rarity}` + (equipped ? ' equipped' : '');
    card.innerHTML =
      `<div class="boat-img-wrap">` +
        `<img alt="${skin.name} ${hull.name}" loading="lazy"` +
        ` src="${boatPortraitURL(hull.id, skin.id)}">` +
        (equipped ? `<span class="boat-flag">SAILING</span>`
          : owned ? `<span class="boat-flag owned">OWNED</span>` : '') +
      `</div>` +
      `<div class="skin-rarity">${skin.rarityName} · ${hull.name}</div>` +
      `<div class="boat-name">${skin.name} ${hull.name}</div>` +
      `<div class="boat-stats">` +
        `<div class="bs"><span>Speed</span><em>${pips(skin.maxSpeed, this.range.speed[1], this.range.speed[0] - 1)}</em></div>` +
        `<div class="bs"><span>Handling</span><em>${pips(hullYawRate(skin.turn, hull.length), this.range.turn[1], this.range.turn[0] - 0.2)}</em></div>` +
        `<div class="bs"><span>Wake</span><em>${pips(skin.wake, this.range.wake[1], this.range.wake[0] - 0.1)}</em></div>` +
      `</div>`;

    const actions = document.createElement('div');
    actions.className = 'boat-actions';
    if (equipped) {
      actions.innerHTML = `<button class="boat-btn" disabled>Currently sailing</button>`;
    } else if (owned) {
      const btn = document.createElement('button');
      btn.className = 'boat-btn go';
      btn.textContent = 'Set sail';
      btn.addEventListener('click', () => this.pick(skin.key));
      actions.appendChild(btn);
    } else {
      const btn = document.createElement('button');
      btn.className = 'boat-btn buy' + (afford ? '' : ' poor');
      btn.textContent = afford ? `Buy · ${money(skin.price)}` : money(skin.price);
      btn.disabled = !afford;
      btn.addEventListener('click', () => this.purchase(skin.key));
      actions.appendChild(btn);
    }
    card.appendChild(actions);
    return card;
  }

  purchase(key) {
    if (this.player.buy(key)) this.pick(key);
    else this.render();
  }

  pick(key) {
    if (this.player.equip(key)) {
      this.render();
      if (this.onChanged) this.onChanged(key);
    }
  }
}
