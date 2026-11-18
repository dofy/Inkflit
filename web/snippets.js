// Snippets: typing @trigger offers values to insert in its place.
//
// Like macOS text replacements, a snippet is one row: a trigger and what it
// inserts. Rows that share a trigger form a group, the way several "addr"
// replacements do; the first row is the default. Built-ins and user-defined
// snippets have the same shape:
//
//   {trigger, expand(context), preview?(context), live?, previewTTL?, description?, aliases?}
//   trigger      lowercase word typed after "@"
//   expand       returns the text to insert, or a Promise of it, for values
//                that need I/O (an IP lookup, for example)
//   preview      value shown in the list, or a Promise of it; leave it out
//                when the value is random (uuid)
//   live         the preview changes with time and is refreshed while shown
//   previewTTL   milliseconds an async preview is reused before asking again
//   description  i18n key shown when there is no preview
//   hint         short i18n label shown beside the preview, when rows of a
//                group would otherwise look alike (IPv4 vs IPv6)
//   aliases      other words that find this row directly, such as "timesec"
//   math         offered only inside a math block (see math-snippets.js)
//
// A value may hold caret stops, made with field() or "{cursor}" in a
// template: the caret lands on the first, and Tab / ⇧Tab move between them.
//
// The context carries everything a snippet may use, so this module has no
// side effects and tests can replace any of it:
//   now, locale (app language, for Intl), fetch, native(action), randomUUID,
//   rates() (a Promise of exchange rates)
//
// Rows come from sources: built-ins, plus each addSnippetSource(). A later
// source's rows go first in their group, so a user's own "date" row becomes
// the default. The editor integration is in snippet-completion.js.

// Caret stops travel inside values as private-use characters, so they survive
// templates that name other templates. field('name') starts with "name" selected.
const FIELD = /\uE000([^\uE000\uE001]*)\uE001/g;
export const field = (text = '') => `\uE000${text}\uE001`;
export const hasFields = value => typeof value === 'string' && value.includes('\uE000');
// The value as text, for previews: stops vanish, their default text stays.
export const plainText = value => value.replace(FIELD, '$1').replace(/[\uE000\uE001]/g, '');
// The value as a CodeMirror snippet template: braces escaped, stops numbered
// in order, and a last stop at the end ("${0}"), so Tab can leave the value and
// ⇧Tab still reaches the stop before.
export function fieldTemplate(value) {
  let stop = 0;
  const template = value.replace(/[{}]/g, '\\$&').replace(FIELD, (_, text) => `\${${++stop}:${text}}`);
  return /\uE001$/.test(value) ? template : `${template}\${0}`;
}

