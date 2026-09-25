// DOM HUD: balance/round chips, lure selector, hints, catch cards, bite
// indicator, plus the menu overlay.

import { LURES, NETS, POTS } from './config.js';
import { icon } from './icons.js';
import { TIER_NAMES } from './fishdata.js';
import { fishIconURL } from './fishicons.js';

const $ = (id) => document.getElementById(id);

// How long a haul notice stays up, then how long it takes to fade. The net
// shows the haul's fish for exactly as long (net.js), so the two go together.
export const HAUL_TOAST_MS = 3200;
export const TOAST_FADE_MS = 400;

// The arrow icon points RIGHT at rest; a bearing of 0 means straight up the
// screen, so every arrow is turned back a quarter before its bearing.
const arrowRot = (bearing) => `rotate(${bearing - Math.PI / 2}rad)`;

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
      menuBtn: $('menu-btn'),
      bigcatch: $('bigcatch'),
      boatName: $('boat-name'),
      boatRods: $('boat-rods'),
      finderMarina: $('finder-marina'),
      sonar: $('sonar'),
      sonarRows: $('sonar-rows'),
      potBtn: $('pot-btn'),
      potCount: $('pot-count'),
      pots: $('pot-panel'),
      autoReel: $('autoreel-btn'),
      shipToggle: $('ship-toggle'),
      ship: $('ship-panel'),
      tenderChip: $('tender-chip'),
      tcBudget: $('tc-budget'),
      tenderReport: $('tender-report'),
      trRows: $('tr-rows'),
      trTotal: $('tr-total'),
      trClose: $('tr-close'),
      region: $('region-name'),
    };
    this.regionTimer = null;
    this.hintTimer = null;
    this.onLureSelect = null;
    this.onNetSelect = null;
    this.bigcatchTimer = null;
    this.valueTween = null;
    this.onPot = null;
    this.onPotSelect = null;
    this.rods = 1;
    this._sonarKey = '';
    // The pot button opens the pot panel: Drop pot at the top, then the
    // three pots to choose from (each its own stake and bait).
    this.el.potBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.el.pots.classList.toggle('collapsed');
      this.el.lures.classList.add('collapsed');
      this.el.nets.classList.add('collapsed');
      this.el.ship.classList.add('collapsed');
    });
    this.el.potAction = document.createElement('button');
    this.el.potAction.className = 'gear-action';
    this.el.potAction.innerHTML = '<span>Drop pot</span>';
    this.el.potAction.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.onPot) this.onPot();
    });
    this.el.pots.appendChild(this.el.potAction);
    this.buildGearPanel(this.el.pots, POTS,
      (p) => `$${p.stake}`, (i) => this.onPotSelect && this.onPotSelect(i));
    this.onAutoReel = null;
    this.el.autoReel.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.onAutoReel) this.onAutoReel();
    });
    this.el.trClose.addEventListener('click', (e) => {
      e.stopPropagation();
      this.el.tenderReport.classList.add('hidden');
    });
    this.el.shipToggle.addEventListener('click', () => {
      const opening = this.el.ship.classList.contains('collapsed');
      this.el.ship.classList.toggle('collapsed');
      this.el.lures.classList.add('collapsed');
      this.el.nets.classList.add('collapsed');
      this.el.pots.classList.add('collapsed');
      if (opening && this.onShipOpen) this.onShipOpen();
    });
    // Ship-systems callbacks, wired by main.js
    this.onShipOpen = null;
    this.onCrew = null;
    this.onTenderLaunch = null;
    this.onTenderSwitch = null;
    this.onTenderSend = null;
    this.crewOn = false;
    this.bag = LURES.map(() => 0);     // the bait the tender will be sent out with
    this.buildGearPanel(this.el.lures, LURES,
      (l) => `$${l.cost}`, (i) => this.onLureSelect && this.onLureSelect(i));
    // Net down / net up, at the top of the net panel: the same as tapping
    // the net itself on the stern.
    this.onNetToggle = null;
    this.el.netAction = document.createElement('button');
    this.el.netAction.className = 'gear-action';
    this.el.netAction.innerHTML = '<span>Deploy net</span>';
    this.el.netAction.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.onNetToggle) this.onNetToggle();
    });
    this.el.nets.appendChild(this.el.netAction);
    this.buildGearPanel(this.el.nets, NETS,
      (n) => `$${n.costPerM.toFixed(2)}/m`, (i) => this.onNetSelect && this.onNetSelect(i));

    this.el.bigcatch.classList.add('hidden');
    this.el.bigcatch.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.hideBigCatch();
    });

    // Opening one gear panel closes the others.
    this.el.lureToggle.addEventListener('click', () => {
      this.el.lures.classList.toggle('collapsed');
      this.el.nets.classList.add('collapsed');
      this.el.pots.classList.add('collapsed');
    });
    this.el.netToggle.addEventListener('click', () => {
      this.el.nets.classList.toggle('collapsed');
      this.el.lures.classList.add('collapsed');
      this.el.pots.classList.add('collapsed');
    });
  }

  buildGearPanel(panel, items, costLabel, onSelect) {
    panel.querySelectorAll('.lure').forEach((n) => n.remove());
    items.forEach((item, i) => {
      const btn = document.createElement('button');
      btn.className = 'lure' + (i === 0 ? ' selected' : '');
      btn.innerHTML = `<span class="lure-emoji">${icon(item.icon)}</span>` +
        `<span class="lure-name">${item.name}` +
          (item.bait ? `<span class="lure-sub">${item.bait}</span>` : '') + `</span>` +
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

  // --- side bets ---
  /** An offer from another boat: name, title, text, stake; accept/decline run on the buttons or the timer. */
  showChallenge(offer, onAccept, onDecline) {
    const el = $('challenge');
    el.querySelector('.ch-name').textContent = offer.npc.name;
    el.querySelector('.ch-title').textContent = offer.title;
    el.querySelector('.ch-text').textContent = offer.text;
    el.querySelector('.ch-stake').textContent = `$${offer.stake} down · winner takes the purse`;
    el.classList.remove('hidden');
    const a = $('ch-accept'), d = $('ch-decline');
    a.onclick = (e) => { e.stopPropagation(); onAccept(); };
    d.onclick = (e) => { e.stopPropagation(); onDecline(); };
    this._chStart = performance.now();
    clearInterval(this._chTick);
    this._chTick = setInterval(() => { const left = Math.max(0, 14 - Math.floor((performance.now() - this._chStart) / 1000)); el.querySelector('.ch-timer').textContent = left; }, 250);
    el.querySelector('.ch-timer').textContent = '14';
  }
  hideChallenge() { $('challenge').classList.add('hidden'); clearInterval(this._chTick); }
  /** The live bet: `you` and `npc` are progress 0..1 for a race, kilograms for a match. */
  setComp(c, you, npc) {
    const el = $('comp');
    el.classList.remove('hidden');
    el.querySelector('.comp-title').textContent = c.kind === 'fishing' ? `${c.species.name} match` : `${c.title} · ${c.goal.name}`;
    $('comp-npc-name').textContent = c.npc.name;
    if (c.kind === 'fishing') {
      const top = Math.max(1, you, npc);
      $('comp-you').style.width = `${(you / top) * 100}%`; $('comp-npc').style.width = `${(npc / top) * 100}%`;
      $('comp-you-v').textContent = `${you.toFixed(1)} kg`; $('comp-npc-v').textContent = `${npc.toFixed(1)} kg`;
    } else {
      $('comp-you').style.width = `${you * 100}%`; $('comp-npc').style.width = `${npc * 100}%`;
      $('comp-you-v').textContent = `${Math.round(you * 100)}%`; $('comp-npc-v').textContent = `${Math.round(npc * 100)}%`;
    }
    const left = Math.max(0, c.limit - c.t);
    $('comp-clock').textContent = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
    $('comp-stake').textContent = `$${c.stake} down`;
  }
  clearComp() { $('comp').classList.add('hidden'); }

  // --- boat chip ---
  setBoat(spec) {
    this.rods = spec.rods;
    this.el.boatName.textContent = spec.name;
    this.el.boatRods.innerHTML = `${icon('rod')}<span>${spec.rods} rod${spec.rods > 1 ? 's' : ''}</span>`;
    this.el.netToggle.classList.toggle('hidden', !spec.features.trawl);
    this.el.potBtn.classList.toggle('hidden', !spec.features.pots);
    this.el.sonar.classList.toggle('hidden', !spec.features.sonar);
    if (!spec.features.trawl) this.el.nets.classList.add('collapsed');
    if (!spec.features.pots) this.el.pots.classList.add('collapsed');
  }

  setRodCount(n) { this.rods = n; }

  setCrew(on) { this.crewOn = on; }

  /**
   * Rebuild the ship-systems panel for the current hull. Only the systems a
   * boat actually has appear, so the panel stays empty-and-hidden on the
   * smaller hulls.
   */
  buildShipPanel(spec, state = {}) {
    const f = spec.features || {};
    const any = f.crew || f.tender;
    this.el.shipToggle.classList.toggle('hidden', !any);
    if (!any) {
      this.el.ship.classList.add('collapsed');
      this.el.ship.innerHTML = '';
      return;
    }
    this.el.ship.innerHTML = '';

    const group = (title) => {
      const g = document.createElement('div');
      g.className = 'ship-group';
      g.innerHTML = `<div class="ship-title">${title}</div>`;
      this.el.ship.appendChild(g);
      return g;
    };
    const button = (parent, label, extra, on, handler, disabled = false) => {
      const b = document.createElement('button');
      b.className = 'ship-btn' + (on ? ' on' : '');
      b.innerHTML = `<span>${label}</span>` + (extra ? `<em>${extra}</em>` : '');
      b.disabled = disabled;
      b.addEventListener('click', (e) => { e.stopPropagation(); handler(); });
      parent.appendChild(b);
      return b;
    };

    if (f.crew) {
      const g = group('Crew');
      button(g, this.crewOn ? 'Crew working' : 'Hire the crew',
        `${spec.rods} rods`, this.crewOn,
        () => this.onCrew && this.onCrew());
      const note = document.createElement('div');
      note.className = 'ship-note';
      note.textContent = 'The crew work the rods on exactly the same terms you do.';
      g.appendChild(note);
    }

    if (f.tender) {
      const g = group('Tender');
      const t = state.tender || {};
      button(g, t.busy ? 'Crane working…' : t.deployed ? 'Recall tender' : 'Launch tender',
        null, t.deployed, () => this.onTenderLaunch && this.onTenderLaunch(), !!t.busy);
      if (t.deployed) {
        button(g, t.controlling ? 'Take the seiner' : 'Take the tender',
          null, t.controlling, () => this.onTenderSwitch && this.onTenderSwitch(),
          t.auto);
        if (t.auto) {
          const note = document.createElement('div');
          note.className = 'ship-note';
          note.textContent = 'Out fishing on its own — recall is available once it is back.';
          g.appendChild(note);
        } else {
          this.buildBaitBag(g, state.balance || 0);
        }
      }
    }
  }

  /**
   * The bag of bait the tender goes out with: a count of each lure, with
   * the total stake shown, and one button to send it. Counts live on the
   * HUD so a panel rebuild (every click rebuilds it) keeps them.
   */
  buildBaitBag(parent, balance) {
    const sub = document.createElement('div');
    sub.className = 'ship-title';
    sub.style.marginTop = '6px';
    sub.textContent = 'Send out with bait';
    parent.appendChild(sub);
    const total = () => this.bag.reduce((a, n, i) => a + n * LURES[i].cost, 0);
    const count = () => this.bag.reduce((a, n) => a + n, 0);
    const list = document.createElement('div');
    list.className = 'bag';
    parent.appendChild(list);
    const foot = document.createElement('div');
    foot.className = 'bag-total';
    parent.appendChild(foot);
    const send = document.createElement('button');
    send.className = 'ship-btn bag-send';
    parent.appendChild(send);
    const render = () => {
      list.innerHTML = '';
      LURES.forEach((l, i) => {
        const row = document.createElement('div');
        row.className = 'bag-row' + (this.bag[i] ? ' has' : '');
        row.innerHTML = `<span class="bag-emoji">${icon(l.icon)}</span>` +
          `<span class="bag-name">${l.name}<small>$${l.cost} each</small></span>` +
          `<button class="bag-btn" data-d="-1" aria-label="fewer">−</button>` +
          `<span class="bag-n">${this.bag[i]}</span>` +
          `<button class="bag-btn" data-d="1" aria-label="more">+</button>`;
        row.querySelectorAll('.bag-btn').forEach((b) => {
          b.addEventListener('click', (e) => {
            e.stopPropagation();
            const d = +b.dataset.d;
            this.bag[i] = Math.max(0, Math.min(99, this.bag[i] + d));
            render();
          });
        });
        list.appendChild(row);
      });
      const t = total(), n = count();
      foot.innerHTML = `<span>${n} bait${n === 1 ? '' : 's'}</span><b>$${t.toFixed(0)}</b>`;
      foot.classList.toggle('over', t > balance);
      send.innerHTML = `<span>${n ? 'Send the tender out' : 'Pick some bait'}</span>` + (n ? `<em>$${t.toFixed(0)}</em>` : '');
      send.disabled = !n || t > balance;
    };
    send.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.onTenderSend) this.onTenderSend(this.bag.slice());
    });
    render();
  }

  setTenderChip(tender) {
    const on = tender && tender.state === 'auto';
    this.el.tenderChip.classList.toggle('hidden', !on);
    if (on) this.el.tcBudget.textContent = `${tender.baitsLeft} bait${tender.baitsLeft === 1 ? '' : 's'} · $${tender.remaining.toFixed(0)}`;
  }

  showTenderReport({ n, value, spent, best }) {
    if (!n) {
      this.hint(`Tender came back empty — $${spent.toFixed(2)} of bait spent`);
      return;
    }
    this.el.trRows.innerHTML =
      `<div class="rc-row"><span class="rc-name">Fish landed</span>` +
        `<span class="rc-val">${n}</span></div>` +
      `<div class="rc-row"><span class="rc-name">Bait staked</span>` +
        `<span class="rc-val">$${spent.toFixed(2)}</span></div>` +
      (best ? `<div class="rc-row">` +
        `<img src="${fishIconURL(best.species)}" alt="">` +
        `<span class="rc-name">Best: ${best.species.name}</span>` +
        `<span class="rc-val">$${best.value.toFixed(2)}</span></div>` : '');
    this.el.trTotal.textContent = '$' + value.toFixed(2);
    this.el.tenderReport.classList.remove('hidden');
  }

  setPots(n) { this.el.potCount.textContent = String(n); }

  setAutoReel(on) {
    this.el.autoReel.classList.toggle('on', !!on);
    this.el.autoReel.title = on
      ? 'Auto reel ON — rods hook and reel themselves'
      : 'Auto reel OFF — swipe to hook and reel';
  }

  // --- direction finders ---
  /**
   * Point the non-intrusive chip at the nearest marina.
   * `boatPos` supplies position; the entry is { dock, dist } or null.
   */
  setFinders(boatPos, marina) {
    const one = (el, entry, atDock) => {
      if (!entry || !entry.dock) { el.classList.remove('show'); return; }
      el.classList.add('show');
      el.classList.toggle('near', atDock);
      const d = entry.dock;
      // Screen-space bearing: the camera never rotates, so world -Z is up.
      const ang = Math.atan2(d.headX - boatPos.x, -(d.headZ - boatPos.z));
      el.querySelector('.finder-arrow').style.transform = arrowRot(ang);
      el.querySelector('.finder-text b').textContent =
        atDock ? 'here' : `${Math.round(entry.dist)}m`;
      // The marina's own name on the chip, once it has one.
      const nameEl = el.querySelector('.finder-name');
      if (nameEl && d.name && nameEl.textContent !== d.name) nameEl.textContent = d.name;
    };
    one(this.el.finderMarina, marina, marina && marina.dist < 9);
  }

  // --- sonar ---
  setSonar(entries) {
    const key = entries.map((e) => e.lure.id + Math.round(e.dist / 5)).join(',');
    if (key === this._sonarKey) return;   // avoid rebuilding the DOM every frame
    this._sonarKey = key;
    if (!entries.length) {
      this.el.sonarRows.innerHTML = '<div class="sonar-empty">no activity in range</div>';
      return;
    }
    this.el.sonarRows.innerHTML = entries.map((e) =>
      `<div class="sonar-row">` +
        `<span class="sonar-bear" style="transform:${arrowRot(e.bearing)}">${icon('arrow')}</span>` +
        `<span class="sonar-lure">${icon(e.lure.icon)}<span>${e.lure.name}</span></span>` +
        `<span class="sonar-dist">${Math.round(e.dist)}m</span>` +
      `</div>`).join('');
  }

  setBite(on) {
    this.el.bite.classList.toggle('show', on);
  }

  /** The name of the water you have just come onto, faded in and out again. */
  showRegion(name, sub, ms = 3600) {
    const el = this.el.region;
    el.querySelector('.rn-name').textContent = name;
    el.querySelector('.rn-sub').textContent = sub;
    el.classList.add('show');
    clearTimeout(this.regionTimer);
    this.regionTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  setTrawling(on, net) {
    this.el.trawlBadge.classList.toggle('show', on);
    if (on && net) this.el.trawlBadge.innerHTML = `${icon(net.icon)}<span>${net.name.toUpperCase()}</span>`;
    this.el.netAction.innerHTML = `<span>${on ? 'Pull net' : 'Deploy net'}</span>`;
    this.el.netAction.classList.toggle('on', !!on);
  }

  toast(html, cls = '', ms = 3400) {
    const div = document.createElement('div');
    div.className = 'toast ' + cls;
    div.innerHTML = html;
    this.el.toasts.appendChild(div);
    requestAnimationFrame(() => div.classList.add('in'));
    setTimeout(() => {
      div.classList.remove('in');
      setTimeout(() => div.remove(), TOAST_FADE_MS);
    }, ms);
  }

  showCatch(c, wager) {
    const profit = c.value - wager;
    const cls = profit >= 0 ? 'win' : 'meh';
    this.toast(
      `<img class="catch-icon" src="${fishIconURL(c.species)}" alt="">` +
      `<div class="catch-body"><div class="catch-name">${c.species.name}</div>` +
      `<div class="catch-sub">${c.kg.toFixed(c.kg < 1 ? 2 : 1)} kg · paid at the rail` +
        `</div></div>` +
      `<div class="catch-value">$${c.value.toFixed(2)}</div>`, cls, 4200);
  }

  showTrawlHaul(catches, total) {
    this.haulToast('Net haul', catches, total, 'trawl');
  }

  showPotHaul(catches, total) {
    this.haulToast('Pot pulled', catches, total, 'pot');
  }

  haulToast(title, catches, total, cls) {
    const best = catches.reduce((a, b) => (b.value > a.value ? b : a));
    const names = catches.map((c) => c.species.name).join(', ');
    this.toast(
      `<img class="catch-icon" src="${fishIconURL(best.species)}" alt="">` +
      `<div class="catch-body"><div class="catch-name">${title} ×${catches.length}</div>` +
      `<div class="catch-sub">${names}</div></div>` +
      `<div class="catch-value">$${total.toFixed(2)}</div>`, cls, HAUL_TOAST_MS);
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

  bindMenu(fn) {
    this.el.menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      fn();
    });
  }

  /** Bring the menu overlay back over the running lake scene. */
  returnToMenu() {
    this.hideBigCatch();
    this.setBite(false);
    this.el.hint.classList.remove('show');
    this.el.lures.classList.add('collapsed');
    this.el.nets.classList.add('collapsed');
    this.el.pots.classList.add('collapsed');
    this.el.region.classList.remove('show');
    this.el.hud.classList.add('hidden');
    this.el.tenderReport.classList.add('hidden');
    this.el.ship.classList.add('collapsed');
    this.el.menu.classList.remove('hidden', 'leaving');
  }
}
