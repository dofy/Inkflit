import {test} from 'node:test';
import assert from 'node:assert/strict';
import {filterCommands, rankCommands} from '../web/command-palette.js';
import { app } from '../web/app.js';
import { availableCommands, commandShortcut, commandShortcutLabel } from '../web/commands.js';
import { lang, setLanguage } from '../web/i18n.js';

test('command search matches localized text, aliases and multiple terms',()=>{
 const commands=[{label:'界面主色：海蓝',group:'设置',aliases:['appearance accent theme color','blue']},{label:'关闭 Vim 模式',group:'设置',aliases:['vim mode toggle']}];
 assert.deepEqual(filterCommands(commands,''),commands);
 assert.deepEqual(filterCommands(commands,'BLUE theme'),[commands[0]]);
 assert.deepEqual(filterCommands(commands,'设置 vim'),[commands[1]]);
 assert.deepEqual(filterCommands(commands,'nothing'),[]);
});

test('commands rank by their most recent use even with repeated entries in older history', () => {
  const commands = ['unused-a', 'frequent', 'second-latest', 'latest', 'unused-b', 'older'].map(id => ({ id }));
  const history = ['unavailable', 'latest', 'second-latest', 'older', 'frequent', 'frequent', 'frequent', 'second-latest'];
  assert.deepEqual(rankCommands(commands, history).map(command => command.id),
    ['latest', 'second-latest', 'older', 'frequent', 'unused-a', 'unused-b']);
  assert.deepEqual(rankCommands(commands, ['older', ...history]).map(command => command.id),
    ['older', 'latest', 'second-latest', 'frequent', 'unused-a', 'unused-b']);
  assert.deepEqual(rankCommands(commands, []), commands);
});

test('palette labels and keyboard lookup share command bindings', () => {
  const event = { metaKey: true, shiftKey: false, key: 'n', code: 'KeyN' };
  const command = commandShortcut(event, 'main');
  assert.equal(command.id, 'new-note');
  assert.equal(availableCommands().find(row => row.id === command.id).shortcut, '⌘N');
  assert.equal(commandShortcut({ ...event, altKey: true }, 'main'), null);
  const first = commandShortcut({ ...event, shiftKey: true, key: '{', code: 'BracketLeft' }, 'main');
  assert.equal(first.id, 'first-note');
  assert.equal(commandShortcutLabel(first.id), '⌘⇧[');
  assert.equal(commandShortcut({ ...event, key: '1', code: 'Digit1' }, 'main').id, 'note-position-1');
  assert.ok(!availableCommands().some(row => row.id === 'note-position-1'));
  assert.equal(commandShortcut({ ...event, key: 'p', code: 'KeyP', shiftKey: true }, 'palette').id, 'open-command-palette');
});

test('editor font shortcuts accept plus, equals, and minus', () => {
  for (const [key, code, shiftKey, id] of [
    ['=', 'Equal', false, 'increase-editor-font-size'],
    ['+', 'Equal', true, 'increase-editor-font-size'],
    ['+', 'NumpadAdd', false, 'increase-editor-font-size'],
    ['-', 'Minus', false, 'decrease-editor-font-size'],
    ['-', 'NumpadSubtract', false, 'decrease-editor-font-size'],
  ]) {
    const event = { key, code, metaKey: true, shiftKey };
    assert.equal(commandShortcut(event, 'palette')?.id, id);
    assert.equal(commandShortcut({ ...event, altKey: true }, 'palette'), null);
  }
});

test('the interface color command can find multicolor themes by name', () => {
  const originalLanguage = lang();
  try {
    setLanguage('zh-Hans');
    const options = availableCommands().find(command => command.id === 'ui-theme').children();
    for (const query of ['pepsi', '百事可乐', 'christmas', '朱漆红', '午夜黑金', '孔雀蓝金']) {
      assert.equal(filterCommands(options, query).length, 1, query);
    }
    assert.equal(filterCommands(options, '莓红冰蓝').length, 0);
  } finally {
    setLanguage(originalLanguage);
  }
});

test('contextual editor commands appear only where they can run', async () => {
  const { EditorState } = await import('@codemirror/state');
  const visible = id => availableCommands().some(row => row.id === id);
  app.editor = { state: EditorState.create({ doc: 'text' }) };
  try {
    assert.equal(visible('copy-code-block'), false);
    assert.equal(visible('toggle-task'), false);
    app.editor.state = EditorState.create({ doc: '- [ ] task' });
    assert.equal(visible('toggle-task'), true);
    app.editor.state = EditorState.create({ doc: ':::inkflit code js\nhello\n:::end', selection: { anchor: 20 } });
    assert.equal(visible('copy-code-block'), true);
    assert.equal(visible('code-language'), true);
    assert.equal(visible('delete-block'), true);
    app.editor.state = EditorState.create({ doc: 'code js\nhello()' });
    assert.equal(visible('insert-block'), false);
  } finally {
    app.editor = null;
  }
});

test('the hide command is available only when the window is unpinned', async () => {
  const { EditorState } = await import('@codemirror/state');
  const canHide = () => availableCommands().some(row => row.id === 'hide-window');
  app.editor = { state: EditorState.create() };
  try {
    assert.equal(canHide(), true);
    app.windowPinned = true;
    assert.equal(canHide(), false);
  } finally {
    app.editor = null;
    app.windowPinned = false;
  }
});
