const assert = require('assert');
const M = require('../core/motion.js');
let n = 0; const t = (name, f) => { f(); n++; console.log('ok -', name); };
const near = (a, b, e = 1e-6) => assert(Math.abs(a - b) <= e, a + ' vs ' + b);

/* ---------- face track ---------- */
t('too little data gives no track', () => {
  assert.equal(M.buildTrack(null).ok, false);
  assert.equal(M.buildTrack([[0, 0.1], [1, 0.2]]).ok, false);
  assert.equal(M.buildTrack([[0, null], [1, null], [2, null], [3, 0.5]]).ok, false);
});
t('a face seen in under 30 percent of pictures is not trusted', () => {
  const raw = []; for (let i = 0; i < 10; i++) raw.push([i, i < 2 ? 0.3 : null]);
  const r = M.buildTrack(raw); assert.equal(r.ok, false); near(r.coverage, 0.2);
});
t('a still face keeps the camera still', () => {
  const raw = []; for (let i = 0; i < 12; i++) raw.push([i, 0.3 + (i % 2 ? 0.03 : -0.03)]);
  const r = M.buildTrack(raw); assert(r.ok);
  const xs = r.track.map(p => p[1]); assert(Math.max(...xs) - Math.min(...xs) < 0.01, 'camera jittered');
});
t('a face that walks right is followed, smoothly and never faster than vmax', () => {
  const raw = []; for (let i = 0; i < 20; i++) raw.push([i * 0.5, i < 6 ? -0.6 : 0.6]);
  const r = M.buildTrack(raw); assert(r.ok);
  const tr = r.track; assert(tr[tr.length - 1][1] > 0.3, 'camera did not follow');
  for (let i = 1; i < tr.length; i++) assert(Math.abs(tr[i][1] - tr[i - 1][1]) <= 0.9 * (tr[i][0] - tr[i - 1][0]) + 0.002);
});
t('a single wrong detection is ignored', () => {
  const raw = []; for (let i = 0; i < 12; i++) raw.push([i, i === 6 ? 0.95 : -0.2]);
  const r = M.buildTrack(raw); assert(r.ok);
  assert(Math.max(...r.track.map(p => p[1])) < 0.0, 'outlier pulled the camera');
});
t('short gaps are bridged, long gaps hold the last place', () => {
  const raw = [[0, 0.2], [1, 0.2], [2, null], [3, 0.2], [4, 0.2], [5, null], [6, null], [7, null], [8, null], [9, null], [10, 0.2]];
  const r = M.buildTrack(raw); assert(r.ok); r.track.forEach(p => assert(Math.abs(p[1] - 0.2) < 0.05));
});
t('bad input never throws and values stay inside -1..1', () => {
  const r = M.buildTrack([['a', 1], [null, 2], [1, 9], [2, -9], [3, '0.5'], [4, {}], [5, 0.1], [-1, 0], 'x']);
  assert.equal(typeof r.ok, 'boolean'); r.track.forEach(p => { assert(p[1] >= -1 && p[1] <= 1); });
});
t('long tracks are thinned to at most 90 points and keep the last time', () => {
  const raw = []; for (let i = 0; i < 400; i++) raw.push([i * 0.25, Math.sin(i / 30) * 0.7]);
  const r = M.buildTrack(raw); assert(r.track.length <= 91); near(r.track[r.track.length - 1][0], 99.75, 1e-9);
});
t('trackAt interpolates and holds the ends', () => {
  const tr = [[0, -1], [2, 1]];
  near(M.trackAt(tr, -5), -1); near(M.trackAt(tr, 1), 0); near(M.trackAt(tr, 9), 1);
  assert.equal(M.trackAt([], 1), null); assert.equal(M.trackAt(null, 1), null);
});
t('previewX puts the face in the middle of the crop and clamps at the edges', () => {
  near(M.previewX(0, 0.316), 0); near(M.previewX(0.342, 0.316), 0.5, 1e-3);
  near(M.previewX(0.95, 0.316), 1); near(M.previewX(-0.95, 0.316), -1); near(M.previewX(0.4, 1), 0);
});

/* ---------- speed ramps ---------- */
t('ramps: junk and tiny changes are dropped', () => {
  assert.deepEqual(M.cleanRamps(null, 30), []);
  assert.deepEqual(M.cleanRamps([{ a: 5, b: 7, speed: 1.05 }, { a: 'x', b: 2, speed: 2 }, null, 5], 30), []);
  assert.deepEqual(M.cleanRamps([{ a: 5, b: 7, speed: 0.5 }], 2), []);
});
t('ramps: protected hook and ending, speed limits', () => {
  const r = M.cleanRamps([{ a: 0, b: 3, speed: 0.1 }, { a: 25, b: 40, speed: 9 }], 30);
  assert.equal(r[0].a, 0.8); assert.equal(r[0].speed, 0.35);
  assert.equal(r[1].b - r[1].a <= 6 + 1e-9, true); assert.equal(r[1].speed, 2.5); assert(r[1].b <= 29.5 + 1e-9);
});
t('ramps: overlaps and crowding are removed, at most 3 kept', () => {
  const r = M.cleanRamps([{ a: 5, b: 7, speed: 0.5 }, { a: 6, b: 8, speed: 2 }, { a: 7.2, b: 9, speed: 2 }, { a: 12, b: 14, speed: 1.5 }, { a: 16, b: 18, speed: 1.5 }, { a: 20, b: 22, speed: 1.5 }], 60);
  assert.equal(r.length, 3); for (let i = 1; i < r.length; i++) assert(r[i].a >= r[i - 1].b + 0.5 - 1e-9);
});
t('ramps: slow motion is capped at a quarter of the clip', () => {
  const r = M.cleanRamps([{ a: 2, b: 6, speed: 0.5 }, { a: 7, b: 11, speed: 0.5 }, { a: 12, b: 15, speed: 0.5 }], 20);
  const slow = r.filter(x => x.speed < 1).reduce((s, x) => s + x.b - x.a, 0); assert(slow <= 5 + 1e-9);
});
t('mapTime: slow part stretches time, fast part shrinks it, rest is shifted', () => {
  const rp = [{ a: 2, b: 4, speed: 0.5 }, { a: 6, b: 10, speed: 2 }];
  near(M.mapTime(rp, 1), 1); near(M.mapTime(rp, 3), 4); near(M.mapTime(rp, 4), 6); near(M.mapTime(rp, 6), 8);
  near(M.mapTime(rp, 8), 9); near(M.mapTime(rp, 10), 10); near(M.mapTime(rp, 12), 12);
  near(M.outDuration(rp, 20), 20); // 2 + 4 + 2 + 2 + 10
});
console.log(n + ' motion tests passed');
