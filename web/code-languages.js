import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';

// CodeMirror passes the first word of the fence info string to this resolver.
export function codeLanguage(info) {
  const name=info.replace(/^code:/i, '');
  if (!name || name.toLowerCase() === 'code') return null;
  return LanguageDescription.matchLanguageName(languages, name, true);
}

// The line comment marker of a language, shared by ⌘/ (comments.js) and
// bracket pairing (code-editing.js) so both agree on what is a comment.
const hashComments = new Set(['python','py','shell','sh','bash','ruby','rb']);
export function lineCommentMarker(language = '') {
  const name = language.toLowerCase();
  return hashComments.has(name) ? '#' : name === 'sql' ? '--' : '//';
}
