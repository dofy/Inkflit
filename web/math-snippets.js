// Snippets for math blocks: @fn, @unit, @cur and @const. Each name is also an
// alias, so "@km", "@usd" and "@pi" find their rows directly.
import { builtinSnippets, field } from './snippets.js';
import { evaluateExpression } from './features.js';

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
const unitHint = keyword => `snippet.unit.${keyword}`;
export const unitCategories = Object.keys(UNITS).map(keyword => ({ keyword, hint: unitHint(keyword) }));

const taken = new Set();
export const functionSnippets = FUNCTIONS.map(([name, args]) => ({
  trigger: 'fn', math: true, aliases: claimAliases([name], taken), hint: `snippet.fn.${name}`,
  preferenceID: `item:fn:${name}`,
  expand: () => `${name}(${field()})`, preview: () => `${name}(${args})`,
}));
export const unitSnippets = Object.entries(UNITS).flatMap(([category, units]) => units.map(names => ({
  trigger: 'unit', math: true, aliases: claimAliases(names, taken), category: unitHint(category),
  preferenceID: `item:unit:${names[0]}`,
  unitSymbol: names[0], expand: () => names[0], preview: () => names[0],
})));

// Use the calculator's symbol spelling. PI, E and coulomb are alternate
// spellings of pi, e and coulombConstant, so each value appears only once.
const CONSTANTS = {
  math: ['pi', 'e', 'tau', 'phi', 'LN2', 'LN10', 'LOG2E', 'LOG10E', 'SQRT2', 'SQRT1_2'],
  science: [
    'speedOfLight', 'gravity', 'gravitationConstant', 'avogadro', 'planckConstant',
    'reducedPlanckConstant', 'boltzmann', 'gasConstant', 'elementaryCharge',
    'atomicMass', 'bohrMagneton', 'bohrRadius', 'classicalElectronRadius',
    'conductanceQuantum', 'coulombConstant', 'deuteronMass', 'efimovFactor',
    'electricConstant', 'electronMass', 'faraday', 'fermiCoupling', 'fineStructure',
    'firstRadiation', 'hartreeEnergy', 'inverseConductanceQuantum', 'klitzing',
    'loschmidt', 'magneticConstant', 'magneticFluxQuantum', 'molarMass',
    'molarMassC12', 'molarPlanckConstant', 'molarVolume', 'neutronMass',
    'nuclearMagneton', 'planckCharge', 'planckLength', 'planckMass',
    'planckTemperature', 'planckTime', 'protonMass', 'quantumOfCirculation',
    'rydberg', 'sackurTetrode', 'secondRadiation', 'stefanBoltzmann',
    'thomsonCrossSection', 'vacuumImpedance', 'weakMixingAngle', 'wienDisplacement',
  ],
};
// Keep the complete list in its original order for existing placeholders.
const suggestedScience = new Set([
  'speedOfLight', 'gravity', 'gravitationConstant', 'avogadro', 'planckConstant',
  'reducedPlanckConstant', 'boltzmann', 'gasConstant', 'elementaryCharge',
  'atomicMass', 'coulombConstant', 'electronMass', 'faraday', 'neutronMass', 'protonMass',
]);
const constantHint = keyword => `snippet.const.${keyword}`;
export const constantCategories = Object.keys(CONSTANTS).map(keyword => ({ keyword, hint: constantHint(keyword) }));
export const constantSnippets = Object.entries(CONSTANTS).flatMap(([category, names]) => names.map(name => {
  const keyword = name.toLowerCase();
  const alias = reserved.has(keyword) || taken.has(keyword) ? `const-${keyword}` : keyword;
  taken.add(alias);
  let value;
  const preview = () => value ??= evaluateExpression(name)?.text ?? name;
  return {
    trigger: 'const', math: true, aliases: [alias], category: constantHint(category),
    preferenceID: `item:const:${name}`,
    hidden: category === 'science' && !suggestedScience.has(name),
    expand: () => name, preview, placeholderPreview: () => `${name} · ${preview()}`,
  };
}));

const currencyTaken = new Set(taken);

// The rate shown beside each currency is against the app language's own
// currency; zh-Hant uses HKD because Frankfurter has no TWD.
const HOME = { en: 'USD', 'zh-Hans': 'CNY', 'zh-Hant': 'HKD', ja: 'JPY' };
const formatRate = n => Number(n.toPrecision(4)).toLocaleString('en-US', { maximumFractionDigits: 8 });
function currencyLabel(code, { locale }) {
  let name = code;
  try { name = new Intl.DisplayNames([locale], { type: 'currency' }).of(code) || code; } catch {}
  return name === code ? code : `${code} · ${name}`;
}

export async function currencyPreview(code, context) {
  const label = currencyLabel(code, context);
  try {
    const { values } = await context.rates();
    let home = HOME[context.locale] || 'USD';
    if (home === code) home = code === 'USD' ? 'EUR' : 'USD';
    if (values[code] && values[home]) return `${label} · 1 = ${formatRate(values[home] / values[code])} ${home}`;
  } catch {}
  // Without rates the name is still worth showing.
  return label;
}
// Rows for the given codes; the same array for the same codes.
let cachedCodes = null, cachedRows = [];
export function currencySnippets(codes) {
  if (codes === cachedCodes) return cachedRows;
  const claimed = new Set(currencyTaken);
  cachedCodes = codes;
  cachedRows = codes.map(code => ({
    trigger: 'cur', math: true, aliases: claimAliases([code], claimed), description: 'snippet.currency',
    preferenceID: `item:cur:${code}`,
    expand: () => code, preview: context => currencyPreview(code, context), previewTTL: 10 * MINUTE,
    placeholderPreview: context => currencyLabel(code, context),
  }));
  return cachedRows;
}
