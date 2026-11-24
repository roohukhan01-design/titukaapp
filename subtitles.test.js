/* Runs the real caption-editor functions from the page. */
const assert = require('assert'), fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '../../app/src/main/assets/Roohu-ClipForge.html'), 'utf8');
const a = html.indexOf('/* ===== subtitles:'), b = html.indexOf('/*end subtitles pure*/');
assert(a > 0 && b > a);
const m = new Function(html.slice(a, b) + '\nreturn {subClean,subWords,subUpdate,subSplit,subMerge,subAdd,subRemove,subShift,subToSrt,stamp};')();
let n = 0; const t = (name, f) => { f(); n++; console.log('ok -', name); };
const base = () => [
  { a: 10, b: 14, t: 'this is a test line', w: [['this', 10, 10.8], ['is', 10.8, 11.5], ['a', 11.5, 12.2], ['test', 12.2, 13.2], ['line', 13.2, 14]] },
  { a: 20, b: 22, t: 'second', w: [['second', 20, 22]] }
];
t('editing text with the same word count keeps relative word timing', () => {
  const r = m.subUpdate(base(), 0, { t: 'that was a nice clip' }, 100);
  assert.equal(r[0].t, 'that was a nice clip'); assert.equal(r[0].w.length, 5); assert.equal(r[0].w[1][1], 10.8);
});
t('changing the times rescales every word into the new range', () => {
  const out = m.subUpdate(base(), 0, { a: 30, b: 38 }, 100); const c = out.find(x => x.t.startsWith('this'));
  assert.equal(c.a, 30); assert.equal(c.b, 38); assert.equal(c.w[0][1], 30); assert.equal(c.w[4][2], 38);
});
t('new text with a different word count spreads words across the line', () => {
  const r = m.subUpdate(base(), 1, { t: 'one two three' }, 100)[1];
  assert.equal(r.w.length, 3); assert.equal(r.w[0][1], 20); assert(Math.abs(r.w[2][2] - 22) < 0.01);
});
t('times are clamped: minimum length, never below 0, never past the video end', () => {
  let r = m.subUpdate(base(), 1, { a: 5, b: 5.05 }, 100)[0]; assert(r.b - r.a >= 0.2);
  r = m.subUpdate(base(), 1, { a: -3 }, 100); assert(r.every(q => q.a >= 0));
  r = m.subUpdate(base(), 1, { a: 99.9, b: 150 }, 100); assert(r.every(q => q.b <= 100 && q.b - q.a >= 0.1));
});
t('bad or empty input leaves the captions unchanged', () => {
  const o = base();
  assert.strictEqual(m.subUpdate(o, 0, { a: 'x' }, 100), o); assert.strictEqual(m.subUpdate(o, 0, { t: '   ' }, 100), o); assert.strictEqual(m.subUpdate(o, 9, { t: 'a' }, 100), o);
});
t('split at the playhead divides words and times without losing any', () => {
  const r = m.subSplit(base(), 0, 11.0);
  assert.equal(r.length, 3); assert.equal(r[0].t, 'this is'); assert.equal(r[1].t, 'a test line'); assert.equal(r[0].b, r[1].a); assert.equal(r[1].b, 14);
});
t('split without a playhead cuts in the middle; one-word lines cannot be split', () => {
  assert.equal(m.subSplit(base(), 0)[0].w.length, 2); const o = base(); assert.strictEqual(m.subSplit(o, 1), o);
});
t('merge joins text, words and the full time span', () => {
  const r = m.subMerge(base(), 0); assert.equal(r.length, 1); assert.equal(r[0].a, 10); assert.equal(r[0].b, 22); assert.equal(r[0].w.length, 6); assert(r[0].t.endsWith('second'));
  const o = base(); assert.strictEqual(m.subMerge(o, 1), o);
});
t('add inserts a sorted line inside the video; remove deletes one', () => {
  const r = m.subAdd(base(), 15, 100); assert.equal(r.length, 3); assert.equal(r[1].a, 15); assert.equal(m.subRemove(r, 1).length, 2);
  assert.strictEqual(m.subAdd(base(), 99.95, 100).length, 2);
});
t('shift moves every line and word but never below 0 or past the end', () => {
  const r = m.subShift(base(), 0.5, 100); assert.equal(r[0].a, 10.5); assert.equal(r[0].w[0][1], 10.5);
  assert.equal(m.subShift(base(), -50, 100)[0].a, 0); assert.equal(m.subShift(base(), 500, 25)[1].b, 25);
});
t('SRT export uses correct timestamps and numbering', () => {
  const s = m.subToSrt([{ a: 3661.5, b: 3662.25, t: 'hi' }, { a: 0.004, b: 1, t: 'yo' }]);
  assert(s.startsWith('1\n01:01:01,500 --> 01:01:02,250\nhi\n')); assert(s.includes('2\n00:00:00,004 --> 00:00:01,000\nyo'));
});
console.log(n + ' subtitle tests passed');
