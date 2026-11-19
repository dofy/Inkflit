import {test} from 'node:test';
import assert from 'node:assert/strict';
import {filterCommands} from '../web/command-palette.js';
import { app } from '../web/app.js';
import { availableCommands, commandShortcut, commandShortcutLabel } from '../web/commands.js';

test('command search matches localized text, aliases and multiple terms',()=>{
 const commands=[{label:'界面主色：海蓝',group:'设置',aliases:['appearance accent theme color','blue']},{label:'关闭 Vim 模式',group:'设置',aliases:['vim mode toggle']}];
 assert.deepEqual(filterCommands(commands,''),commands);
 assert.deepEqual(filterCommands(commands,'BLUE theme'),[commands[0]]);
 assert.deepEqual(filterCommands(commands,'设置 vim'),[commands[1]]);
 assert.deepEqual(filterCommands(commands,'nothing'),[]);
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
