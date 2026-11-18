import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { CompletionContext } from '@codemirror/autocomplete';
import catalog from '../Resources/Translations.json' with { type: 'json' };
import { builtinSnippets, matchSnippets, expandTemplate, templateSnippet, addSnippetSource, allSnippets, snippetContext, isoWeek, field, plainText, fieldTemplate } from '../web/snippets.js';
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

test('templates name a default row, a numbered row or an alias', async () => {
  const context = snippetContext({ now, fetch: async url => ({ ok: true, text: async () => url.includes('api64') ? '2001:db8::64' : url.includes('api6') ? '2001:db8::1' : '203.0.113.7' }) });
  assert.equal(await expandTemplate('Meeting {date} at {time}', context), 'Meeting 2026-11-18 at 09:05');
  assert.equal(await expandTemplate('{date#2} {date#3} {timesec}', context), '2026/11/18 20261118 09:05:30');
  assert.equal(await expandTemplate('{ip} / {ipv4} / {ipv6}', context), '2001:db8::64 / 203.0.113.7 / 2001:db8::1');
  assert.equal(await expandTemplate('{unknown} {date#9} {{date} {{', context), '{unknown} {date#9} {date} {');
});

test('the placeholder catalog names every built-in row', async () => {
  const { placeholderCatalog, placeholderRow } = await import('../web/snippets.js');
  const catalog = placeholderCatalog(snippetContext({ now }));
  assert.equal(catalog.length, builtinSnippets.length + 1);
  assert.deepEqual(catalog[0], { trigger: null, token: 'cursor', example: null, description: 'snippet.cursor' }, 'the caret stop is listed first, on its own');
  assert.deepEqual(catalog.filter(item => item.trigger === 'ip').map(item => item.token), ['ip', 'ipv4', 'ipv6', 'localip']);
  assert.deepEqual(catalog.filter(item => item.trigger === 'date').map(item => item.token), ['date', 'date#2', 'date#3', 'date#4', 'date#5']);
  assert.equal(catalog.find(item => item.token === 'timesec').example, '09:05:30');
  for (const item of catalog.slice(1)) assert.ok(placeholderRow(item.token), `${item.token} resolves`);
  assert.equal(new Set(catalog.map(item => item.token)).size, catalog.length, 'tokens are unique');
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
  assert.equal(labels(':::inkflit code js\n@da|\n:::end'), null);
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

test('user snippets from the app join and lead their groups', async () => {
  const { setUserSnippets } = await import('../web/snippet-completion.js');
  setUserSnippets([{ trigger: 'addr', content: 'Home\nStreet 1' }, { trigger: 'addr', content: 'Office' }, { trigger: 'date', content: 'Today: {date}' }, { trigger: 'Bad', content: 'x' }, { trigger: 'empty', content: '' }]);
  try {
    const context = snippetContext({ now });
    assert.deepEqual(await Promise.all(matchSnippets('addr').map(({ row }) => row.expand(context))), ['Home\nStreet 1', 'Office']);
    assert.equal(await matchSnippets('date')[0].row.expand(context), 'Today: 2026-11-18');
    assert.equal(matchSnippets('bad').length, 0, 'invalid triggers are ignored');
    assert.equal(matchSnippets('empty').length, 0, 'empty content is ignored');
    assert.ok(matchSnippets('addr')[0].row.previewTTL, 'user rows are previewed');
  } finally { setUserSnippets([]); }
  assert.equal(matchSnippets('addr').length, 0);
});

test('math blocks offer functions, units and currencies; elsewhere they stay hidden', async () => {
  const { functionSnippets, unitSnippets, unitNames, currencySnippets, currencyPreview } = await import('../web/math-snippets.js');
  const { evaluateExpression } = await import('../web/features.js');
  const { fallbackCurrencies } = await import('../web/rates.js');
  const labels = doc => {
    const pos = doc.indexOf('|'), text = doc.replace('|', '');
    const state = EditorState.create({ doc: text, extensions: [markdown()] });
    return snippetCompletions(new CompletionContext(state, pos, false))?.options.map(option => option.label) ?? null;
  };
  for (const name of unitNames) assert.ok(evaluateExpression(`1 ${name}`), `${name} parses`);
  for (const row of [...functionSnippets, ...unitSnippets, ...currencySnippets(fallbackCurrencies)]) {
    assert.ok(catalog[row.hint ?? row.description], `${row.trigger}: ${row.hint ?? row.description}`);
    for (const alias of row.aliases) assert.match(alias, /^[a-z0-9]{2,}$/);
  }
  const aliases = [...functionSnippets, ...unitSnippets, ...currencySnippets(fallbackCurrencies)].flatMap(row => row.aliases);
  assert.equal(new Set(aliases).size, aliases.length, 'aliases are unique');
  assert.ok(!aliases.includes('ms'), 'built-in aliases stay with their rows');

  assert.deepEqual(labels('@kilome|'), null, 'not outside math');
  assert.deepEqual(labels('math\n10 @kilome|'), ['@kilometer']);
  assert.deepEqual(labels('math\n10@km|'), ['@km'], 'a number may touch "@"');
  assert.deepEqual(labels(':::inkflit math\n@sqrt|\n:::end'), ['@sqrt']);
  assert.deepEqual(labels('```math\n@usd|\n```'), ['@usd'], 'math fences are not code here');
  assert.equal(labels('```js\n@usd|\n```'), null);
  assert.equal(labels('math\nprice@km|'), null, 'a word right before "@" still blocks');
  assert.equal(labels('math\n@cur|').filter(label => label === '@cur').length, fallbackCurrencies.length);

  assert.equal(plainText(functionSnippets[0].expand()), 'sqrt()');
  assert.equal(fieldTemplate(functionSnippets[0].expand()), 'sqrt(${1:})${0}', 'the caret lands inside the brackets; Tab leaves them');
  assert.equal(unitSnippets.find(row => row.aliases.includes('minute')).expand(), 'min');
  const rates = () => Promise.resolve({ values: { EUR: 1, USD: 1.16, CNY: 8.24, JPY: 180 } });
  assert.equal(await currencyPreview('USD', { locale: 'zh-Hans', rates }), 'USD · 美元 · 1 = 7.103 CNY');
  assert.equal(await currencyPreview('USD', { locale: 'en', rates }), 'USD · US Dollar · 1 = 0.8621 EUR', 'the home currency compares with EUR');
  assert.equal(await currencyPreview('JPY', { locale: 'en', rates: () => Promise.reject(new Error('offline')) }), 'JPY · Japanese Yen', 'offline still names it');
});

test('exchange rates are asked once an hour and shared', async () => {
  const { refreshRates, currencyCodes, currentRates } = await import('../web/rates.js');
  let calls = 0;
  const fetch = async () => { calls++; return { ok: true, json: async () => ({ date: '2026-11-18', rates: { USD: 1.16, CNY: 8.24 } }) }; };
  const [a, b] = await Promise.all([refreshRates(fetch), refreshRates(fetch)]);
  assert.equal(calls, 1);
  assert.equal(a, b);
  assert.deepEqual(currentRates().values, { EUR: 1, USD: 1.16, CNY: 8.24 });
  assert.deepEqual(currencyCodes(), ['CNY', 'EUR', 'USD']);
  assert.equal(currencyCodes(), currencyCodes(), 'same array until the rates change');
});

test('{cursor} marks caret stops that Tab and Shift-Tab move between', async () => {
  const { EditorView } = await import('@codemirror/view');
  const { nextSnippetField, prevSnippetField, hasPrevSnippetField } = await import('@codemirror/autocomplete');
  const { applySnippet } = await import('../web/snippet-completion.js');
  const context = snippetContext({ now });
  assert.equal(await expandTemplate('Dear {cursor:name},\n{cursor}\n{date}', context), `Dear ${field('name')},\n${field()}\n2026-11-18`);
  assert.equal(fieldTemplate(`a {b} ${field('x')} c`), 'a \\{b\\} ${1:x} c${0}', 'literal braces are escaped and a last stop is added');
  assert.equal(fieldTemplate(`a ${field()}`), 'a ${1:}', 'no extra stop when the last one is at the end');
  assert.equal(plainText(`Dear ${field('name')}, ${field()}!`), 'Dear name, !');
  const row = templateSnippet('mail', 'Dear {cursor:name},\n{cursor}\nBye');
  const parent = { appendChild() {} };
  if (typeof document === 'undefined') return;  // needs a DOM for EditorView
  const view = new EditorView({ doc: '@mail', parent });
  applySnippet(view, row, 0, 5);
  await new Promise(resolve => setTimeout(resolve, 0));
  const sel = () => [view.state.selection.main.from, view.state.selection.main.to];
  assert.equal(view.state.doc.toString(), 'Dear name,\n\nBye');
  assert.deepEqual(sel(), [5, 9], 'the first stop starts with its text selected');
  nextSnippetField(view); assert.deepEqual(sel(), [11, 11]);
  assert.ok(hasPrevSnippetField(view.state));
  prevSnippetField(view); assert.deepEqual(sel(), [5, 9]);
});

test('the combined row list is reused until a source changes', async () => {
  const { setUserSnippets } = await import('../web/snippet-completion.js');
  setUserSnippets([]);
  const first = allSnippets();
  assert.equal(allSnippets(), first, 'same rows, same array');
  setUserSnippets([{ trigger: 'addr', content: 'Home' }]);
  const changed = allSnippets();
  assert.notEqual(changed, first, 'new user rows rebuild the list');
  assert.ok(changed.some(row => row.trigger === 'addr'));
  setUserSnippets([]);
  assert.ok(!allSnippets().some(row => row.trigger === 'addr'));
});
