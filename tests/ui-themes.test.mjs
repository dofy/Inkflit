import test from 'node:test';
import assert from 'node:assert/strict';
import { applyUIAppearance, normalizeOpacity, uiTheme, uiThemes } from '../web/ui-themes.js';

test('UI colors and opacity apply together and reject invalid settings',()=>{
  assert.deepEqual(uiThemes.map(theme=>theme.id),['orange','blue','green','cola','christmas','lacquer-red','midnight-gold','peacock-gold']);
  const styles={};const root={dataset:{},style:{setProperty:(key,value)=>{styles[key]=value;}}};
  applyUIAppearance('christmas',100,root,true);
  assert.equal(styles['--ui-chrome'],uiTheme('christmas').darkColors.chrome);
  assert.equal(styles['--ui-chrome-accent'],uiTheme('christmas').darkColors['chrome-accent']);
  applyUIAppearance('blue',70,root);
  assert.equal(root.dataset.uiTheme,'blue');assert.equal(styles['--ui-accent'],uiTheme('blue').colors.accent);
  assert.equal(styles['--ui-chrome'],uiTheme('blue').colors.bar);
  assert.equal(styles['--ui-chrome-accent'],uiTheme('blue').colors.accent);
  assert.equal(styles['--ui-chrome-base-rgb'],styles['--ui-paper-rgb']);
  assert.equal(styles['--ui-opacity'],'0.7');assert.equal(styles['--ui-paper-rgb'],'251,253,255');
  assert.equal(normalizeOpacity(-20),50);assert.equal(normalizeOpacity(200),100);assert.equal(normalizeOpacity('invalid'),100);
  applyUIAppearance('unknown',100,root);assert.equal(root.dataset.uiTheme,'orange');
  assert.equal(uiTheme('berry-ice').id, 'orange');
});

const rgb = hex => hex.slice(1).match(/../g).map(byte => parseInt(byte, 16));
function luminance(channels) {
  const [red, green, blue] = channels.map(channel => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}
function contrast(first, second) {
  const amounts = [luminance(first), luminance(second)];
  return (Math.max(...amounts) + 0.05) / (Math.min(...amounts) + 0.05);
}

test('the multicolor themes keep readable text and toolbar accents in both appearances', () => {
  for (const theme of uiThemes.filter(theme => theme.colors.chrome)) {
    const { id } = theme;
    for (const colors of [theme.colors, theme.darkColors]) {
      for (const text of ['ink', 'muted', 'accent', 'button']) {
        assert.ok(contrast(rgb(colors[text]), rgb(colors.paper)) >= 4.5, `${id}: ${text} on paper`);
      }
      assert.ok(contrast(rgb(colors.ink), rgb(colors.selection)) >= 4.5, `${id}: selected text`);
      assert.ok(contrast(rgb(colors['chrome-accent']), rgb(colors['chrome-hover'])) >= 4.5, `${id}: toolbar hover`);
      // At minimum window opacity, two 50% frame layers leave 25% of the backdrop visible.
      for (const backdrop of [0, 255]) {
        const composite = rgb(colors.chrome).map(value => value * 0.75 + backdrop * 0.25);
        for (const text of ['chrome-ink', 'chrome-muted', 'chrome-accent', 'chrome-error']) {
          assert.ok(contrast(rgb(colors[text]), composite) >= 4.5, `${id}: ${text} at 50% opacity over ${backdrop === 0 ? 'black' : 'white'}`);
        }
      }
    }
  }
});
