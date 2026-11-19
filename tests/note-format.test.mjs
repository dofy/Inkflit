import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorState } from '@codemirror/state';
import { history, undo, undoDepth } from '@codemirror/commands';
import { app } from '../web/app.js';
import { analyze } from '../web/features.js';
import { blockProtection } from '../web/block-protection.js';
import { listPasteRules } from '../web/list-editing.js';
import { formatCurrentNote, planNoteFormat } from '../web/note-format.js';

test('formats math spacing without changing results, literals or comments', async () => {
  const before = [
    'math: Trip', 'price : 2e-3+3', 'sin(30 deg )=', '50 km/2h to km/minute=',
    'max( price, -1 )=', '6 in  to cm=', '10USD to CNY=', '2× ( 3 +4 ) =',
    '//  leave   alone', 'draft  text', '1+ =',
  ].join('\n');
  const state = EditorState.create({ doc: before });
  const changes = await planNoteFormat(state.doc, 'spaces2');
  const after = state.update({ changes }).newDoc.toString();
  assert.equal(after, [
    'math: Trip', 'price: 2e-3 + 3', 'sin(30 deg) =', '50 km / 2 h to km / minute =',
    'max(price, -1) =', '6 in to cm =', '10 USD to CNY =', '2 × (3 + 4) =',
    '//  leave   alone', 'draft  text', '1+ =',
  ].join('\n'));
  const rates = { values: { USD: 1, CNY: 7.1 } };
  assert.deepEqual(analyze(after, rates).results.map(row => row.text), analyze(before, rates).results.map(row => row.text));
});

test('formats eligible blocks together using the code preference and one undo step', async () => {
  const source = [
    'Prose  with   spacing', ':::inkflit code ts', 'if(true){', '', 'const x:number=1', '}', ':::end',
    ':::inkflit list', 'root', '      child', ':::end',
    '  ```json', '  {"x":1}', '  ```',
    '```math', 'sin( 30 deg )=', '```',
    '```python', 'print(  1 )', '```',
    '```js', 'const =', '```',
    '```js', 'const x=1',
  ].join('\n');
  const editor = {
    state: EditorState.create({ doc: source, extensions: [history(), blockProtection, listPasteRules] }),
    dispatch(spec) { this.state = this.state.update(spec).state; },
  };
  app.editor = editor; app.codeIndentation = 'spaces4';
  try {
    await formatCurrentNote();
    const formatted = [
      'Prose  with   spacing', ':::inkflit code ts', 'if (true) {', '    const x: number = 1;', '}', ':::end',
      ':::inkflit list', 'root', '      child', ':::end',
      '  ```json', '  { "x": 1 }', '  ```',
      '```math', 'sin(30 deg) =', '```',
      '```python', 'print(  1 )', '```',
      '```js', 'const =', '```',
      '```js', 'const x=1',
    ].join('\n');
    assert.equal(editor.state.doc.toString(), formatted);
    assert.deepEqual(await planNoteFormat(editor.state.doc, 'spaces4'), []);
    assert.equal(undoDepth(editor.state), 1);
    assert.equal(undo({ state: editor.state, dispatch: spec => editor.dispatch(spec) }), true);
    assert.equal(editor.state.doc.toString(), source);
  } finally { app.editor = null; app.codeIndentation = 'spaces2'; }
});

test('does not apply a format computed for an older document', async () => {
  const editor = {
    state: EditorState.create({ doc: 'code js\nconst x=1' }),
    dispatch() { assert.fail('the formatter overwrote a newer edit'); },
  };
  app.editor = editor;
  try {
    const formatting = formatCurrentNote();
    editor.state = editor.state.update({ changes: { from: editor.state.doc.length, insert: '0' } }).state;
    await formatting;
  } finally { app.editor = null; }
});
