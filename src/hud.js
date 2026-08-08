// DOM HUD: balance/round chips, lure selector, hints, catch cards, bite
// indicator, plus the menu overlay.

import { LURES } from './config.js';

const $ = (id) => document.getElementById(id);

function fishEmoji(tier) {
  return ['🐠', '🐟', '🐟', '🎣', '🦈', '🐋'][tier] || '🐟';
}

export class HUD {
  constructor() {
    this.el = {
      balance: $('balance'),
      round: $('round-net'),
      lures: $('lure-panel'),
      lureToggle: $('lure-toggle'),
      hint: $('hint'),
      bite: $('bite'),
      toasts: $('toasts'),
      menu: $('menu'),
      play: $('play-btn'),
      hud: $('hud'),
      trawlBadge: $('trawl-badge'),
      newRound: $('new-round'),
    };
    this.hintTimer = null;
    this.onLureSelect = null;
    this.buildLures();

    this.el.lureToggle.addEventListener('click', () => {
      this.el.lures.classList.toggle('collapsed');
    });
  }

  buildLures() {
    this.el.lures.querySelectorAll('.lure').forEach((n) => n.remove());
    LURES.forEach((lure, i) => {
      const btn = document.createElement('button');
      btn.className = 'lure' + (i === 0 ? ' selected' : '');
      btn.innerHTML = `<span class="lure-emoji">${lure.emoji}</span>` +
        `<span class="lure-name">${lure.name}</span>` +
        `<span class="lure-cost">$${lure.cost}</span>`;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.el.lures.querySelectorAll('.lure').forEach((n) => n.classList.remove('selected'));
        btn.classList.add('selected');
        if (this.onLureSelect) this.onLureSelect(i);
        this.hint(`${lure.name} — $${lure.cost} per cast`);
      });
      this.el.lures.appendChild(btn);
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

  setCasting(on) {
    if (on) this.hint('Line out — tap / click to reel', 4000);
  }

  setTrawling(on) {
    this.el.trawlBadge.classList.toggle('show', on);
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
      `<div class="catch-emoji">${fishEmoji(c.species.tier)}</div>` +
      `<div class="catch-body"><div class="catch-name">${c.species.name}</div>` +
      `<div class="catch-sub">${c.kg.toFixed(c.kg < 1 ? 2 : 1)} kg</div></div>` +
      `<div class="catch-value">$${c.value.toFixed(2)}</div>`, cls, 4200);
  }

  showTrawlHaul(catches, total) {
    const names = catches.map((c) => c.species.name).join(', ');
    this.toast(
      `<div class="catch-emoji">🕸️</div>` +
      `<div class="catch-body"><div class="catch-name">Net haul ×${catches.length}</div>` +
      `<div class="catch-sub">${names}</div></div>` +
      `<div class="catch-value">$${total.toFixed(2)}</div>`, 'trawl', 3200);
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
