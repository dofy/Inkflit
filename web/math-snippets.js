// Snippets for math blocks: @fn (functions), @unit (units) and @cur
// (currencies). Every row has `math: true`, so the list offers it only
// inside a math block. Each name is also an alias, so "@km" or "@usd" finds
// its row directly.
import { builtinSnippets, field } from './snippets.js';

const MINUTE = 60_000;
// Aliases the built-in rows already use ("ms" is a timestamp format), so a
// math row never takes them over.
const reserved = new Set(builtinSnippets.flatMap(row => row.aliases || []));
const aliasOf = name => name.toLowerCase().replace(/[^a-z0-9]/g, '');
function claimAliases(names, taken) {
  const aliases = [];
  for (const name of names.map(aliasOf)) {
    if (name.length < 2 || reserved.has(name) || taken.has(name)) continue;
    taken.add(name); aliases.push(name);
  }
  return aliases;
}

// [name, arguments shown in the preview]. The caret lands between the brackets.
const FUNCTIONS = [['sqrt','x'],['abs','x'],['round','x'],['floor','x'],['ceil','x'],['sin','x'],['cos','x'],['tan','x'],['log','x'],['log10','x'],['exp','x'],['min','a, b'],['max','a, b']];

// Category → [inserted name, other names that find it]. Every name must
// parse in features.js; a test checks.
const UNITS = {
  length: [['m','meter'],['km','kilometer'],['cm','centimeter'],['mm','millimeter'],['um','micrometer'],['nm','nanometer'],['in','inch'],['ft','foot','feet'],['yd','yard'],['mi','mile'],['nmi','nauticalmile'],['mil'],['angstrom']],
  area: [['m2','squaremeter'],['km2'],['cm2'],['sqin'],['sqft'],['sqyd'],['sqmi'],['acre'],['hectare']],
  volume: [['L','liter','litre'],['mL','milliliter'],['m3','cubicmeter'],['cc'],['cuin'],['cuft'],['teaspoon'],['tablespoon'],['cup'],['floz','fluidounce'],['pint'],['quart'],['gallon'],['oilbarrel','barrel']],
  mass: [['mg','milligram'],['g','gram'],['kg','kilogram'],['t','tonne'],['ton'],['oz','ounce'],['lb','pound'],['stone'],['grain']],
  time: [['ms','millisecond'],['s','second'],['min','minute'],['h','hour'],['day'],['week'],['month'],['year']],
  speed: [['m/s','mps'],['km/h','kph'],['mph']],
  temperature: [['degC','celsius'],['degF','fahrenheit'],['K','kelvin']],
  angle: [['deg','degree'],['rad','radian'],['grad'],['arcmin'],['arcsec']],
  force: [['N','newton'],['kN'],['kgf'],['lbf']],
  energy: [['J','joule'],['kJ'],['Wh'],['kWh'],['BTU'],['eV']],
  power: [['W','watt'],['kW','kilowatt'],['hp','horsepower']],
  pressure: [['Pa','pascal'],['kPa'],['MPa'],['bar'],['atm'],['psi'],['mmHg']],
  electric: [['A','ampere'],['mA'],['V','volt'],['kV'],['ohm'],['C','coulomb'],['Ah'],['mAh'],['F','farad'],['H','henry'],['S','siemens'],['Wb','weber'],['T','tesla']],
  data: [['b','bit'],['B','byte'],['kB','kilobyte'],['MB','megabyte'],['GB','gigabyte'],['TB','terabyte'],['KiB'],['MiB'],['GiB'],['TiB']],
  frequency: [['Hz','hertz'],['kHz'],['MHz'],['GHz']],
  other: [['mol','mole'],['cd','candela']],
};
export const unitNames = Object.values(UNITS).flat().map(([name]) => name);

const taken = new Set();
export const functionSnippets = FUNCTIONS.map(([name, args]) => ({
  trigger: 'fn', math: true, aliases: claimAliases([name], taken), hint: `snippet.fn.${name}`,
  expand: () => `${name}(${field()})`, preview: () => `${name}(${args})`,
}));
export const unitSnippets = Object.entries(UNITS).flatMap(([category, units]) => units.map(names => ({
  trigger: 'unit', math: true, aliases: claimAliases(names, taken), hint: `snippet.unit.${category}`,
  expand: () => names[0], preview: () => names[0],
})));
const currencyTaken = new Set(taken);

// The rate shown beside each currency is against the app language's own
// currency; zh-Hant uses HKD because Frankfurter has no TWD.
const HOME = { en: 'USD', 'zh-Hans': 'CNY', 'zh-Hant': 'HKD', ja: 'JPY' };
const formatRate = n => Number(n.toPrecision(4)).toLocaleString('en-US', { maximumFractionDigits: 8 });
export async function currencyPreview(code, { locale, rates }) {
  let name = code;
  try { name = new Intl.DisplayNames([locale], { type: 'currency' }).of(code) || code; } catch {}
  try {
    const { values } = await rates();
    let home = HOME[locale] || 'USD';
    if (home === code) home = code === 'USD' ? 'EUR' : 'USD';
    if (values[code] && values[home]) return `${code} · ${name} · 1 = ${formatRate(values[home] / values[code])} ${home}`;
  } catch {}
  // Without rates the name is still worth showing.
  return `${code} · ${name}`;
}
// Rows for the given codes; the same array for the same codes.
let cachedCodes = null, cachedRows = [];
export function currencySnippets(codes) {
  if (codes === cachedCodes) return cachedRows;
  const claimed = new Set(currencyTaken);
  cachedCodes = codes;
  cachedRows = codes.map(code => ({
    trigger: 'cur', math: true, aliases: claimAliases([code], claimed), description: 'snippet.currency',
    expand: () => code, preview: context => currencyPreview(code, context), previewTTL: 10 * MINUTE,
  }));
  return cachedRows;
}
