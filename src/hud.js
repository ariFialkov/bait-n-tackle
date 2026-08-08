// DOM HUD: balance/round chips, lure selector, hints, catch cards, bite
// indicator, plus the menu overlay.

import { LURES, NETS } from './config.js';
import { TIER_NAMES } from './fishdata.js';
import { fishIconURL } from './fishicons.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor() {
    this.el = {
      balance: $('balance'),
      round: $('round-net'),
      lures: $('lure-panel'),
      lureToggle: $('lure-toggle'),
      nets: $('net-panel'),
      netToggle: $('net-toggle'),
      hint: $('hint'),
      bite: $('bite'),
      toasts: $('toasts'),
      menu: $('menu'),
      play: $('play-btn'),
      hud: $('hud'),
      trawlBadge: $('trawl-badge'),
      newRound: $('new-round'),
      bigcatch: $('bigcatch'),
    };
    this.hintTimer = null;
    this.onLureSelect = null;
    this.onNetSelect = null;
    this.bigcatchTimer = null;
    this.valueTween = null;
    this.buildGearPanel(this.el.lures, LURES,
      (l) => `$${l.cost}`, (i) => this.onLureSelect && this.onLureSelect(i));
    this.buildGearPanel(this.el.nets, NETS,
      (n) => `$${n.costPerM.toFixed(2)}/m`, (i) => this.onNetSelect && this.onNetSelect(i));

    this.el.bigcatch.classList.add('hidden');
    this.el.bigcatch.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.hideBigCatch();
    });

    // Opening one gear panel closes the other.
    this.el.lureToggle.addEventListener('click', () => {
      this.el.lures.classList.toggle('collapsed');
      this.el.nets.classList.add('collapsed');
    });
    this.el.netToggle.addEventListener('click', () => {
      this.el.nets.classList.toggle('collapsed');
      this.el.lures.classList.add('collapsed');
    });
  }

  buildGearPanel(panel, items, costLabel, onSelect) {
    panel.querySelectorAll('.lure').forEach((n) => n.remove());
    items.forEach((item, i) => {
      const btn = document.createElement('button');
      btn.className = 'lure' + (i === 0 ? ' selected' : '');
      btn.innerHTML = `<span class="lure-emoji">${item.emoji}</span>` +
        `<span class="lure-name">${item.name}</span>` +
        `<span class="lure-cost">${costLabel(item)}</span>`;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (onSelect(i) === false) return; // rejected (e.g. net still in the water)
        panel.querySelectorAll('.lure').forEach((n) => n.classList.remove('selected'));
        btn.classList.add('selected');
      });
      panel.appendChild(btn);
    });
  }

  setWallet(balance, roundNet) {
    this.el.balance.textContent = '$' + balance.toFixed(2);
    const sign = roundNet >= 0 ? '+' : '−';
    this.el.round.textContent = `${sign}$${Math.abs(roundNet).toFixed(2)}`;
    this.el.round.classList.toggle('up', roundNet >= 0);
    this.el.round.classList.toggle('down', roundNet < 0);
  }

  hint(text, ms = 2600) {
    this.el.hint.textContent = text;
    this.el.hint.classList.add('show');
    clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => this.el.hint.classList.remove('show'), ms);
  }

  setBite(on) {
    this.el.bite.classList.toggle('show', on);
  }

  setTrawling(on, net) {
    this.el.trawlBadge.classList.toggle('show', on);
    if (on && net) this.el.trawlBadge.textContent = `${net.emoji} ${net.name.toUpperCase()}`;
  }

  toast(html, cls = '', ms = 3400) {
    const div = document.createElement('div');
    div.className = 'toast ' + cls;
    div.innerHTML = html;
    this.el.toasts.appendChild(div);
    requestAnimationFrame(() => div.classList.add('in'));
    setTimeout(() => {
      div.classList.remove('in');
      setTimeout(() => div.remove(), 400);
    }, ms);
  }

  showCatch(c, wager) {
    const profit = c.value - wager;
    const cls = profit >= 0 ? 'win' : 'meh';
    this.toast(
      `<img class="catch-icon" src="${fishIconURL(c.species)}" alt="">` +
      `<div class="catch-body"><div class="catch-name">${c.species.name}</div>` +
      `<div class="catch-sub">${c.kg.toFixed(c.kg < 1 ? 2 : 1)} kg</div></div>` +
      `<div class="catch-value">$${c.value.toFixed(2)}</div>`, cls, 4200);
  }

  showTrawlHaul(catches, total) {
    const best = catches.reduce((a, b) => (b.value > a.value ? b : a));
    const names = catches.map((c) => c.species.name).join(', ');
    this.toast(
      `<img class="catch-icon" src="${fishIconURL(best.species)}" alt="">` +
      `<div class="catch-body"><div class="catch-name">Net haul ×${catches.length}</div>` +
      `<div class="catch-sub">${names}</div></div>` +
      `<div class="catch-value">$${total.toFixed(2)}</div>`, 'trawl', 3200);
  }

  /** Pack-opening style reveal for high-value catches. */
  showBigCatch(c) {
    const el = this.el.bigcatch;
    const tierCls = c.species.tier >= 5 ? 'legendary' : c.species.tier >= 4 ? 'epic' : 'rare';
    const tierLabel = c.species.tier >= 5 ? 'Legendary Catch'
      : c.species.tier >= 4 ? 'Trophy Catch' : TIER_NAMES[c.species.tier];
    el.className = tierCls; // clears hidden/leaving too
    el.querySelector('.bc-tier').textContent = tierLabel;
    el.querySelector('.bc-fish-img').src = fishIconURL(c.species);
    el.querySelector('.bc-name').textContent = c.species.name;
    el.querySelector('.bc-sub').textContent =
      `${c.kg.toFixed(c.kg < 1 ? 2 : 1)} kg · ${Math.round(c.sizeMult * 100)}% size`;

    // Count the value up, easing out, FIFA style.
    const valueEl = el.querySelector('.bc-value');
    cancelAnimationFrame(this.valueTween);
    const start = performance.now(), dur = 1300;
    const tick = (now) => {
      const k = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - k, 3);
      valueEl.textContent = '$' + (c.value * eased).toFixed(2);
      if (k < 1) this.valueTween = requestAnimationFrame(tick);
    };
    this.valueTween = requestAnimationFrame(tick);

    clearTimeout(this.bigcatchTimer);
    this.bigcatchTimer = setTimeout(() => this.hideBigCatch(), 5200);
  }

  hideBigCatch() {
    const el = this.el.bigcatch;
    if (el.classList.contains('hidden')) return;
    clearTimeout(this.bigcatchTimer);
    el.classList.add('leaving');
    setTimeout(() => { el.className = 'hidden'; }, 380);
  }

  showMenu(onPlay) {
    this.el.menu.classList.remove('hidden');
    this.el.hud.classList.add('hidden');
    this.el.play.onclick = () => {
      this.el.menu.classList.add('leaving');
      setTimeout(() => {
        this.el.menu.classList.add('hidden');
        this.el.menu.classList.remove('leaving');
      }, 900);
      this.el.hud.classList.remove('hidden');
      onPlay();
    };
  }

  bindNewRound(fn) {
    this.el.newRound.addEventListener('click', (e) => {
      e.stopPropagation();
      fn();
    });
  }
}
