import test from 'node:test';
import assert from 'node:assert/strict';
import { classHighlighter, highlightTree } from '@lezer/highlight';
import { codeLanguage } from '../web/code-languages.js';
import { applyCodeTheme, codeTheme, codeThemes } from '../web/code-themes.js';

test('theme selection exposes complete palettes and falls back safely',()=>{
  assert.equal(codeThemes.length,3);
  assert.equal(new Set(codeThemes.map(t=>t.id)).size,codeThemes.length);
  for(const theme of codeThemes)for(const key of ['property','string','keyword','number','comment','function','variable','operator','punctuation'])assert.match(theme.colors[key],/^#[0-9a-f]{6}$/i);
  const styles={}; const root={dataset:{},style:{setProperty:(key,value)=>{styles[key]=value;}}};
  applyCodeTheme('ocean',root);assert.equal(root.dataset.codeTheme,'ocean');assert.equal(styles['--syntax-property'],codeTheme('ocean').colors.property);
  applyCodeTheme('missing',root);assert.equal(root.dataset.codeTheme,'amber');
});

test('JSON keys, strings, booleans and numbers have distinct semantic classes',async()=>{
  const support=await codeLanguage('json').load();
  const text='{"name":"Inkflit","active":true,"count":42}', found={};
  highlightTree(support.language.parser.parse(text),classHighlighter,(from,to,classes)=>{found[text.slice(from,to)]=classes;});
  assert.match(found['"name"'],/tok-propertyName/);assert.match(found['"Inkflit"'],/tok-string/);
  assert.match(found.true,/tok-bool/);assert.match(found['42'],/tok-number/);
});
