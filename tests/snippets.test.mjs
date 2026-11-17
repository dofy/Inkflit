import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { CompletionContext } from '@codemirror/autocomplete';
import catalog from '../Resources/Translations.json' with { type: 'json' };
import { builtinSnippets, matchSnippets, expandTemplate, templateSnippet, addSnippetSource, allSnippets, snippetContext, isoWeek } from '../web/snippets.js';
import { snippetCompletions } from '../web/snippet-completion.js';
import { setLanguage } from '../web/i18n.js';

setLanguage('en');

const now = new Date(2026, 10, 18, 9, 5, 30);   // Wednesday 18 November 2026
const values = (trigger, locale = 'en') => builtinSnippets.filter(row => row.trigger === trigger).map(row => row.expand(snippetContext({ now, locale })));
const rowsOf = query => matchSnippets(query).map(({ row, alias }) => `${alias ? `${alias}→` : ''}${row.trigger}`);

test('date and time groups, default first', () => {
  assert.deepEqual(values('date'), ['2026-11-18', '2026/11/18', '20261118', 'November 18, 2026', 'Wednesday, November 18, 2026']);
  assert.deepEqual(values('time'), ['09:05', '09:05:30', '9:05 AM']);
  assert.deepEqual(values('now').slice(0, 2), ['2026-11-18 09:05', '2026-11-18 09:05:30']);
  assert.match(values('now')[2], /^2026-11-18T09:05:30[+-]\d\d:\d\d$/);
  assert.deepEqual(values('timestamp'), [String(Math.floor(now.getTime() / 1000)), String(now.getTime())]);
});

test('year, month, day and week follow the app language', () => {
  assert.deepEqual(values('year'), ['2026', '2026']);
  assert.deepEqual(values('month'), ['2026-11', '11', 'November', 'November 2026']);
  assert.deepEqual(values('day'), ['18', '18', 'November 18']);
  assert.deepEqual(values('week'), ['2026-W47', 'W47', 'Wednesday', 'Wed']);
  // Engines differ in spacing (WebKit writes "18日 水曜日", Node "18日水曜日").
  const compact = list => list.map(value => value.replace(/\s+/g, ''));
  assert.deepEqual(values('week', 'ja').slice(2), ['水曜日', '水']);
  assert.deepEqual(compact(values('date', 'ja').slice(3)), ['2026年11月18日', '2026年11月18日水曜日']);
  assert.equal(values('time', 'ja')[2], '午前9:05');
  assert.deepEqual(values('month', 'ja').slice(2), ['11月', '2026年11月']);
  assert.deepEqual(values('day', 'ja'), ['18', '18日', '11月18日']);
  assert.deepEqual(values('year', 'ja'), ['2026', '2026年']);
  assert.deepEqual(values('week', 'zh-Hans').slice(2), ['星期三', '周三']);
  assert.deepEqual(values('week', 'zh-Hant').slice(2), ['星期三', '週三']);
  assert.deepEqual(compact(values('date', 'zh-Hans').slice(3)), ['2026年11月18日', '2026年11月18日星期三']);
  assert.equal(values('time', 'zh-Hant')[2], '上午9:05');
  assert.deepEqual([isoWeek(new Date(2021, 0, 1)), isoWeek(new Date(2026, 11, 31))], [{ year: 2020, week: 53 }, { year: 2026, week: 53 }]);
});

test('every row is previewed except uuid, and descriptions exist', () => {
  for (const row of builtinSnippets) {
    if (row.description) assert.ok(catalog[row.description], `${row.trigger}: ${row.description}`);
    if (row.hint) assert.ok(catalog[row.hint], `${row.trigger}: ${row.hint}`);
    if (row.trigger === 'uuid') assert.equal(row.preview, undefined);
    else assert.ok(row.preview, `${row.trigger} preview`);
    assert.ok(!(row.live && row.previewTTL), `${row.trigger}: live or cached, not both`);
  }
});

