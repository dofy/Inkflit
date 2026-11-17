import test from 'node:test';
import assert from 'node:assert/strict';
import catalog from '../Resources/Translations.json' with {type:'json'};
import { resolveLanguage, setLanguage, t } from '../web/i18n.js';
import { applyUIAppearance } from '../web/ui-themes.js';
import { applyCodeTheme } from '../web/code-themes.js';

test('system language resolution and translated labels',()=>{
  for(const [preferred,expected] of [[['zh-TW'],'zh-Hant'],[['zh-HK'],'zh-Hant'],[['zh-CN'],'zh-Hans'],[['ja-JP'],'ja'],[['fr','en-US'],'en'],[['fr'],'en']]) assert.equal(resolveLanguage(preferred),expected);
  for(const language of ['en','zh-Hans','zh-Hant','ja']) {
    setLanguage(language);
    for(const [key, translations] of Object.entries(catalog)) assert.ok(translations[language], `${key} missing ${language}`);
    assert.equal(t('note.new'),catalog['note.new'][language]);
  }
});
test('each accent and code theme provides readable dark colors',()=>{
  const css={};const root={dataset:{},style:{setProperty:(key,value)=>css[key]=value}};
  for(const id of ['orange','blue','green']) { applyUIAppearance(id,80,root,true); assert.equal(root.dataset.colorScheme,'dark');assert.notEqual(css['--ui-ink'],css['--ui-paper']); }
  for(const id of ['amber','ocean','contrast']) { applyCodeTheme(id,root,true); assert.match(css['--syntax-property'],/^#[0-9a-f]{6}$/); }
});
test('every literal string passed to t() or L() has a catalog entry',async()=>{
  // A missing key silently shows the raw id. Scan literal arguments, including
  // both arms of a ternary such as t(on?'palette.disableVim':'palette.enableVim').
  // Keys built at runtime are not covered.
  const {readdir,readFile}=await import('node:fs/promises');
  const sources=[
    ...(await readdir('web')).filter(name=>name.endsWith('.js')).map(name=>[`web/${name}`,/(?<![\w.$])t\(([^()]*)\)/g]),
    ...(await readdir('Sources')).filter(name=>name.endsWith('.swift')).map(name=>[`Sources/${name}`,/(?<![\w.])L\(([^()]*)\)/g])
  ];
  const missing=[];
  for(const [path,call] of sources) {
    const text=await readFile(path,'utf8');
    for(const [,argument] of text.matchAll(call)) {
      // Only a whole literal, or the two literal arms of a ternary, is a key.
      const literal=String.raw`(['"])((?:(?!\1)[^\\]|\\.)*)\1`;
      const whole=argument.match(new RegExp(String.raw`^\s*${literal}\s*$`));
      const ternary=argument.match(new RegExp(String.raw`^[^?'"]*\?\s*${literal}\s*:\s*${literal.replaceAll('\\1','\\3')}\s*$`));
      const keys=whole ? [whole[2]] : ternary ? [ternary[2],ternary[4]] : [];
      for(const key of keys) if(!(key in catalog))missing.push(`${path}: ${key}`);
    }
  }
  assert.deepEqual(missing,[]);
});
