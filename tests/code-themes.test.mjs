import test from 'node:test';
import assert from 'node:assert/strict';
import { classHighlighter, highlightTree } from '@lezer/highlight';
import { codeLanguage } from '../web/code-languages.js';
import { applyCodeTheme, codeTheme, codeThemes } from '../web/code-themes.js';

test('theme selection exposes complete palettes and falls back safely',()=>{
  assert.deepEqual(codeThemes.map(theme=>theme.id),['github','solarized','one']);
  const keys=['background','foreground','active','property','string','keyword','constant','number','comment','function','variable','operator','punctuation'];
  const styles={}; const root={dataset:{},style:{setProperty:(key,value)=>{styles[key]=value;}}};
  for(const [variant,dark] of [['colors',false],['darkColors',true]]) {
    for(const theme of codeThemes) {
      applyCodeTheme(theme.id,root,dark);
      assert.equal(root.dataset.codeTheme,theme.id);
      for(const key of keys) {
        assert.match(theme[variant][key],/^#[0-9a-f]{6}$/i);
        assert.equal(styles[`--syntax-${key}`],theme[variant][key]);
      }
    }
    for(const key of ['background','keyword','string','function']) {
      assert.equal(new Set(codeThemes.map(theme=>theme[variant][key])).size,codeThemes.length,key);
    }
  }
  applyCodeTheme('missing',root,false);
  assert.equal(root.dataset.codeTheme,'github');
  assert.equal(codeTheme('missing'),codeThemes[0]);
});

test('JSON keys, strings, booleans and numbers have distinct semantic classes',async()=>{
  const support=await codeLanguage('json').load();
  const text='{"name":"Inkflit","active":true,"count":42}', found={};
  highlightTree(support.language.parser.parse(text),classHighlighter,(from,to,classes)=>{found[text.slice(from,to)]=classes;});
  assert.match(found['"name"'],/tok-propertyName/);assert.match(found['"Inkflit"'],/tok-string/);
  assert.match(found.true,/tok-bool/);assert.match(found['42'],/tok-number/);
});
