import themes from '../Resources/UIThemes.json' with { type: 'json' };
export const uiThemes=themes;
export function uiTheme(id) { return themes.find(theme=>theme.id===id) || themes[0]; }
export function normalizeOpacity(value) { const n=Number(value);return Number.isFinite(n) ? Math.max(50,Math.min(100,n)) : 100; }
const darkColors={
 orange:{ink:'#f3e9df',muted:'#b9a89a',accent:'#ffac70',bar:'#30251e',paper:'#211c19',border:'#594536',hover:'#543b2b',button:'#e6b794',active:'#392a21',cursor:'#ffad6d',checked:'#d87932',selection:'#76503a'},
 blue:{ink:'#e4edf6',muted:'#9eafbf',accent:'#8dc9ff',bar:'#202d39',paper:'#19232d',border:'#385063',hover:'#334d62',button:'#a8cbe6',active:'#243747',cursor:'#8dc9ff',checked:'#397fb8',selection:'#375a76'},
 green:{ink:'#e7efe7',muted:'#a4b7a8',accent:'#9ad8ac',bar:'#233128',paper:'#1b261f',border:'#3d5847',hover:'#355442',button:'#b0d6b8',active:'#293c30',cursor:'#9ad8ac',checked:'#4c8a60',selection:'#3c6148'}
};
export function applyUIAppearance(id,opacity,root=document.documentElement,dark=globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false) {
  const theme=uiTheme(id);
  const colors=dark ? darkColors[theme.id] : theme.colors;
  for(const [name,color] of Object.entries(colors))root.style.setProperty(`--ui-${name}`,color);
  for(const name of ['paper','bar','active']) {
    const hex=colors[name].slice(1);
    root.style.setProperty(`--ui-${name}-rgb`,[0,2,4].map(i=>parseInt(hex.slice(i,i+2),16)).join(','));
  }
  root.style.setProperty('--ui-opacity',String(normalizeOpacity(opacity)/100));
  root.style.setProperty('color-scheme',dark?'dark':'light');
  root.dataset.uiTheme=theme.id;
  root.dataset.colorScheme=dark?'dark':'light';
}
