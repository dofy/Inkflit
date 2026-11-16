import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';

// CodeMirror passes the first word of the fence info string to this resolver.
export function codeLanguage(info) {
  const name=info.replace(/^code:/i, '');
  if (!name || name.toLowerCase() === 'code') return null;
  return LanguageDescription.matchLanguageName(languages, name, true);
}
