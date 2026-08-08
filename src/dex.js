// Fishopedia: an encyclopedia overlay reachable from the menu. One card per
// species — rendered icon, tier, value range, weight range, preferred bait
// and favourite water (flavor only: where you fish never changes what a
// catch pays).

import { SPECIES, TIER_NAMES } from './fishdata.js';
import { LURES } from './config.js';
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
  const lures = LURES.filter(
    (l) => species.tier >= l.tiers[0] && species.tier <= l.tiers[1]);
  const names = lures.slice(0, 2).map((l) => `${l.emoji} ${l.name}`);
  if (species.tier <= 1) names.unshift('🕸️ Trawl net');
  return names.slice(0, 2).join(' · ');
}

export class Dex {
  constructor() {
    this.el = document.getElementById('dex');
    this.grid = document.getElementById('dex-grid');
    this.built = false;
    document.getElementById('dex-btn').addEventListener('click', () => this.open());
    document.getElementById('dex-close').addEventListener('click', () => this.close());
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });
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

  build() {
    const frag = document.createDocumentFragment();
    const cards = [];
    for (const s of SPECIES) {
      const card = document.createElement('div');
      card.className = 'dex-card tier-' + s.tier;
      card.innerHTML =
        `<div class="dex-img-wrap"><img alt="${s.name}" loading="lazy"></div>` +
        `<div class="dex-name">${s.name}</div>` +
        `<div class="dex-tier">${TIER_NAMES[s.tier]}</div>` +
        `<div class="dex-rows">` +
        `<div class="dex-row"><span>Value</span><b>${money(s.value * 0.5)} – ${money(s.value * 1.6)}</b></div>` +
        `<div class="dex-row"><span>Weight</span><b>${kgRange(s.kg)}</b></div>` +
        `<div class="dex-row"><span>Bait</span><b>${baitFor(s)}</b></div>` +
        `<div class="dex-row"><span>Waters</span><b>${speciesAreas(s).join(' · ')}</b></div>` +
        `</div>`;
      frag.appendChild(card);
      cards.push([card, s]);
    }
    this.grid.appendChild(frag);

    // Render icons in small chunks so opening the dex never stutters.
    let i = 0;
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
