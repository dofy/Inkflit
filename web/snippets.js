// Snippets: typing @name offers a value to insert in its place.
//
// A snippet is {name, description?, aliases?, expand(context), preview?(context), live?}:
//   name         lowercase word typed after "@"
//   description  i18n key shown when there is no preview
//   aliases      other names that find it
//   expand       returns the text to insert, or a Promise of it, for values
//                that need I/O (an IP lookup, for example)
//   preview      value shown in the list, or a Promise of it; leave it out
//                when the value is random (uuid)
//   live         the preview changes with time and is refreshed while shown
//   previewTTL   milliseconds an async preview is reused before asking again
//
// The context carries everything a snippet may use, so this module has no
// side effects and tests can replace any of it:
//   now          Date
//   fetch        window.fetch, for public lookups
//   native       (action) => Promise, for values only the app can read
//   randomUUID   () => string
//
// Snippets come from sources, so built-ins and later user-defined snippets
// share one list. A source is a function returning snippets; register one
// with addSnippetSource(). The editor integration is in snippet-completion.js.

const pad = value => String(value).padStart(2, '0');
export const formatDate = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
export const formatTime = (date, seconds = false) => `${pad(date.getHours())}:${pad(date.getMinutes())}${seconds ? `:${pad(date.getSeconds())}` : ''}`;

// Clock snippets preview the value they will insert and refresh it while the
// list is open.
const clock = (name, description, value, aliases = []) => ({ name, description, aliases, expand: value, preview: value, live: true });

// Public addresses come from ipify, only when a snippet is inserted.
const lookup = url => async ({ fetch }) => {
  const response = await fetch(url, { referrerPolicy: 'no-referrer', cache: 'no-store', signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = (await response.text()).trim();
  if (!/^[0-9a-f.:]+$/i.test(text)) throw new Error('Unexpected response');
  return text;
};

// A value read through the network or the app: previewed too, but reused for
// a while so typing does not repeat the request.
const lookedUp = (name, description, expand, previewTTL, aliases = []) => ({ name, description, aliases, expand, preview: expand, previewTTL });
const native = action => ({ native }) => native(action);
const MINUTE = 60_000;

export const builtinSnippets = [
  clock('date', 'snippet.date', ({ now }) => formatDate(now)),
  clock('time', 'snippet.time', ({ now }) => formatTime(now)),
  clock('timesec', 'snippet.timeSeconds', ({ now }) => formatTime(now, true), ['seconds', 'hms']),
  clock('datetime', 'snippet.datetime', ({ now }) => `${formatDate(now)} ${formatTime(now)}`, ['now']),
  clock('datetimesec', 'snippet.datetimeSeconds', ({ now }) => `${formatDate(now)} ${formatTime(now, true)}`),
  clock('timestamp', 'snippet.timestamp', ({ now }) => String(Math.floor(now.getTime() / 1000)), ['unix', 'epoch']),
  { name: 'uuid', description: 'snippet.uuid', aliases: ['guid'], expand: ({ randomUUID }) => randomUUID() },
  lookedUp('ip', 'snippet.ip', lookup('https://api64.ipify.org'), 5 * MINUTE),
  lookedUp('ipv4', 'snippet.ipv4', lookup('https://api.ipify.org'), 5 * MINUTE),
  lookedUp('ipv6', 'snippet.ipv6', lookup('https://api6.ipify.org'), 5 * MINUTE),
  lookedUp('localip', 'snippet.localIP', native('local-ip'), MINUTE, ['lan']),
  lookedUp('mac', 'snippet.mac', native('mac'), MINUTE, ['ether']),
  lookedUp('hostname', 'snippet.hostname', native('hostname'), MINUTE, ['host']),
  lookedUp('computer', 'snippet.computerName', native('computer-name'), MINUTE, ['computername', 'machine']),
  lookedUp('whoami', 'snippet.whoami', native('whoami'), MINUTE, ['user', 'username']),
];

const sources = [() => builtinSnippets];
export function addSnippetSource(source) {
  sources.push(source);
  return () => { const at = sources.indexOf(source); if (at >= 0) sources.splice(at, 1); };
}

// Later sources win on a name clash, so a user snippet can replace a built-in.
// Snippets in `except` are skipped, so a name falls back to what they replaced.
export function allSnippets(except = new Set()) {
  const byName = new Map();
  for (const source of sources) for (const snippet of source()) if (!except.has(snippet)) byName.set(snippet.name, snippet);
  return [...byName.values()];
}

// Snippets whose name or an alias starts with `prefix`: exact names first,
// then name matches, then alias matches, each in definition order.
export function matchSnippets(prefix, snippets = allSnippets()) {
  const query = prefix.toLowerCase();
  const rank = snippet => snippet.name === query ? 0 : snippet.name.startsWith(query) ? 1 : 2;
  return snippets
    .filter(snippet => [snippet.name, ...(snippet.aliases || [])].some(name => name.startsWith(query)))
    .map((snippet, order) => ({ snippet, order }))
    .sort((a, b) => rank(a.snippet) - rank(b.snippet) || a.order - b.order)
    .map(({ snippet }) => snippet);
}

export const snippetContext = (overrides = {}) => ({
  now: new Date(),
  fetch: (...args) => globalThis.fetch(...args),
  native: () => Promise.reject(new Error('Only available in the app')),
  randomUUID: () => crypto.randomUUID(),
  ...overrides,
});

// Templates let data define snippets: "Meeting {date} {time}" expands the
// named snippets inside braces. Unknown names stay as written; "{{" is a
// literal brace. Nested async snippets are awaited.
export async function expandTemplate(template, context = snippetContext(), snippets = allSnippets()) {
  const byName = new Map(snippets.map(snippet => [snippet.name, snippet]));
  const parts = template.split(/(\{\{|\{[a-z][\w-]*\})/);
  const values = await Promise.all(parts.map(part => {
    if (part === '{{') return '{';
    const snippet = /^\{[a-z][\w-]*\}$/.test(part) && byName.get(part.slice(1, -1));
    return snippet ? snippet.expand(context) : part;
  }));
  return values.join('');
}

// A snippet built from a template, the shape user-defined snippets will take.
// While it expands, it and the templates expanding it are hidden, so
// "{date}" in a template named date means the built-in date, and templates
// that refer to each other stop instead of looping.
export function templateSnippet(name, template, extra = {}) {
  const snippet = {
    name, ...extra,
    expand: context => {
      const expanding = new Set([...(context.expanding || []), snippet]);
      return expandTemplate(template, { ...context, expanding }, allSnippets(expanding));
    },
  };
  return snippet;
}
