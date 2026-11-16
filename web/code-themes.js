import catalog from '../Resources/CodeThemes.json' with { type: 'json' };

export const codeThemes = catalog;
export function codeTheme(id) { return catalog.find(theme=>theme.id===id) || catalog[0]; }
export function applyCodeTheme(id, root=document.documentElement,dark=globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false) {
  const theme=codeTheme(id);
  for(const [name,color] of Object.entries(dark ? theme.darkColors : theme.colors))root.style.setProperty(`--syntax-${name}`,color);
  root.dataset.codeTheme=theme.id;
}
