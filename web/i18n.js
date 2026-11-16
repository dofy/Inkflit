import catalog from '../Resources/Translations.json' with { type: 'json' };
let language=resolveLanguage(globalThis.navigator?.languages || (globalThis.navigator?.language ? [globalThis.navigator.language] : ['zh-Hans']));
export function resolveLanguage(preferred) {
  for(const raw of preferred) {
    const value=String(raw).toLowerCase().replaceAll('_','-');
    if(value.startsWith('zh')) return /hant|tw|hk|mo/.test(value)?'zh-Hant':'zh-Hans';
    if(value.startsWith('ja')) return 'ja';
    if(value.startsWith('en')) return 'en';
  }
  return 'en';
}
export function setLanguage(value) { language=['en','zh-Hans','zh-Hant','ja'].includes(value)?value:resolveLanguage(globalThis.navigator?.languages || ['en']); }
export function t(key) { return catalog[key]?.[language] ?? catalog[key]?.en ?? key; }
export function lang() { return language; }
