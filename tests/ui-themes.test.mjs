import test from 'node:test';
import assert from 'node:assert/strict';
import { applyUIAppearance, normalizeOpacity, uiTheme, uiThemes } from '../web/ui-themes.js';

test('UI colors and opacity apply together and reject invalid settings',()=>{
  assert.deepEqual(uiThemes.map(theme=>theme.id),['orange','blue','green']);
  const styles={};const root={dataset:{},style:{setProperty:(key,value)=>{styles[key]=value;}}};
  applyUIAppearance('blue',70,root);
  assert.equal(root.dataset.uiTheme,'blue');assert.equal(styles['--ui-accent'],uiTheme('blue').colors.accent);
  assert.equal(styles['--ui-opacity'],'0.7');assert.equal(styles['--ui-paper-rgb'],'251,253,255');
  assert.equal(normalizeOpacity(-20),50);assert.equal(normalizeOpacity(200),100);assert.equal(normalizeOpacity('invalid'),100);
  applyUIAppearance('unknown',100,root);assert.equal(root.dataset.uiTheme,'orange');
});
