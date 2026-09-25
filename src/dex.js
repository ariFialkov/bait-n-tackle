// Fishopedia: an encyclopedia overlay reachable from the menu. One card per
// species — rendered icon, tier, value range, weight range, preferred bait,
// which water it lives in and its favourite corner of it (flavor only:
// where you fish changes which fish you see, never what a catch pays).

import { SPECIES, TIER_NAMES } from './fishdata.js';
import { icon } from './icons.js';
import { LURES, NETS } from './config.js';
import { fishIconURL } from './fishicons.js';
import { speciesAreas } from './fishmodels.js';

function money(v) {
  return '$' + (v >= 100 ? Math.round(v).toLocaleString() : v.toFixed(2));
}

function kgRange(kg) {
  const lo = kg * 0.25, hi = kg * 2.56; // size roll 0.5-1.6, weight ~ size^2
  const f = (v) => (v < 1 ? v.toFixed(2) : v < 10 ? v.toFixed(1) : Math.round(v).toLocaleString());
  return `${f(lo)}–${f(hi)} kg`;
}

function baitFor(species) {
  const parts = [];
  // Lightest net rated for this tier (legends are casting-only).
  const net = NETS.find((n) => n.maxTier >= species.tier);
  if (net) parts.push(`${icon(net.icon, 'inl')}${net.name}`);
  const lure = LURES.find(
    (l) => species.tier >= l.tiers[0] && species.tier <= l.tiers[1]);
  if (lure) parts.push(`${icon(lure.icon, 'inl')}${lure.name}`);
  return parts.join(' · ');
}

export class Dex {
  constructor() {
    this.el = document.getElementById('dex');
    this.grid = document.getElementById('dex-grid');
    this.built = false;
    this.filter = 'all';
    this.cards = [];
    document.getElementById('dex-btn').addEventListener('click', () => this.open());
    document.getElementById('dex-close').addEventListener('click', () => this.close());
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });
    for (const btn of this.el.querySelectorAll('.dex-filter button')) {
      btn.addEventListener('click', () => this.setFilter(btn.dataset.water));
    }
    const count = document.getElementById('dex-count');
    if (count) count.textContent = `${SPECIES.length} species`;
  }

  open() {
    this.el.classList.remove('hidden');
    if (!this.built) {
      this.built = true;
      this.build();
    }
  }

  close() {
    this.el.classList.add('hidden');
  }

  /** Show all species, only the river's, or only the sea's. */
  setFilter(water) {
    this.filter = water;
    for (const btn of this.el.querySelectorAll('.dex-filter button')) {
      btn.classList.toggle('on', btn.dataset.water === water);
    }
    let n = 0;
    for (const [card, s] of this.cards) {
      const show = water === 'all' || s.water === water;
      card.classList.toggle('hidden', !show);
      if (show) n++;
    }
    const count = document.getElementById('dex-count');
    if (count) count.textContent = `${n} species`;
  }

  build() {
    const frag = document.createDocumentFragment();
    for (const s of SPECIES) {
      const card = document.createElement('div');
      card.className = `dex-card tier-${s.tier} ${s.water}`;
      card.innerHTML =
        `<div class="dex-img-wrap"><img alt="${s.name}" loading="lazy"></div>` +
        `<div class="dex-name">${s.name}</div>` +
        `<div class="dex-tier">${TIER_NAMES[s.tier]}<span class="dex-water">${s.water === 'salt' ? 'Saltwater' : 'Freshwater'}</span></div>` +
        `<div class="dex-rows">` +
        `<div class="dex-row"><span>Value</span><b>${money(s.value * 0.5)} – ${money(s.value * 1.6)}</b></div>` +
        `<div class="dex-row"><span>Weight</span><b>${kgRange(s.kg)}</b></div>` +
        `<div class="dex-row"><span>Bait</span><b>${baitFor(s)}</b></div>` +
        `<div class="dex-row"><span>Waters</span><b>${speciesAreas(s).join(' · ')}</b></div>` +
        `</div>`;
      frag.appendChild(card);
      this.cards.push([card, s]);
    }
    this.grid.appendChild(frag);
    this.setFilter(this.filter);

    // Render icons in small chunks so opening the dex never stutters.
    let i = 0;
    const cards = this.cards;
    const step = () => {
      const end = Math.min(i + 4, cards.length);
      for (; i < end; i++) {
        const [card, s] = cards[i];
        card.querySelector('img').src = fishIconURL(s);
      }
      if (i < cards.length) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
}
