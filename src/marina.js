// The marina: a boat store that opens when you pull up to a marina dock.
// Boats are cosmetic and logistical only — more rods, more hold, different
// handling, and mechanic unlocks. None of them touch the odds or the payout
// of a bet, so nothing here can be bought for a better return.

import { BOATS, boatPortraitURL, featureList } from './boats.js';

const $ = (id) => document.getElementById(id);

function money(v) {
  return '$' + (v >= 1000 ? Math.round(v).toLocaleString()
    : v.toFixed(v < 100 ? 2 : 0));
}

function kg(v) {
  return v >= 1000 ? (v / 1000).toFixed(1) + ' t' : Math.round(v) + ' kg';
}

// Five pips, filled proportionally to the best boat in the fleet.
function pips(value, max) {
  const n = Math.max(1, Math.round((value / max) * 5));
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
    const maxSpeed = Math.max(...BOATS.map((b) => b.maxSpeed));
    const maxTurn = Math.max(...BOATS.map((b) => b.turn));
    const maxHold = Math.max(...BOATS.map((b) => b.hold));
    const maxRods = Math.max(...BOATS.map((b) => b.rods));

    this.grid.innerHTML = '';
    for (const b of BOATS) {
      const owned = p.has(b.id);
      const equipped = p.boatId === b.id;
      const afford = p.balance >= b.price;
      const locked = !!b.comingSoon;

      const card = document.createElement('div');
      card.className = 'boat-card' +
        (equipped ? ' equipped' : '') + (locked ? ' locked' : '');

      const feats = featureList(b);
      card.innerHTML =
        `<div class="boat-img-wrap">` +
          (locked
            ? `<div class="boat-img-soon">⚓</div>`
            : `<img alt="${b.name}" loading="lazy" src="${boatPortraitURL(b.id)}">`) +
          (equipped ? `<span class="boat-flag">SAILING</span>`
            : owned ? `<span class="boat-flag owned">OWNED</span>`
            : locked ? `<span class="boat-flag soon">COMING SOON</span>` : '') +
        `</div>` +
        `<div class="boat-name">${b.name}</div>` +
        `<div class="boat-tag">${b.tagline}</div>` +
        `<div class="boat-stats">` +
          `<div class="bs"><span>Rods</span><b>${b.rods}</b></div>` +
          `<div class="bs"><span>Hold</span><b>${kg(b.hold)}</b></div>` +
          `<div class="bs"><span>Speed</span><em>${pips(b.maxSpeed, maxSpeed)}</em></div>` +
          `<div class="bs"><span>Nimble</span><em>${pips(b.turn, maxTurn)}</em></div>` +
        `</div>` +
        (feats.length ? `<div class="boat-feats">${feats.map(
          (f) => `<span>${f}</span>`).join('')}</div>` : '') +
        `<div class="boat-blurb">${b.blurb}</div>`;

      const actions = document.createElement('div');
      actions.className = 'boat-actions';
      if (locked) {
        actions.innerHTML = `<button class="boat-btn" disabled>Not yet in the water</button>`;
      } else if (equipped) {
        actions.innerHTML = `<button class="boat-btn" disabled>Currently sailing</button>`;
      } else if (owned) {
        const btn = document.createElement('button');
        btn.className = 'boat-btn go';
        btn.textContent = 'Set sail';
        btn.addEventListener('click', () => this.pick(b.id));
        actions.appendChild(btn);
      } else {
        const btn = document.createElement('button');
        btn.className = 'boat-btn buy' + (afford ? '' : ' poor');
        btn.textContent = afford ? `Buy · ${money(b.price)}` : `${money(b.price)}`;
        btn.disabled = !afford;
        btn.addEventListener('click', () => this.purchase(b.id));
        actions.appendChild(btn);
      }
      card.appendChild(actions);

      // Hold must be empty before switching hulls — you cannot move a catch
      // between boats, and nothing may ever be destroyed.
      if (!equipped && owned && this.player.hold.length) {
        const warn = document.createElement('div');
        warn.className = 'boat-warn';
        warn.textContent = 'Sell your hold first — catches do not transfer';
        card.appendChild(warn);
      }

      this.grid.appendChild(card);
    }
  }

  purchase(id) {
    if (this.player.buy(id)) {
      this.pick(id);
    } else {
      this.render();
    }
  }

  pick(id) {
    if (this.player.hold.length && this.player.boatId !== id) {
      this.render();
      return;
    }
    if (this.player.equip(id)) {
      this.render();
      if (this.onChanged) this.onChanged(id);
    }
  }
}
