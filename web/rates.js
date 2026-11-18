// Exchange rates from Frankfurter (European Central Bank reference rates).
// Fetched at most once an hour and shared by math results and @cur snippets.
const SOURCE = 'https://api.frankfurter.dev/v1/latest', HOUR = 3_600_000, RETRY = 100_000;
// The currencies Frankfurter offered on 2026-11-19, used until the first answer arrives.
export const fallbackCurrencies = ['AUD','BRL','CAD','CHF','CNY','CZK','DKK','EUR','GBP','HKD','HUF','IDR','ILS','INR','ISK','JPY','KRW','MXN','MYR','NOK','NZD','PHP','PLN','RON','SEK','SGD','THB','TRY','USD','ZAR'];

let rates = null, codes = fallbackCurrencies, requestedAt = 0, request = null, listener = () => {};
export const currentRates = () => rates;
// Sorted codes; the same array until the rates change, so callers can cache on it.
export const currencyCodes = () => codes;
export function setRateListener(fn) { listener = fn; }

// Resolves to the latest rates, or null when none have arrived yet. A failed
// request is asked again after about 100 seconds.
export function refreshRates(fetchImpl = (...args) => globalThis.fetch(...args)) {
  if (request && Date.now() - requestedAt < HOUR) return request;
  requestedAt = Date.now();
  request = (async () => {
    try {
      const response = await fetchImpl(SOURCE, { referrerPolicy: 'no-referrer' });
      if (!response.ok) throw new Error('exchange rates unavailable');
      const data = await response.json();
      if (!data.date || !data.rates || typeof data.rates.USD !== 'number') throw new Error('invalid rates');
      rates = { date: data.date, values: { EUR: 1, ...data.rates } };
      codes = Object.keys(rates.values).sort();
    } catch (_) { requestedAt = Date.now() - HOUR + RETRY; }
    listener();
    return rates;
  })();
  return request;
}
export const loadRates = () => refreshRates().then(value => value ?? Promise.reject(new Error('Exchange rates unavailable')));
