// The marina: a boat store that opens when you pull up to a marina dock.
//
// Boats are sold as skins — same hull, same mechanics, but their own name,
// paint, price and a small speed/handling/wake spread. None of that touches
// the odds or the payout of a bet, which are drawn from the paytable in
// rtp.js against the stake alone. A dearer boat gets you between spots
// sooner; it cannot win you more per wager.

import { fleetCatalog, boatPortraitURL, featureList, BOATS } from './boats.js';
import { hullSkins } from './skins.js';

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
    this.open = false;

    // Stat ranges across every skin in the game, so the pips mean something.
    const every = BOATS.flatMap((h) => hullSkins(h));
    this.range = {
      speed: [Math.min(...every.map((s) => s.maxSpeed)), Math.max(...every.map((s) => s.maxSpeed))],
      turn: [Math.min(...every.map((s) => s.turn)), Math.max(...every.map((s) => s.turn))],
      wake: [Math.min(...every.map((s) => s.wake)), Math.max(...every.map((s) => s.wake))],
    };

    $('marina-close').addEventListener('click', () => this.close());
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.open) this.close();
    });
  }

  show() {
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
    this.grid.innerHTML = '';

    for (const { hull, skins } of fleetCatalog()) {
      const ownsAny = skins.some((s) => p.has(s.key));
      const section = document.createElement('section');
      section.className = 'hull-section' + (ownsAny ? '' : ' unowned');

      const feats = featureList(hull);
      section.innerHTML =
        `<header class="hull-head">` +
          `<h3>${hull.name}</h3>` +
          `<span class="hull-tag">${hull.tagline}</span>` +
          `<span class="hull-spec">${hull.rods} rod${hull.rods > 1 ? 's' : ''}</span>` +
        `</header>` +
        (feats.length
          ? `<div class="boat-feats">${feats.map((f) => `<span>${f}</span>`).join('')}</div>`
          : '') +
        `<p class="hull-blurb">${hull.blurb}</p>`;

      const row = document.createElement('div');
      row.className = 'skin-row';
      for (const skin of skins) row.appendChild(this.skinCard(hull, skin));
      section.appendChild(row);
      this.grid.appendChild(section);
    }
  }

  skinCard(hull, skin) {
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
      `<div class="skin-rarity">${skin.rarityName}</div>` +
      `<div class="boat-name">${skin.name}</div>` +
      `<div class="boat-stats">` +
        `<div class="bs"><span>Speed</span><em>${pips(skin.maxSpeed, this.range.speed[1], this.range.speed[0] - 1)}</em></div>` +
        `<div class="bs"><span>Handling</span><em>${pips(skin.turn, this.range.turn[1], this.range.turn[0] - 0.4)}</em></div>` +
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
