import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { featureScopes, analyzeScopes } from '../web/features.js';
import { resolveLanguage } from '../web/i18n.js';

const catalog=Object.fromEntries(await Promise.all(['en','zh-Hans','zh-Hant','ja'].map(async language=>[language,JSON.parse(await readFile(new URL(`../Resources/Onboarding.${language}.json`,import.meta.url),'utf8'))])));
test('every guide language contains usable examples of all feature blocks',()=>{
  assert.deepEqual(Object.keys(catalog).sort(),['en','ja','zh-Hans','zh-Hant'].sort());
  for(const [language,notes] of Object.entries(catalog)) {
    assert.equal(notes.length,7,language);
    assert.ok(['@date','⌘⇧F','⌘⇧P','{date#2}'].every(text=>notes.join('\n').includes(text)),`${language}: snippets, search and commands`);
    assert.ok(notes.every(note=>note.startsWith('# ') && note.length>100),language);
    const blocks=notes.flatMap(note=>featureScopes(note));
    assert.deepEqual(blocks.map(scope=>scope.mode).sort(),['list','math','sum','avg','count','code'].sort(),language);
    assert.ok(blocks.every(scope=>scope.kind==='block' && scope.closed),language);
    const calculations=notes.flatMap(note=>analyzeScopes(note));
    assert.ok(calculations.find(scope=>scope.mode==='sum')?.summary.includes('40'),language);
    assert.ok(calculations.find(scope=>scope.mode==='avg')?.summary.includes('20'),language);
    assert.ok(notes.join('\n').includes('⌘N') && notes.join('\n').includes('⌘D') && notes.join('\n').includes('⌘['),language);
  }
});
test('guide language resolves common system locale variants',()=>{
  for(const [locale,expected] of [['en-US','en'],['zh-CN','zh-Hans'],['zh-TW','zh-Hant'],['ja-JP','ja'],['fr-FR','en']]) {
    assert.equal(resolveLanguage([locale]),expected);
    assert.ok(catalog[expected]);
  }
});
