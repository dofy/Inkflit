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
    assert.equal(t('新建笔记'),catalog['新建笔记'][language]);
  }
});
test('each accent and code theme provides readable dark colors',()=>{
  const css={};const root={dataset:{},style:{setProperty:(key,value)=>css[key]=value}};
  for(const id of ['orange','blue','green']) { applyUIAppearance(id,80,root,true); assert.equal(root.dataset.colorScheme,'dark');assert.notEqual(css['--ui-ink'],css['--ui-paper']); }
  for(const id of ['amber','ocean','contrast']) { applyCodeTheme(id,root,true); assert.match(css['--syntax-property'],/^#[0-9a-f]{6}$/); }
});
