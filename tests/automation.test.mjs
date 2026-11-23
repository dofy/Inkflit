import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorState } from '@codemirror/state';
import { history, undoDepth } from '@codemirror/commands';
import { app } from '../web/app.js';
import { notesOperation } from '../web/automation.js';
import { saveResult } from '../web/persistence.js';

const note = (id, content) => ({ id, content, updated: '2026-01-01T00:00:00Z' });

test('the original list response, optional summaries and cursor pagination coexist', async () => {
  const notes = [
    note('one', '\n:::inkflit math\n1 + 2 =\n:::end'),
    note('two', 'second'),
    note('three', '😀'.repeat(170))
  ];
  app.state = { notes, selected: 'two' };
  try {
    const legacy = await notesOperation({ action: 'list' });
    assert.deepEqual(legacy, { notes: notes.map((item, index) => ({ ...item, index: index + 1 })) });
    const first = await notesOperation({ action: 'list', limit: 2, include_content: false });
    assert.equal(first.total, 3);
    assert.equal(first.next_cursor, 'two');
    assert.equal(first.notes[0].summary, '1 + 2 =');
    assert.ok(first.notes.every(item => !Object.hasOwn(item, 'content')));

    notes.unshift(note('new', 'inserted before the cursor'));
    const last = await notesOperation({ action: 'list', cursor: first.next_cursor, include_content: false });
    assert.deepEqual(last, { notes: [{ id: 'three', index: 4, updated: notes[3].updated, summary: '😀'.repeat(160) + '…' }], total: 4, next_cursor: null });
    await assert.rejects(notesOperation({ action: 'list', cursor: 'removed' }), /restart pagination/);
    await assert.rejects(notesOperation({ action: 'list', limit: 101 }), /1 to 100/);
    await assert.rejects(notesOperation({ action: 'list', include_content: 'false' }), /must be a boolean/);
  } finally { app.state = null; }
});

test('current note and structured analysis preserve the selected note and content', async () => {
  const content = [
    'list: Tasks', 'First', '[x] Done', '// ignore me', ':::inkflit math', '2 + 3 =', ':::end',
    ':::inkflit sum', 'coffee 4', 'lunch 6', ':::end', ':::inkflit avg', '3', '7', ':::end',
    ':::inkflit count', 'two words', ':::end', ':::inkflit code js', 'throw new Error()', ':::end'
  ].join('\n');
  app.state = { notes: [note('plain', 'selected'), note('calculations', content)], selected: 'plain' };
  try {
    const current = await notesOperation({ action: 'current' });
    assert.equal(current.note.id, 'plain');
    assert.equal(current.note.content, 'selected');
    const analysis = await notesOperation({ action: 'analyze', id: 'calculations' });
    assert.equal(analysis.note.id, 'calculations');
    assert.ok(!Object.hasOwn(analysis.note, 'content'));
    assert.deepEqual(analysis.blocks.map(block => block.mode), ['list', 'math', 'sum', 'avg', 'count']);
    const [list, math, sum, avg, count] = analysis.blocks;
    assert.deepEqual(list.tasks, [{ line: 2, completed: false }, { line: 3, completed: true }]);
    assert.deepEqual(list.stats, { items: 2, completed: 1, remaining: 1 });
    assert.deepEqual(math.results, [{ line: 6, value: 5, text: '5' }]);
    assert.deepEqual(sum.stats, { count: 2, total: 10 });
    assert.deepEqual(avg.stats, { count: 2, average: 5 });
    assert.deepEqual(count.stats, { items: 1, words: 2, chars: 9 });
    assert.equal(app.state.selected, 'plain');
    assert.equal(app.state.notes[1].content, content);
    await assert.rejects(notesOperation({ action: 'analyze' }), /id or 1-based index/);
  } finally { app.state = null; }
});

test('MCP format applies exactly the reviewed changes by ID, once, without switching notes', async () => {
  const before = 'Title  stays\n:::inkflit code js\nif(true){f(1)}\n:::end';
  const notes = [note('current', 'stay here'), note('format', before)];
  app.state = { notes, selected: 'current' };
  app.editorCache.set('format', { state: EditorState.create({ doc: before, extensions: history() }) });
  const saved = [];
  globalThis.document = { getElementById: () => ({}) };
  globalThis.window = { webkit: { messageHandlers: { inkflit: { postMessage(message) {
    assert.equal(message.type, 'save');
    assert.equal(message.force, true);
    saved.push(JSON.parse(message.json));
    saveResult(true, null, message.revision);
  } } } } };
  app.codeIndentation = 'spaces4';
  const preview = () => notesOperation({ action: 'format-preview', id: 'format' });
  const apply = (preview_id, id = 'format') => notesOperation({ action: 'format-apply', id, preview_id });
  try {
    const stale = await preview();
    notes[1].content = before + '\nNew text';
    await assert.rejects(apply(stale.preview_id), /changed since preview/);
    assert.equal(saved.length, 0);
    notes[1].content = before;
    const review = await preview();
    assert.equal(review.changed, true);
    assert.match(review.diff, /\+    f\(1\);/);
    assert.equal(saved.length, 0);
    await assert.rejects(apply(review.preview_id, 'current'), /unavailable for this note/);
    await assert.rejects(apply(undefined), /preview_id/);
    await assert.rejects(notesOperation({ action: 'format-preview', index: 2 }), /stable note id/);
    app.codeIndentation = 'spaces2';
    const result = await apply(review.preview_id);
    assert.equal(result.note.id, 'format');
    assert.equal(result.changed, true);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].selected, 'current');
    const expected = 'Title  stays\n:::inkflit code js\nif (true) {\n    f(1);\n}\n:::end';
    assert.equal(saved[0].notes[1].content, expected);
    assert.equal(app.editorCache.get('format').state.doc.toString(), expected);
    assert.equal(undoDepth(app.editorCache.get('format').state), 1);
    await assert.rejects(apply(review.preview_id), /unavailable/);
    app.codeIndentation = 'spaces4';
    const empty = await preview();
    assert.deepEqual({ changed: empty.changed, diff: empty.diff, preview_id: empty.preview_id }, { changed: false, diff: '', preview_id: null });
  } finally {
    app.state = null; app.editorCache.clear(); app.codeIndentation = 'spaces2';
    delete globalThis.window; delete globalThis.document;
  }
});

test('MCP discards a preview if the note changes while the formatter is running', async () => {
  const item = note('math', 'math\n1+2=');
  app.state = { notes: [item], selected: 'math' };
  try {
    const preview = notesOperation({ action: 'format-preview', id: 'math' });
    item.content += '\nNew text';
    await assert.rejects(preview, /changed during formatting/);
  } finally { app.state = null; }
});
