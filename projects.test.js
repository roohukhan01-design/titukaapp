/* Runs the real project code from the page against a fake browser (localStorage, DOM, S). */
const assert = require('assert'), fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '../../app/src/main/assets/Roohu-ClipForge.html'), 'utf8');
const a = html.indexOf('/* ===== projects:'), b = html.indexOf('renderPrj();\n', a) + 'renderPrj();\n'.length;
assert(a > 0 && b > a, 'project code block not found');
const code = html.slice(a, b);

function world() {
  const store = {}; const toasts = []; let view = '';
  const els = { '#prj': { hidden: true }, '#prjl': { innerHTML: '', onclick: null }, '#vf': { click() { els['#vf'].clicked = true; } } };
  const env = {
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    $: s => els[s], esc: s => String(s), toast: m => toasts.push(m), go: v => { view = v; },
    S: { file: { name: 'match.mp4', size: 1000 }, dur: 120, clips: [{ title: 'A', s: 1, e: 20 }], cues: [{ a: 1, b: 2, t: 'hi' }], sel: 0, pid: 111, restore: null },
    setInterval() {}, addEventListener() {}, document: { addEventListener() {}, hidden: false }, Date
  };
  const names = Object.keys(env);
  const fn = new Function(...names, code + '\nreturn {prjRead,prjWrite,prjAutosave,tryRestore,renderPrj,get last(){return prjLast},set last(v){prjLast=v}};');
  return { api: fn(...names.map(n => env[n])), env, store, toasts, els, view: () => view };
}

let n = 0; const t = (name, f) => { f(); n++; console.log('ok -', name); };
t('autosave stores clips, cues and video identity', () => {
  const w = world(); w.api.prjAutosave();
  const p = JSON.parse(w.store.cfprj)[0];
  assert.equal(p.v, 1); assert.equal(p.video.name, 'match.mp4'); assert.equal(p.data.clips.length, 1); assert.equal(p.data.cues[0].t, 'hi');
});
t('autosave skips empty projects and unchanged state', () => {
  const w = world(); w.env.S.clips = []; w.env.S.cues = []; w.api.prjAutosave(); assert(!w.store.cfprj);
  const w2 = world(); w2.api.prjAutosave(); const first = w2.store.cfprj; w2.api.prjAutosave(); assert.equal(w2.store.cfprj, first);
});
t('a second save keeps a backup and a rename survives later autosaves', () => {
  const w = world(); w.api.prjAutosave();
  const list = JSON.parse(w.store.cfprj); list[0].name = 'My Edit'; w.api.prjWrite(list);
  w.env.S.clips.push({ title: 'B', s: 30, e: 50 }); w.api.prjAutosave();
  const now = JSON.parse(w.store.cfprj)[0]; assert.equal(now.name, 'My Edit'); assert.equal(now.data.clips.length, 2); assert(w.store['cfprj.bak']);
});
t('damaged main copy falls back to the backup', () => {
  const w = world(); w.api.prjAutosave(); w.api.prjWrite(JSON.parse(w.store.cfprj)); w.store.cfprj = '{broken';
  assert.equal(w.api.prjRead().length, 1);
});
t('restore with the same video brings back clips, cues and opens review', () => {
  const w = world(); w.api.prjAutosave(); const id = JSON.parse(w.store.cfprj)[0].id;
  w.env.S.clips = []; w.env.S.cues = []; w.env.S.pid = 0; w.env.S.restore = id;
  w.api.tryRestore({ name: 'match.mp4', size: 1000 });
  assert.equal(w.env.S.clips.length, 1); assert.equal(w.env.S.cues.length, 1); assert.equal(w.env.S.pid, id); assert.equal(w.view(), 'review');
});
t('restore with a different video is refused and nothing is overwritten', () => {
  const w = world(); w.api.prjAutosave(); const id = JSON.parse(w.store.cfprj)[0].id;
  w.env.S.clips = []; w.env.S.restore = id; w.env.S.dur = 500;
  w.api.tryRestore({ name: 'other.mp4', size: 5 });
  assert.equal(w.env.S.clips.length, 0); assert.notEqual(w.env.S.pid, id); assert(w.toasts.some(m => /doesn.t match/.test(m)));
  assert.equal(JSON.parse(w.store.cfprj).length, 1);
});
t('projects from a newer version are kept and cannot be opened', () => {
  const w = world(); w.api.prjWrite([{ v: 99, id: 5, name: 'future', updated: 1, created: 1, video: {}, data: {} }]);
  w.env.S.restore = 5; w.api.tryRestore({ name: 'x', size: 1 });
  assert.equal(JSON.parse(w.store.cfprj)[0].v, 99); assert.equal(w.env.S.clips.length, 1);
});
t('project list renders with Continue on the latest and survives odd data', () => {
  const w = world(); w.api.prjWrite([{ v: 1, id: 1, name: '<b>x</b>', updated: 5, created: 1, video: { name: 'v.mp4' }, data: { clips: [] } }, { id: 2 }, null, 'junk']);
  w.api.renderPrj(); assert(w.els['#prjl'].innerHTML.includes('Continue')); assert.equal(w.els['#prj'].hidden, false);
});
console.log(n + ' project tests passed');