test('typing shows every format of each matching trigger', () => {
  assert.deepEqual(rowsOf(''), ['date', 'time', 'now', 'year', 'month', 'day', 'week', 'timestamp', 'uuid', 'ip', 'mac', 'host'], '"@" alone is an overview');
  assert.deepEqual(rowsOf('wee'), ['week', 'week', 'week', 'week']);
  assert.deepEqual(rowsOf('time'), ['time', 'time', 'time', 'timestamp', 'timestamp']);
  assert.deepEqual(rowsOf('ti'), ['time', 'time', 'time', 'timestamp', 'timestamp']);
  assert.deepEqual(rowsOf('wk'), ['week', 'week', 'week', 'week'], 'letters in order also fit');
  assert.deepEqual(rowsOf('tsp'), ['timestamp', 'timestamp']);
  assert.deepEqual(rowsOf('ip'), ['ip', 'ip', 'ip', 'ip']);
  assert.deepEqual(rowsOf('timesec'), ['timesec→time'], 'a whole alias is that row');
  assert.deepEqual(rowsOf('who'), ['whoami→host']);
  assert.deepEqual(rowsOf('wi'), ['whoami→host'], 'aliases fit fuzzily too');
  assert.deepEqual(rowsOf('wd'), ['weekday→week']);
  assert.deepEqual(rowsOf('lip'), ['localip→ip']);
  assert.deepEqual(rowsOf('xyz'), []);
  const ipRows = matchSnippets('ip').map(({ row }) => row.description);
  assert.deepEqual(ipRows, ['snippet.ip', 'snippet.ipv4', 'snippet.ipv6', 'snippet.localIP'], 'mac is not in @ip');
});

test('uuid, network and machine rows use the context', async () => {
  const context = snippetContext({ randomUUID: () => 'ab-cd' });
  assert.deepEqual(builtinSnippets.filter(row => row.trigger === 'uuid').map(row => row.expand(context)), ['ab-cd', 'AB-CD', 'abcd']);
  const byAlias = alias => builtinSnippets.find(row => row.aliases?.includes(alias));
  const requested = [];
  const fetch = async url => { requested.push(url); return { ok: true, text: async () => ' 203.0.113.7\n' }; };
  assert.equal(await byAlias('ipv4').expand(snippetContext({ fetch })), '203.0.113.7');
  assert.deepEqual(requested, ['https://api.ipify.org']);
  await assert.rejects(byAlias('ipv6').expand(snippetContext({ fetch: async () => ({ ok: true, text: async () => '<html>' }) })), /Unexpected/);
  const asked = [];
  for (const alias of ['localip', 'ether', 'hostname', 'computer', 'whoami']) await byAlias(alias).expand(snippetContext({ native: async action => { asked.push(action); return 'x'; } }));
  assert.deepEqual(asked, ['local-ip', 'mac', 'hostname', 'computer-name', 'whoami']);
  await assert.rejects(byAlias('localip').expand(snippetContext()), /app/);
});

test('user rows lead their group, like several "addr" replacements', async () => {
  const context = snippetContext({ now });
  const user = [templateSnippet('addr', 'Home'), templateSnippet('addr', 'Office'), templateSnippet('date', 'Today: {date}'), templateSnippet('loop', '{loop}!')];
  const remove = addSnippetSource(() => user);
  try {
    assert.deepEqual(rowsOf('addr'), ['addr', 'addr']);
    assert.deepEqual(await Promise.all(matchSnippets('addr').map(({ row }) => row.expand(context))), ['Home', 'Office']);
    const dates = matchSnippets('date').map(({ row }) => row).filter(row => row.trigger === 'date');
    assert.equal(dates.length, 6);
    assert.equal(await dates[0].expand(context), 'Today: 2026-11-18', 'the user row is the default and {date} is the next row');
    assert.equal(await matchSnippets('loop')[0].row.expand(context), '{loop}!');
    assert.equal(new Set(allSnippets().map(row => row.id)).size, allSnippets().length, 'ids are unique');
  } finally { remove(); }
  assert.equal(matchSnippets('date').filter(({ row }) => row.trigger === 'date').length, 5);
});

test('templates expand default rows and keep the rest', async () => {
  const context = snippetContext({ now });
  assert.equal(await expandTemplate('Meeting {date} at {time}', context), 'Meeting 2026-11-18 at 09:05');
  assert.equal(await expandTemplate('{unknown} {{date} {{', context), '{unknown} {date} {');
});

test('the list appears after @ only outside code and words', () => {
  const labels = doc => {
    const pos = doc.indexOf('|'), text = doc.replace('|', '');
    const state = EditorState.create({ doc: text, extensions: [markdown()] });
    return snippetCompletions(new CompletionContext(state, pos, false))?.options.map(option => option.label) ?? null;
  };
  assert.deepEqual(labels('Due @da|'), [...Array(5).fill('@date'), '@day', '@day', '@datetime', '@datetimesec'], 'all date and day formats (English 18 once), then aliases');
  assert.deepEqual(labels('@wee|'), ['@week', '@week', '@week', '@week']);
  assert.deepEqual(labels('@timesec|'), ['@timesec']);
  assert.deepEqual(labels('@year|'), ['@year'], 'English "2026" and "2026" are listed once');
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
  state = state.update({ changes: { from: 6, to: 8, insert: 'ipv4' } }).state;
  assert.equal(state.field(pending).has(id), false, 'edited text is no longer replaced');
});
