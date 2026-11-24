const assert = require('assert');
const { validateDirector, parseAiJson, validateCandidates, validateExportConfig, sanitizeFilename, cleanText, num } = require('../core/validate');
const meta = { duration: 300 };
const words = [{w:'so',a:19.5,b:19.9},{w:'this',a:20.0,b:20.3},{w:'is',a:20.3,b:20.5},{w:'crazy',a:20.5,b:21.2},{w:'wow',a:49.8,b:50.6},{w:'ok',a:52,b:52.3}];
let n = 0; const t = (name, f) => { f(); n++; console.log('ok -', name); };

t('parses fenced JSON', () => assert(parseAiJson('```json\n[{"start":1,"end":2}]\n```').ok));
t('rejects garbage', () => assert(!parseAiJson('sorry I cannot').ok));
t('rejects invalid JSON', () => assert(!parseAiJson('[{"start":').ok));
t('rejects out-of-range timestamps', () => {
  const r = validateCandidates([{start:290,end:340,confidence:.9},{start:400,end:430,confidence:.9}], meta, words);
  assert.equal(r.accepted.length, 0); assert.equal(r.rejected.length, 2);
});
t('rejects non-numeric and reversed', () => {
  const r = validateCandidates([{start:'a',end:5,confidence:.9},{start:60,end:50,confidence:.9}], meta, words);
  assert.equal(r.accepted.length, 0);
});
t('snaps a start that lands inside a word', () => {
  const r = validateCandidates([{start:20.4,end:45,confidence:.8,title:'x'}], meta, words);
  assert.equal(r.accepted.length, 1); assert(r.accepted[0].start <= 20.4 && r.accepted[0].snapped);
});
t('rejects mid-speech with no nearby pause', () => {
  const dense = []; for (let i=0;i<200;i++) dense.push({w:'x',a:i*.5,b:i*.5+.49});
  const r = validateCandidates([{start:10.2,end:40,confidence:.9}], meta, dense, {maxShift:.01});
  assert.equal(r.accepted.length, 0);
});
t('drops overlapping lower-confidence duplicates', () => {
  const r = validateCandidates([{start:100,end:130,confidence:.9},{start:105,end:135,confidence:.6},{start:200,end:230,confidence:.7}], meta, []);
  assert.equal(r.accepted.length, 2); assert.equal(r.accepted[0].confidence, .9);
});
t('enforces duration limits and missing confidence', () => {
  const r = validateCandidates([{start:10,end:14,confidence:.9},{start:10,end:100,confidence:.9},{start:150,end:170}], meta, []);
  assert.equal(r.accepted.length, 0); assert.equal(r.rejected.length, 3);
});
t('respects clip limit', () => {
  const items = []; for (let i=0;i<5;i++) items.push({start:i*50,end:i*50+20,confidence:.9-i*.05});
  assert.equal(validateCandidates(items, meta, [], {max:3}).accepted.length, 3);
});

