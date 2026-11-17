import {test} from 'node:test';
import assert from 'node:assert/strict';
import {filterCommands} from '../web/command-palette.js';

test('command search matches localized text, aliases and multiple terms',()=>{
 const commands=[{label:'界面主色：海蓝',group:'设置',aliases:['appearance accent theme color','blue']},{label:'关闭 Vim 模式',group:'设置',aliases:['vim mode toggle']}];
 assert.deepEqual(filterCommands(commands,''),commands);
 assert.deepEqual(filterCommands(commands,'BLUE theme'),[commands[0]]);
 assert.deepEqual(filterCommands(commands,'设置 vim'),[commands[1]]);
 assert.deepEqual(filterCommands(commands,'nothing'),[]);
});
