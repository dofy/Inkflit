import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { CompletionContext } from '@codemirror/autocomplete';
import catalog from '../Resources/Translations.json' with { type: 'json' };
import { builtinSnippets, matchSnippets, expandTemplate, templateSnippet, addSnippetSource, allSnippets, snippetContext } from '../web/snippets.js';
import { snippetCompletions } from '../web/snippet-completion.js';

const now = new Date(2026, 10, 18, 9, 5, 30);
const context = snippetContext({ now });
const expand = name => builtinSnippets.find(snippet => snippet.name === name).expand(context);

test('clock snippets use local time, with and without seconds', () => {
  assert.equal(expand('date'), '2026-11-18');
  assert.equal(expand('time'), '09:05');
  assert.equal(expand('timesec'), '09:05:30');
  assert.equal(expand('datetime'), '2026-11-18 09:05');
  assert.equal(expand('datetimesec'), '2026-11-18 09:05:30');
  assert.equal(expand('timestamp'), String(Math.floor(now.getTime() / 1000)));
  for (const snippet of builtinSnippets) {
    assert.ok(catalog[snippet.description], `${snippet.name}: description in catalog`);
    if (snippet.live) assert.equal(snippet.preview(context), snippet.expand(context), `${snippet.name}: preview matches`);
    assert.ok(!(snippet.live && snippet.previewTTL), `${snippet.name}: live or cached, not both`);
  }
});

test('uuid has no preview; network and machine values are previewed from a cache', async () => {
  const byName = Object.fromEntries(builtinSnippets.map(snippet => [snippet.name, snippet]));
  assert.equal(byName.uuid.preview, undefined);
  for (const name of ['ip', 'ipv4', 'ipv6', 'localip', 'mac', 'hostname', 'computer', 'whoami']) assert.ok(byName[name].previewTTL > 0 && byName[name].preview, name);
  const asked = [];
  for (const name of ['mac', 'hostname', 'computer', 'whoami']) await byName[name].expand(snippetContext({ native: async action => { asked.push(action); return 'x'; } }));
  assert.deepEqual(asked, ['mac', 'hostname', 'computer-name', 'whoami']);
  assert.equal(byName.uuid.expand(snippetContext({ randomUUID: () => 'fixed-uuid' })), 'fixed-uuid');
  const requested = [];
  const fetch = async url => { requested.push(url); return { ok: true, text: async () => ' 203.0.113.7\n' }; };
  assert.equal(await byName.ipv4.expand(snippetContext({ fetch })), '203.0.113.7');
  assert.deepEqual(requested, ['https://api.ipify.org']);
  await assert.rejects(byName.ip.expand(snippetContext({ fetch: async () => ({ ok: false, status: 503 }) })), /503/);
  await assert.rejects(byName.ipv6.expand(snippetContext({ fetch: async () => ({ ok: true, text: async () => '<html>' }) })), /Unexpected/);
  assert.equal(await byName.localip.expand(snippetContext({ native: async action => action === 'local-ip' ? '192.168.1.20' : null })), '192.168.1.20');
  await assert.rejects(byName.localip.expand(snippetContext()), /app/, 'outside the app');
});

test('matching uses name and alias prefixes, exact names first, in definition order', () => {
  assert.deepEqual(matchSnippets('').map(s => s.name), ['date', 'time', 'timesec', 'datetime', 'datetimesec', 'timestamp', 'uuid', 'ip', 'ipv4', 'ipv6', 'localip', 'mac', 'hostname', 'computer', 'whoami']);
  assert.deepEqual(matchSnippets('user').map(s => s.name), ['whoami']);
  assert.deepEqual(matchSnippets('date').map(s => s.name), ['date', 'datetime', 'datetimesec']);
  assert.deepEqual(matchSnippets('Ti').map(s => s.name), ['time', 'timesec', 'timestamp']);
  assert.deepEqual(matchSnippets('ip').map(s => s.name), ['ip', 'ipv4', 'ipv6']);
  assert.deepEqual(matchSnippets('unix').map(s => s.name), ['timestamp']);
  assert.deepEqual(matchSnippets('xyz'), []);
});

test('templates expand named snippets and keep the rest', async () => {
  assert.equal(await expandTemplate('Meeting {date} at {time}', context), 'Meeting 2026-11-18 at 09:05');
  assert.equal(await expandTemplate('{unknown} {{date} {{', context), '{unknown} {date} {');
  const slow = { name: 'slow', expand: async () => 'later' };
  assert.equal(await expandTemplate('[{slow}]', context, [slow]), '[later]');
});

test('a later source overrides a built-in, and a template cannot expand itself', async () => {
  const user = [templateSnippet('date', 'Today: {date}'), templateSnippet('loop', '{loop}!'), templateSnippet('ping', '{pong}'), templateSnippet('pong', 'p{ping}')];
  const remove = addSnippetSource(() => user);
  try {
    const byName = Object.fromEntries(allSnippets().map(snippet => [snippet.name, snippet]));
    assert.equal(await byName.date.expand(context), 'Today: 2026-11-18');
    assert.equal(await byName.loop.expand(context), '{loop}!');
    assert.equal(await byName.ping.expand(context), 'p{ping}', 'mutual references stop');
  } finally { remove(); }
  assert.equal(allSnippets().find(snippet => snippet.name === 'date').expand(context), '2026-11-18');
});

test('the list appears after @ only outside code and words', () => {
  const labels = doc => {
    const pos = doc.indexOf('|'), text = doc.replace('|', '');
    const state = EditorState.create({ doc: text, extensions: [markdown()] });
    return snippetCompletions(new CompletionContext(state, pos, false))?.options.map(option => option.label) ?? null;
  };
  assert.deepEqual(labels('Due @da|'), ['@date', '@datetime', '@datetimesec']);
  assert.equal(labels('@|').length, 15);
  assert.equal(labels('mail me@da|'), null);
  assert.equal(labels('`@da|`'), null);
  assert.equal(labels('```js\n@da|\n```'), null);
  assert.equal(labels(':::quicknote code js\n@da|\n:::end'), null);
  assert.equal(labels('@xyz|'), null);
});

test('a loading snippet keeps following its text through edits', async () => {
  const { pending, track } = await import('../web/snippet-completion.js');
  const id = {};
  let state = EditorState.create({ doc: 'a @ip b', extensions: [pending] });
  state = state.update({ effects: track.of({ id, from: 2, to: 5, text: '@ip' }) }).state;
  state = state.update({ changes: { from: 0, insert: 'xx ' } }).state;
  assert.deepEqual([state.field(pending).get(id).from, state.field(pending).get(id).to], [5, 8]);
  assert.equal(state.sliceDoc(5, 8), '@ip');
  state = state.update({ changes: { from: 6, to: 8, insert: 'ipv4' } }).state;
  assert.equal(state.field(pending).has(id), false, 'edited text is no longer replaced');
});