/* ---- hardening tests ---- */
t('parseAiJson: non-string, empty, null and oversized input', () => {
  assert(!parseAiJson(undefined).ok); assert(!parseAiJson('   ').ok); assert(!parseAiJson('null').ok);
  assert(!parseAiJson('x'.repeat(1000001)).ok);
});
t('parseAiJson: object with candidates, trailing prose, brackets inside strings', () => {
  const r = parseAiJson('Here you go: {"candidates":[{"title":"a ] b","start":1,"end":2}]} hope that helps [1]');
  assert(r.ok); assert.equal(r.items.length, 1); assert.equal(r.items[0].title, 'a ] b');
});
t('parseAiJson: rejects an object with no candidates array', () => assert(!parseAiJson('{"a":1}').ok));
t('num: rejects null, empty string, booleans, arrays, NaN, Infinity', () => {
  for (const v of [null, '', '  ', true, false, [], {}, NaN, Infinity, 'abc', undefined]) assert(Number.isNaN(num(v)), String(v));
  assert.equal(num('12.5'), 12.5); assert.equal(num(3), 3);
});
t('null and empty-string timestamps are rejected, not read as 0', () => {
  const r = validateCandidates([{start:null,end:30,confidence:.9},{start:'',end:30,confidence:.9},{start:true,end:30,confidence:.9}], meta, []);
  assert.equal(r.accepted.length, 0); assert.equal(r.rejected.length, 3);
});
t('confidence outside 0-1 or null is rejected', () => {
  const r = validateCandidates([{start:10,end:30,confidence:5},{start:50,end:70,confidence:null},{start:90,end:110,confidence:-1}], meta, []);
  assert.equal(r.accepted.length, 0);
});
t('bad meta never throws', () => {
  for (const m of [undefined, null, {}, {duration:0}, {duration:-5}, {duration:'x'}, {duration:NaN}]) {
    const r = validateCandidates([{start:1,end:20,confidence:.9}], m, []); assert.equal(r.accepted.length, 0); assert(r.error);
  }
});
t('non-array items and non-object entries never throw', () => {
  assert(validateCandidates('nope', meta, []).error);
  const r = validateCandidates([null, 5, 'x', [], undefined], meta, []); assert.equal(r.accepted.length, 0); assert.equal(r.rejected.length, 5);
});
t('malformed transcript words are ignored', () => {
  const r = validateCandidates([{start:20,end:45,confidence:.9}], meta, [null, {a:'x'}, {a:5,b:4}, 7]);
  assert.equal(r.accepted.length, 1);
});
t('bad options fall back to safe defaults', () => {
  const r = validateCandidates([{start:20,end:45,confidence:.9}], meta, [], {minLen:'abc', maxLen:-5, max:0, overlap:9, minConf:NaN});
  assert.equal(r.accepted.length, 1);
});
t('text is cleaned and length-limited; style and scores are whitelisted', () => {
  const evil = 'A'.repeat(500) + '\u0000\u0007';
  const r = validateCandidates([{start:20,end:45,confidence:.9,title:evil,hook:{x:1},explanation:evil,
    style:{mood:'intense',font:'Anton',__proto__:{polluted:1},captionStyle:'<script>',extra:'x'},scores:{hype:.8,'bad key!':1,big:50,str:'x'}}], meta, []);
  const c = r.accepted[0];
  assert.equal(c.title.length, 80); assert.equal(c.hook, ''); assert(c.explanation.length <= 300);
  assert.deepEqual(c.style, {mood:'intense', font:'Anton'}); assert.deepEqual(c.scores, {hype:.8, big:1});
  assert.equal({}.polluted, undefined);
});
t('unknown category falls back to general', () => {
  assert.equal(validateCandidates([{start:20,end:45,confidence:.9,category:'hacking'}], meta, []).accepted[0].category, 'general');
});
t('more than 200 candidates are capped', () => {
  const items = []; for (let i=0;i<500;i++) items.push({start:i*0.5,end:i*0.5+20,confidence:.9});
  assert(validateCandidates(items, meta, [], {max:50}).accepted.length <= 50);
});
t('cleanText strips control characters', () => assert.equal(cleanText('a\u0000b\n\tc', 10), 'a b c'));
t('sanitizeFilename blocks paths, reserved names and empties', () => {
  assert.equal(sanitizeFilename('../../etc/passwd'), '.._.._etc_passwd'.replace(/^\.+/, ''));
  assert.equal(sanitizeFilename('my:clip*?.mp4'), 'my_clip__');
  assert.equal(sanitizeFilename('CON'), '_CON'); assert.equal(sanitizeFilename(''), 'clip');
  assert.equal(sanitizeFilename(null, 'x'), 'x'); assert.equal(sanitizeFilename('a'.repeat(300)).length, 80);
  assert(!/[\\/:*?"<>|]/.test(sanitizeFilename('a/b\\c')));
});
t('export config: valid input passes through, sizes made even', () => {
  const r = validateExportConfig({width:721,height:1281,fps:30,bitrate:4000000,filename:'My Short'});
  assert(r.ok); assert.deepEqual(r.value, {width:722,height:1282,fps:30,bitrate:4000000,format:'mp4',filename:'My Short'});
});
t('export config: bad values are reported and replaced with safe ones', () => {
  const r = validateExportConfig({width:'x',height:99999,fps:45,bitrate:1,format:'avi',filename:'../x'});
  assert(!r.ok); assert(r.errors.length >= 4); assert.equal(r.value.fps, 30); assert.equal(r.value.format, 'mp4');
  assert(r.value.bitrate >= 500000 && r.value.height <= 4320 && !r.value.filename.includes('/'));
});
t('export config: garbage input never throws', () => {
  for (const v of [undefined, null, 5, 'x', [], {}]) { const r = validateExportConfig(v); assert(r.value.width >= 64); }
});
t('the page copy of validate.js is identical to the shared one', () => {
  const fs = require('fs'), path = require('path');
  assert.equal(fs.readFileSync(path.join(__dirname, '../core/validate.js'), 'utf8'),
               fs.readFileSync(path.join(__dirname, '../../app/src/main/assets/validate.js'), 'utf8'));
});
t('every aspect preset and resolution gives valid even sizes', () => {
  for (const asp of ['9:16','16:9','1:1','4:5','3:4']) for (const res of [480,720,1080]) {
    const [a,b] = asp.split(':').map(Number); let w,h; if (a<=b) { w=res; h=Math.round(res*b/a); } else { h=res; w=Math.round(res*a/b); }
    const r = validateExportConfig({width:w,height:h,fps:30,bitrate:6e6,filename:'x'});
    assert(r.ok, asp+' '+res); assert(r.value.width%2===0 && r.value.height%2===0);
  }
});
t('director: keeps valid entries and cleans every field', () => {
  const r = validateDirector([{i:0,title:'  Wow  this is\u0000 crazy  ',hook:11.6,why:'x'.repeat(400),mood:'intense',category:'sports',captionStyle:'fire'}], 2);
  assert.equal(r.accepted.length, 1); const a = r.accepted[0];
  assert.equal(a.title, 'Wow this is crazy'); assert.equal(a.hook, 10); assert.equal(a.why.length, 140); assert.equal(a.mood, 'intense'); assert.equal(a.captionStyle, 'fire');
});
t('director: rejects bad indexes, duplicates, missing titles and non-objects', () => {
  const r = validateDirector([{i:5,title:'a'},{i:-1,title:'a'},{i:'x',title:'a'},{i:1.5,title:'a'},{i:0,title:''},null,7,{i:0,title:'ok'},{i:0,title:'again'}], 2);
  assert.equal(r.accepted.length, 1); assert.equal(r.accepted[0].title, 'ok'); assert.equal(r.rejected.length, 8);
});
t('director: unknown mood, category and style are dropped; hook is optional', () => {
  const a = validateDirector([{i:0,title:'t',mood:'angry',category:'hax',captionStyle:'<x>',hook:'n/a'}], 1).accepted[0];
  assert.equal(a.mood, ''); assert.equal(a.category, 'general'); assert.equal(a.captionStyle, ''); assert.equal(a.hook, 0);
});
t('director: titles are limited to ten words; non-array and bad counts never throw', () => {
  assert.equal(validateDirector([{i:0,title:'a b c d e f g h i j k l'}], 1).accepted[0].title.split(' ').length, 10);
  assert(validateDirector('x', 3).error); assert.equal(validateDirector([{i:0,title:'a'}], 0).accepted.length, 0); assert.equal(validateDirector([{i:0,title:'a'}], 'x').accepted.length, 0);
});
console.log(n + ' tests passed');
t('director: post caption is cleaned and hashtags are split out', () => {
  const r = validateDirector([{i:0,title:'ok',postCaption:'  He never saw it coming \u0000 #Shorts #fyp #fyp #x <b>bold</b> '+'y'.repeat(300)}], 1);
  const a = r.accepted[0];
  assert.deepEqual(a.hashtags, ['#Shorts', '#fyp']);
  assert.ok(a.postCaption.startsWith('He never saw it coming'));
  assert.ok(a.postCaption.length <= 150 && !a.postCaption.includes('#') && !a.postCaption.includes('<'));
  assert.equal(validateDirector([{i:0,title:'ok'}], 1).accepted[0].postCaption, '');
});