const pad = value => String(value).padStart(2, '0');
export const formatDate = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
export const formatTime = (date, seconds = false) => `${pad(date.getHours())}:${pad(date.getMinutes())}${seconds ? `:${pad(date.getSeconds())}` : ''}`;
const intl = (context, options) => new Intl.DateTimeFormat(context.locale, options).format(context.now);
function utcOffset(date) {
  const minutes = -date.getTimezoneOffset(), sign = minutes >= 0 ? '+' : '-';
  return `${sign}${pad(Math.floor(Math.abs(minutes) / 60))}:${pad(Math.abs(minutes) % 60)}`;
}
// ISO 8601 week: weeks start on Monday; week 1 holds the year's first Thursday.
export function isoWeek(date) {
  const day = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  day.setUTCDate(day.getUTCDate() + 4 - (day.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
  return { year: day.getUTCFullYear(), week: Math.ceil(((day - yearStart) / 86400000 + 1) / 7) };
}

// Clock rows preview the value they insert and refresh it while shown.
const clock = (trigger, value, extra = {}) => ({ trigger, expand: value, preview: value, live: true, ...extra });
// Values read through the network or the app: previewed, but reused for a
// while so typing does not repeat the request.
const MINUTE = 60_000;
const lookedUp = (trigger, description, hint, expand, previewTTL, extra = {}) => ({ trigger, description, hint, expand, preview: expand, previewTTL, ...extra });
const native = action => ({ native }) => native(action);
// Public addresses come from ipify.
const lookup = url => async ({ fetch }) => {
  const response = await fetch(url, { referrerPolicy: 'no-referrer', cache: 'no-store', signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = (await response.text()).trim();
  if (!/^[0-9a-f.:]+$/i.test(text)) throw new Error('Unexpected response');
  return text;
};

export const builtinSnippets = [
  clock('date', ({ now }) => formatDate(now)),
  clock('date', ({ now }) => formatDate(now).replaceAll('-', '/')),
  clock('date', ({ now }) => formatDate(now).replaceAll('-', '')),
  clock('date', context => intl(context, { dateStyle: 'long' })),
  clock('date', context => intl(context, { dateStyle: 'full' })),

  clock('time', ({ now }) => formatTime(now)),
  clock('time', ({ now }) => formatTime(now, true), { aliases: ['timesec', 'hms'] }),
  clock('time', context => intl(context, { hour: 'numeric', minute: '2-digit', hour12: true })),

  clock('now', ({ now }) => `${formatDate(now)} ${formatTime(now)}`, { aliases: ['datetime'] }),
  clock('now', ({ now }) => `${formatDate(now)} ${formatTime(now, true)}`, { aliases: ['datetimesec'] }),
  clock('now', ({ now }) => `${formatDate(now)}T${formatTime(now, true)}${utcOffset(now)}`, { aliases: ['iso'] }),
  clock('now', context => intl(context, { dateStyle: 'long', timeStyle: 'short' })),

  clock('year', ({ now }) => String(now.getFullYear())),
  clock('year', context => intl(context, { year: 'numeric' })),
  clock('month', ({ now }) => `${now.getFullYear()}-${pad(now.getMonth() + 1)}`),
  clock('month', ({ now }) => pad(now.getMonth() + 1)),
  clock('month', context => intl(context, { month: 'long' })),
  clock('month', context => intl(context, { year: 'numeric', month: 'long' })),
  clock('day', ({ now }) => pad(now.getDate())),
  clock('day', context => intl(context, { day: 'numeric' })),
  clock('day', context => intl(context, { month: 'long', day: 'numeric' })),
  clock('week', ({ now }) => { const { year, week } = isoWeek(now); return `${year}-W${pad(week)}`; }),
  clock('week', ({ now }) => `W${pad(isoWeek(now).week)}`),
  clock('week', context => intl(context, { weekday: 'long' }), { aliases: ['weekday'] }),
  clock('week', context => intl(context, { weekday: 'short' })),

  clock('timestamp', ({ now }) => String(Math.floor(now.getTime() / 1000)), { aliases: ['unix', 'epoch'] }),
  clock('timestamp', ({ now }) => String(now.getTime()), { aliases: ['ms'] }),

  // Random, so not previewed.
  { trigger: 'uuid', description: 'snippet.uuid', expand: ({ randomUUID }) => randomUUID(), aliases: ['guid'] },
  { trigger: 'uuid', description: 'snippet.uuidUpper', expand: ({ randomUUID }) => randomUUID().toUpperCase() },
  { trigger: 'uuid', description: 'snippet.uuidCompact', expand: ({ randomUUID }) => randomUUID().replaceAll('-', '') },

  lookedUp('ip', 'snippet.ip', 'snippet.hintPublic', lookup('https://api64.ipify.org'), 5 * MINUTE),
  lookedUp('ip', 'snippet.ipv4', 'snippet.hintIPv4', lookup('https://api.ipify.org'), 5 * MINUTE, { aliases: ['ipv4'] }),
  lookedUp('ip', 'snippet.ipv6', 'snippet.hintIPv6', lookup('https://api6.ipify.org'), 5 * MINUTE, { aliases: ['ipv6'] }),
  lookedUp('ip', 'snippet.localIP', 'snippet.hintLAN', native('local-ip'), MINUTE, { aliases: ['localip', 'lan'] }),
  lookedUp('mac', 'snippet.mac', null, native('mac'), MINUTE, { aliases: ['ether'] }),
  lookedUp('host', 'snippet.hostname', 'snippet.hintHost', native('hostname'), MINUTE, { aliases: ['hostname'] }),
  lookedUp('host', 'snippet.computerName', 'snippet.hintComputer', native('computer-name'), MINUTE, { aliases: ['computer', 'computername'] }),
  lookedUp('host', 'snippet.whoami', 'snippet.hintUser', native('whoami'), MINUTE, { aliases: ['whoami', 'user', 'username'] }),
];

const sources = [];
export function addSnippetSource(source) {
  sources.push(source);
  return () => { const at = sources.indexOf(source); if (at >= 0) sources.splice(at, 1); };
}

// Every row, later sources first, so their rows lead their groups. Each row
// gets a stable id (trigger#position) for caching previews. Rows in `except`
// are skipped.
// Sources return the same array until their rows change, so the combined
// list is reused while none of them changed and nothing is excluded.
let cachedParts = null, cachedRows = null;
export function allSnippets(except = new Set()) {
  const parts = [...sources].reverse().map(source => source());
  const reusable = !except.size && cachedParts && parts.length === cachedParts.length && parts.every((part, i) => part === cachedParts[i]);
  if (reusable) return cachedRows;
  const rows = [...parts.flat(), ...builtinSnippets].filter(row => !except.has(row));
  const counts = new Map();
  const result = rows.map(row => {
    const position = counts.get(row.trigger) || 0; counts.set(row.trigger, position + 1);
    return { ...row, id: row.id ?? `${row.trigger}#${position}` };
  });
  if (!except.size) { cachedParts = parts; cachedRows = result; }
  return result;
}

// Letters of `query` appear in `word` in order, starting with its first
// letter: "wk" fits "week", but "ip" does not fit "timestamp".
export function fuzzy(query, word) {
  if (word[0] !== query[0]) return false;
  let at = 0; for (const letter of word) if (letter === query[at]) at++;
  return at === query.length;
}

// What the list shows for the text typed after "@":
//   nothing           the first row of each trigger, as an overview
//   a whole alias     that row
//   anything else     every row of each matching trigger, triggers that start
//                     with it before those that fuzzily fit it; then rows whose
//                     alias starts with it, then rows whose alias fits it
// Returns [{row, alias?}] in definition order within each step; `alias` is
// the alias that matched.
// Math rows are left out unless the caller passes them (see snippet-completion.js).
export function matchSnippets(prefix, rows = allSnippets().filter(row => !row.math)) {
  const query = prefix.toLowerCase();
  if (!query) {
    const seen = new Set();
    return rows.filter(row => !seen.has(row.trigger) && seen.add(row.trigger)).map(row => ({ row }));
  }
  if (!rows.some(row => row.trigger === query)) {
    const exact = rows.find(row => row.aliases?.includes(query));
    if (exact) return [{ row: exact, alias: query }];
  }
  const starts = rows.filter(row => row.trigger.startsWith(query));
  const fits = rows.filter(row => !row.trigger.startsWith(query) && fuzzy(query, row.trigger));
  // Aliases of rows not already listed with their group, each alias once.
  const groups = new Set([...starts, ...fits].map(row => row.trigger)), aliases = new Set();
  const aliasMatches = test => rows.flatMap(row => {
    if (groups.has(row.trigger)) return [];
    const alias = row.aliases?.find(name => !aliases.has(name) && test(name));
    if (!alias) return [];
    aliases.add(alias); return [{ row, alias }];
  });
  const aliasStarts = aliasMatches(name => name.startsWith(query));
  const aliasFits = aliasMatches(name => fuzzy(query, name));
  return [...starts.map(row => ({ row })), ...fits.map(row => ({ row })), ...aliasStarts, ...aliasFits];
}

export const snippetContext = (overrides = {}) => ({
  now: new Date(),
  locale: 'en',
  fetch: (...args) => globalThis.fetch(...args),
  native: () => Promise.reject(new Error('Only available in the app')),
  randomUUID: () => crypto.randomUUID(),
  rates: () => Promise.reject(new Error('Only available in the app')),
  ...overrides,
});

// The row a template placeholder names:
//   {date}     the default (first) row of a trigger
//   {date#2}   the second row of that group
//   {ipv4}     the row with that alias
export function placeholderRow(name, rows = allSnippets()) {
  const [, trigger, position] = /^([a-z][\w-]*)(?:#(\d+))?$/.exec(name) || [];
  if (!trigger) return null;
  const group = rows.filter(row => row.trigger === trigger);
  if (position) return group[Number(position) - 1] ?? null;
  return group[0] ?? rows.find(row => row.aliases?.includes(trigger)) ?? null;
}

// Templates let data define snippets: "Meeting {date} {time}" inserts the
// rows named in braces (see placeholderRow). Unknown names stay as written;
// "{{" is a literal brace. Async rows are awaited. "{cursor}" is a caret stop
// and "{cursor:name}" one that starts with "name" selected (see field()).
export async function expandTemplate(template, context = snippetContext(), rows = allSnippets()) {
  const parts = template.split(/(\{\{|\{cursor(?::[^{}]*)?\}|\{[a-z][\w-]*(?:#\d+)?\})/);
  const values = await Promise.all(parts.map(part => {
    if (part === '{{') return '{';
    const stop = /^\{cursor(?::([^{}]*))?\}$/.exec(part);
    if (stop) return field(stop[1] ?? '');
    const row = part.startsWith('{') && part.endsWith('}') ? placeholderRow(part.slice(1, -1), rows) : null;
    return row ? row.expand(context) : part;
  }));
  return values.join('');
}

// Every built-in row as a placeholder, for the Settings menu: grouped by
// trigger, with the shortest way to name it and an example value.
// The caret stop comes first, without a trigger, so it is listed on its own.
export function placeholderCatalog(context = snippetContext()) {
  const positions = new Map();
  return [{ trigger: null, token: 'cursor', example: null, description: 'snippet.cursor' }, ...builtinSnippets.map(row => {
    const position = (positions.get(row.trigger) || 0) + 1; positions.set(row.trigger, position);
    const token = position === 1 ? row.trigger : row.aliases?.[0] ?? `${row.trigger}#${position}`;
    let example = null;
    if (row.live) { try { example = row.preview(context); } catch {} }
    return { trigger: row.trigger, token, example, description: row.description ?? null };
  })];
}

// A row built from a template, the shape user-defined snippets take. While it
// expands, it and the rows expanding it are hidden, so "{date}" in a user's
// own date row means the next date row, and rows that refer to each other
// stop instead of looping.
export function templateSnippet(trigger, template, extra = {}) {
  const row = {
    trigger, ...extra,
    expand: context => {
      const expanding = new Set([...(context.expanding || []), row]);
      return expandTemplate(template, { ...context, expanding }, allSnippets(expanding));
    },
  };
  return row;
}
