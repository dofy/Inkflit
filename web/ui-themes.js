import themes from '../Resources/UIThemes.json' with { type: 'json' };
export const uiThemes=themes;
export function uiTheme(id) { return themes.find(theme=>theme.id===id) || themes[0]; }
export function normalizeOpacity(value) { const n=Number(value);return Number.isFinite(n) ? Math.max(50,Math.min(100,n)) : 100; }
export function applyUIAppearance(id,opacity,root=document.documentElement,dark=globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false) {
  const theme=uiTheme(id);
  const base=dark ? theme.darkColors : theme.colors;
  const colors={
    chrome:base.bar, 'chrome-ink':base.button, 'chrome-muted':base.muted,
    'chrome-accent':base.accent, 'chrome-hover':base.hover, 'chrome-border':base.border,
    'chrome-error':'#b63e3e', ...base
  };
  for(const [name,color] of Object.entries(colors))root.style.setProperty(`--ui-${name}`,color);
  for(const [name,color] of Object.entries({
    paper:colors.paper, bar:colors.bar, active:colors.active,
    chrome:colors.chrome, 'chrome-base':base.chrome ?? colors.paper
  })) {
    const hex=color.slice(1);
    root.style.setProperty(`--ui-${name}-rgb`,[0,2,4].map(i=>parseInt(hex.slice(i,i+2),16)).join(','));
  }
  root.style.setProperty('--ui-opacity',String(normalizeOpacity(opacity)/100));
  root.style.setProperty('color-scheme',dark?'dark':'light');
  root.dataset.uiTheme=theme.id;
  root.dataset.colorScheme=dark?'dark':'light';
}
