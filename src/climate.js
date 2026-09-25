// The weather over the boat: sky and fog colours, how far you can see,
// the colour and strength of the sun, and whatever is falling — all read
// from the regions round the boat (regions.js) and eased toward as you
// cross from one to the next, so a marsh closes in grey and drizzling and
// the lagoon opens out bright a minute later. Purely a picture: none of it
// touches a bet.

import * as THREE from 'three';

const DROPS = 700;

// Sunset: five minutes in every twenty, by the wall clock, the light goes
// down warm — a pink and orange sky, a low orange sun throwing long
// shadows, the water glowing with it. No switch and no HUD: it rolls
// round on its own, the same for everyone at the same moment.
const SUNSET = { sky: new THREE.Color(0xf3a06e), fog: new THREE.Color(0xf0b08c), sun: new THREE.Color(0xff9a48), amb: new THREE.Color(0xe0a4b4) };
export function sunsetWanted(now = Date.now()) {
  const m = (now / 60000) % 20;
  return m >= 15 ? 1 : 0;
}
const BOX = 70;      // metres of precipitation kept around the boat
const TOP = 34;

export class Climate {
  constructor(scene, sun, ambient, hemi) {
    this.scene = scene;
    this.sun = sun;
    this.ambient = ambient;
    this.hemi = hemi;
    this.cur = {
      sky: new THREE.Color(0xbfe3f2), fog: new THREE.Color(0xbfe3f2), sun: new THREE.Color(0xfff4e0),
      near: 90, far: 220, sunI: 2.4, amb: 0.75, precip: 0, snow: 0,
    };
    this.hemiSky = new THREE.Color(0xd8ecf5);
    this.hemiGround = new THREE.Color(0x3a5f3f);
    this.ambientDay = ambient.color.clone();
    this._tmp = new THREE.Color();
    this.sunset = 0;            // 0 day .. 1 full sunset, eased
    this.forceSunset = null;    // tests: pin it
    this.want = { sky: new THREE.Color(), fog: new THREE.Color(), sun: new THREE.Color() };

    // Precipitation: a cloud of points that falls and wraps around the boat.
    const pos = new Float32Array(DROPS * 3);
    this.vel = new Float32Array(DROPS);
    for (let i = 0; i < DROPS; i++) {
      pos[i * 3] = (Math.random() - 0.5) * BOX;
      pos[i * 3 + 1] = Math.random() * TOP;
      pos[i * 3 + 2] = (Math.random() - 0.5) * BOX;
      this.vel[i] = 0.7 + Math.random() * 0.6;
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.mat = new THREE.PointsMaterial({
      color: 0xe8f2f8, size: 0.16, transparent: true, opacity: 0, depthWrite: false, sizeAttenuation: true,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.visible = false;
    scene.add(this.points);
  }

  /** Ease toward the climate at (x, z) and apply it. */
  update(dt, x, z, lake) {
    const region = lake.climateAt(x, z);
    // The sunset eases in and out over half a minute or so.
    const target = this.forceSunset ?? sunsetWanted();
    this.sunset += (target - this.sunset) * Math.min(1, 0.08 * dt);
    if (Math.abs(target - this.sunset) < 0.002) this.sunset = target;
    const s = this.sunset;
    const want = this.want;
    want.sky.copy(region.sky).lerp(SUNSET.sky, s * 0.85);
    want.fog.copy(region.fog).lerp(SUNSET.fog, s * 0.8);
    want.sun.copy(region.sun).lerp(SUNSET.sun, s);
    // The evening air is clear: the haze stands back a little.
    want.near = region.near * (1 + s * 0.2);
    want.far = region.far * (1 + s * 0.25);
    want.sunI = region.sunI * (1 - s * 0.3);
    want.amb = region.amb * (1 - s * 0.2);
    want.precip = region.precip; want.snow = region.snow;
    const c = this.cur;
    const k = Math.min(1, 0.9 * dt);
    c.sky.lerp(want.sky, k);
    c.fog.lerp(want.fog, k);
    c.sun.lerp(want.sun, k);
    c.near += (want.near - c.near) * k;
    c.far += (want.far - c.far) * k;
    c.sunI += (want.sunI - c.sunI) * k;
    c.amb += (want.amb - c.amb) * k;
    c.precip += (want.precip - c.precip) * k;
    c.snow += (want.snow - c.snow) * k;

    this.scene.background.copy(c.sky);
    this.scene.fog.color.copy(c.fog);
    this.scene.fog.near = c.near;
    this.scene.fog.far = c.far;
    this.sun.color.copy(c.sun);
    this.sun.intensity = c.sunI;
    this.ambient.intensity = c.amb;
    this.ambient.color.copy(this.ambientDay).lerp(SUNSET.amb, s * 0.7);
    // The sky light takes the sky's colour; the ground bounce stays green.
    this.hemi.color.copy(this._tmp.copy(c.sky).lerp(this.hemiSky, 0.5));
    this.hemi.intensity = 0.75;

    // Rain falls fast and thin; snow drifts down slow and fat.
    const on = c.precip > 0.03;
    this.points.visible = on;
    if (on) {
      const speed = 18 - 16 * c.snow;
      this.mat.opacity = Math.min(0.85, c.precip * 0.9);
      this.mat.size = 0.14 + c.snow * 0.28;
      this.mat.color.setRGB(0.91 + c.snow * 0.09, 0.95 + c.snow * 0.05, 0.98);
      const p = this.geo.attributes.position;
      const arr = p.array;
      const drift = c.snow * 0.8;
      for (let i = 0; i < DROPS; i++) {
        let y = arr[i * 3 + 1] - speed * this.vel[i] * dt;
        if (y < 0) {
          y += TOP;
          arr[i * 3] = (Math.random() - 0.5) * BOX;
          arr[i * 3 + 2] = (Math.random() - 0.5) * BOX;
        }
        arr[i * 3 + 1] = y;
        if (drift > 0) arr[i * 3] += Math.sin(y * 0.7 + i) * drift * dt;
      }
      p.needsUpdate = true;
      this.points.position.set(x, 0, z);
    }
  }
}
