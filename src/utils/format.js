// ── Active company currency ───────────────────────────────────────────────────
// Set once from the logged-in company (see AuthContext) so every formatter in
// the app renders that tenant's symbol/locale — no per-component threading.
// Falls back to AED/en-AE (the original hardcoded behaviour) until it is set,
// which only matters for the brief moment before the session is restored.
let _activeCurrency = { code: 'AED', symbol: 'AED ', locale: 'en-AE' };

export const setActiveCurrency = (currency) => {
    _activeCurrency = {
        code: (currency && currency.code) || 'AED',
        symbol: (currency && currency.symbol) || 'AED ',
        locale: (currency && currency.locale) || 'en-AE',
    };
};

export const getActiveCurrency = () => _activeCurrency;

// Current currency code, e.g. for export column headers: `Amount (${curCode()})`.
export const curCode = () => _activeCurrency.code;

export const fmtN = (n, locale = _activeCurrency.locale) =>
    Number(n || 0).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Amount with the active company's symbol, e.g. "₹1,234.00" or "AED 1,234.00".
export const fmt = (n) => `${_activeCurrency.symbol}${fmtN(n, _activeCurrency.locale)}`;

// Bare number in the active locale, no symbol. Use for export cells whose
// column header already carries the currency (replaces the old
// `.replace('AED ', '')` string-stripping, which broke once the symbol varied).
export const fmtNum = (n) => fmtN(n, _activeCurrency.locale);

// Legacy names — kept so existing call sites keep working, now currency-aware.
// Both resolve to the active company currency rather than a hardcoded AED/DHS.
export const fmtDHS = (n) => fmt(n);
export const fmtAED = (n) => fmt(n);

// Platform billing is in Indian Rupees (developer panel — your revenue from
// tenants), independent of each company's own display currency. Always ₹.
export const fmtINR = (n) => `₹${fmtN(n, 'en-IN')}`;

/**
 * Format a number using an EXPLICIT currency object (not the active one).
 * Useful when rendering a company other than the logged-in tenant (e.g. the
 * developer panel listing many companies).
 * @param {Object|null} currency  – { code, symbol, locale }
 * @param {number}      n
 */
export const fmtCurrency = (currency, n) => {
    const sym = (currency && currency.symbol) || '₹';
    const locale = (currency && currency.locale) || 'en-IN';
    return `${sym}${fmtN(n, locale)}`;
};

/**
 * Returns a formatter bound to a specific currency object.
 * Usage:  const f = currencyFormatter(company.currency);  f(1234.5)
 */
export const currencyFormatter = (currency) => (n) => fmtCurrency(currency, n);

export const formatDate = (d) => {
    if (!d) return '';
    const date = new Date(d);
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};
export const todayStr = () => new Date().toISOString().slice(0, 10);

// ── World country dial codes ─────────────────────────────────────────────────
// Complete list — kept in sync with server/src/models/Lead.js DIAL map
// and server/src/utils/phone.js DIAL_CODES.
// Users can still type any country not listed using the "Other" option in
// CountrySelect — their custom entry is remembered in localStorage and
// shown in the dropdown for that browser only.
export const COUNTRY_CODES = {
    // Gulf / Middle East
    UAE: '971', 'Saudi Arabia': '966', Kuwait: '965', Qatar: '974', Bahrain: '973',
    Oman: '968', Iran: '98', Iraq: '964', Syria: '963', Yemen: '967', Lebanon: '961',
    Jordan: '962', Palestine: '970', Israel: '972', Turkey: '90',
    // Central Asia
    Georgia: '995', Armenia: '374', Azerbaijan: '994', Kazakhstan: '7',
    Uzbekistan: '998', Turkmenistan: '993', Tajikistan: '992', Kyrgyzstan: '996',
    Afghanistan: '93', Pakistan: '92',
    // South Asia
    India: '91', 'Sri Lanka': '94', Bangladesh: '880', Nepal: '977',
    Bhutan: '975', Maldives: '960',
    // Southeast Asia
    Indonesia: '62', Malaysia: '60', Philippines: '63', Thailand: '66',
    Vietnam: '84', Singapore: '65', Myanmar: '95', Cambodia: '855',
    Laos: '856', Brunei: '673',
    // East Asia
    China: '86', Japan: '81', 'South Korea': '82', Mongolia: '976',
    Taiwan: '886', 'Hong Kong': '852', Macau: '853',
    // Europe
    'United Kingdom': '44', Germany: '49', France: '33', Italy: '39',
    Spain: '34', Portugal: '351', Netherlands: '31', Belgium: '32',
    Switzerland: '41', Austria: '43', Sweden: '46', Norway: '47',
    Denmark: '45', Finland: '358', Ireland: '353', Greece: '30',
    Poland: '48', 'Czech Republic': '420', Slovakia: '421', Hungary: '36',
    Romania: '40', Bulgaria: '359', Croatia: '385', Serbia: '381',
    Slovenia: '386', Albania: '355', Ukraine: '380', Belarus: '375',
    Moldova: '373', Russia: '7', Estonia: '372', Latvia: '371',
    Lithuania: '370', Luxembourg: '352', Iceland: '354', Malta: '356', Cyprus: '357',
    // Americas
    USA: '1', Canada: '1', Mexico: '52', Brazil: '55', Argentina: '54',
    Colombia: '57', Chile: '56', Peru: '51', Venezuela: '58', Ecuador: '593',
    Bolivia: '591', Paraguay: '595', Uruguay: '598', Guyana: '592',
    Suriname: '597', Panama: '507', 'Costa Rica': '506', Guatemala: '502',
    Honduras: '504', 'El Salvador': '503', Nicaragua: '505', Cuba: '53', Haiti: '509',
    // Africa
    Egypt: '20', Sudan: '249', 'South Sudan': '211', Libya: '218', Algeria: '213',
    Morocco: '212', Tunisia: '216', Angola: '244', Benin: '229', Botswana: '267',
    'Burkina Faso': '226', Burundi: '257', Cameroon: '237', 'Cape Verde': '238',
    'Central African Republic': '236', Chad: '235', Comoros: '269',
    'Congo (Republic)': '242', 'Congo (DRC)': '243', Djibouti: '253',
    'Equatorial Guinea': '240', Eritrea: '291', Eswatini: '268', Ethiopia: '251',
    Gabon: '241', Gambia: '220', Ghana: '233', Guinea: '224', 'Guinea-Bissau': '245',
    'Ivory Coast': '225', Kenya: '254', Lesotho: '266', Liberia: '231',
    Madagascar: '261', Malawi: '265', Mali: '223', Mauritania: '222', Mauritius: '230',
    Mayotte: '262', Mozambique: '258', Namibia: '264', Niger: '227', Nigeria: '234',
    Rwanda: '250', 'Sao Tome and Principe': '239', Senegal: '221', Seychelles: '248',
    'Sierra Leone': '232', Somalia: '252', 'South Africa': '27', Tanzania: '255',
    Togo: '228', Uganda: '256', Zambia: '260', Zimbabwe: '263',
    // Oceania
    Australia: '61', 'New Zealand': '64', Fiji: '679', 'Papua New Guinea': '675',
    // Fallback — user types a country not listed above via CountrySelect
    Other: '',
};
// ── Custom countries (user-added, remembered in the browser) ──────────────────
// Users can add a country + dial code from the CountrySelect picker. We persist
// them in localStorage and merge them on top of the built-in COUNTRY_CODES, so
// once added a country stays in the list (with its +code) and works for phone
// formatting everywhere — no need to re-add it each time.
const CUSTOM_COUNTRIES_KEY = 'skyup.customCountries.v1';

const readCustomCountries = () => {
    try {
        if (typeof localStorage === 'undefined') return {};
        const raw = localStorage.getItem(CUSTOM_COUNTRIES_KEY);
        if (!raw) return {};
        const obj = JSON.parse(raw);
        return obj && typeof obj === 'object' ? obj : {};
    } catch (e) {
        return {};
    }
};

// Built-ins first, custom entries extend/override. Rebuilt whenever a country
// is added/removed so all lookups below see it immediately.
let CUSTOM_COUNTRIES = readCustomCountries();
let EFFECTIVE_CODES = { ...COUNTRY_CODES, ...CUSTOM_COUNTRIES };

const persistCustom = () => {
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(CUSTOM_COUNTRIES_KEY, JSON.stringify(CUSTOM_COUNTRIES));
        }
    } catch (e) { /* ignore quota / availability errors */ }
};

// Merged dial-code map + name list (built-in + custom). Prefer these over the
// raw COUNTRY_CODES so custom countries always resolve.
export const getCountryCodes = () => EFFECTIVE_CODES;
export const getCountryNames = () => Object.keys(EFFECTIVE_CODES);
export const isCustomCountry = (name) => Object.prototype.hasOwnProperty.call(CUSTOM_COUNTRIES, name);

// Add (or update) a custom country + dial code. Persists and updates the live
// map. Returns the sanitized country name, or '' if the input was invalid.
export const addCustomCountry = (name, code) => {
    const cleanName = String(name || '').trim();
    const cleanCode = String(code || '').replace(/\D/g, '');
    if (!cleanName || !cleanCode) return '';
    CUSTOM_COUNTRIES = { ...CUSTOM_COUNTRIES, [cleanName]: cleanCode };
    EFFECTIVE_CODES = { ...COUNTRY_CODES, ...CUSTOM_COUNTRIES };
    persistCustom();
    return cleanName;
};

export const removeCustomCountry = (name) => {
    if (!isCustomCountry(name)) return;
    const next = { ...CUSTOM_COUNTRIES };
    delete next[name];
    CUSTOM_COUNTRIES = next;
    EFFECTIVE_CODES = { ...COUNTRY_CODES, ...CUSTOM_COUNTRIES };
    persistCustom();
};

// Full country name list = built-in + any custom ones (loaded at startup).
export const COUNTRIES = Object.keys(EFFECTIVE_CODES);

export const cleanPhone = (num, country) => {
    if (!num) return '';
    let p = String(num).replace(/[^0-9]/g, '');
    if (p.startsWith('0')) p = p.slice(1);
    const code = EFFECTIVE_CODES[country] || '971';
    if (!p.startsWith(code)) p = code + p;
    return p;
};

// ── Phone-aware free-text search ─────────────────────────────────────────────
// A plain `mobile.includes(searchText)` breaks the moment either side has a
// country code, a leading trunk zero, or different punctuation (+, spaces,
// dashes) than the other — e.g. typing "+971 554252850" would never match a
// stored "0554252850". These mirror the server's phoneSearchCandidates
// (server/src/utils/phone.js) so every search box behaves consistently.
//
// phoneSearchDigits(raw) reduces free-typed text to every plausible digit
// variant: as typed, with a leading "00"/"0" stripped, and with any known
// country dial code stripped — repeated until nothing new turns up, so
// combinations (e.g. "00" + a country code together) reduce fully too.
export function phoneSearchDigits(raw) {
    const digits = String(raw || '').replace(/\D/g, '');
    if (!digits) return [];
    const variants = new Set([digits]);
    let grew = true;
    while (grew) {
        grew = false;
        for (const v of [...variants]) {
            const candidates = [];
            if (v.startsWith('00')) candidates.push(v.slice(2));
            if (v.startsWith('0')) candidates.push(v.slice(1));
            Object.values(EFFECTIVE_CODES).forEach((code) => {
                if (code && v.startsWith(code) && v.length > code.length) candidates.push(v.slice(code.length));
            });
            for (const c of candidates) {
                if (c && !variants.has(c)) { variants.add(c); grew = true; }
            }
        }
    }
    return [...variants];
}

// True if `mobile` (a stored number, possibly with punctuation and/or a
// country code) matches free-typed `rawSearch` — regardless of which side
// has the country code, the leading zero, or how it's punctuated.
//
// NOTE: This function is for country-code-aware matching of full numbers
// (>= 7 digits). For partial number searches (< 7 digits), the caller
// should use a plain raw mobile text match (mobile.includes(search)) which
// is faster and already handles partial searches correctly.
//
// Returns false when search has < 7 digits — partial searches are handled
// by the raw mobile text match in the filter (name/email/city/mobile).
export function phoneSearchMatches(mobile, rawSearch) {
    const searchDigits = String(rawSearch || '').replace(/\D/g, '');
    // For partial searches (< 7 digits), skip — raw mobile.includes() handles it.
    // This also prevents short stripped variants from causing false positives.
    if (searchDigits.length < 7) return false;
    const mobileDigits = String(mobile || '').replace(/\D/g, '');
    if (!mobileDigits) return false;
    const searchVariants = phoneSearchDigits(rawSearch);
    const mobileVariants = phoneSearchDigits(mobile);
    // sv must be >= 7 digits to avoid short stripped variants (e.g. stripping
    // country code 98 from '989364613911' gives '9364613911' — fine at 10 digits,
    // but further stripping must not produce < 7 digit fragments that match
    // as substrings of completely unrelated stored numbers).
    return searchVariants.some((sv) =>
        mobileVariants.some((mv) =>
            (sv.length >= 7 && mv.includes(sv)) ||
            (sv.length >= 7 && mv.length >= 7 && sv.includes(mv))
        )
    );
}

export const ORDER_STATUSES = ['Pending', 'Confirmed', 'Packed', 'Market Delay', 'Out for Delivery', 'Delivered', 'Cancelled'];
export const ALL_STATUSES = [...ORDER_STATUSES.slice(0, 1), 'Confirmed', 'Packed', 'Market Delay', 'Out for Delivery', 'Delivered', 'Invoiced', 'Cancelled'];
// Delivery stages selectable on an already-Invoiced order — its `status`
// stays 'Invoiced', but `deliveryStatus` can keep advancing (or reflect an
// earlier stage) so the tracker stays fully usable after the invoice is
// generated. Everything except 'Invoiced' and 'Cancelled'.
export const DELIVERY_STATUSES = ['Pending', 'Confirmed', 'Market Delay', 'Packed', 'Out for Delivery', 'Delivered'];

export const statusClass = (s) => ({
    Pending: 'bg-warn-light text-warn',
    Confirmed: 'bg-info-light text-info',
    Packed: 'bg-info-light text-info',
    'Market Delay': 'bg-warn-light text-warn',
    'Out for Delivery': 'bg-warn-light text-warn',
    Delivered: 'bg-ok-light text-ok',
    Invoiced: 'bg-purple-100 text-purple-700',
    Cancelled: 'bg-danger-light text-danger',
}[s] || 'bg-gray-100 text-gray-600');

// ── Lead helpers ──────────────────────────────────────────────────────────────
export const LEAD_STATUSES = ['New', 'Contacted', 'Interested', 'Follow-up', 'Won', 'Lost'];
export const LEAD_SOURCES = ['Walk-in', 'WhatsApp', 'Instagram', 'Facebook', 'Referral', 'market-in', 'Website', 'Call', 'Other'];
export const ALL_COUNTRY_NAMES = Object.keys(EFFECTIVE_CODES);
export const dialFor = (country) => EFFECTIVE_CODES[country] || '';

// Display helper: mobile with its country dial code, e.g. "+971 506731305".
// Strips a leading zero, avoids double-prefixing when the stored number
// already includes the code, and falls back to the raw value when the
// country's dial code is unknown.
export const fmtMobile = (num, country) => {
    if (!num) return '';
    let p = String(num).replace(/[^0-9]/g, '');
    if (!p) return String(num);
    if (p.startsWith('0')) p = p.slice(1);
    const code = EFFECTIVE_CODES[country] || '';
    if (!code) return String(num);
    if (p.startsWith(code)) return `+${code} ${p.slice(code.length)}`;
    return `+${code} ${p}`;
};

export const leadStatusClass = (s) => ({
    New: 'bg-info-light text-info',
    Contacted: 'bg-warn-light text-warn',
    Interested: 'bg-gold-light text-gold-700',
    'Follow-up': 'bg-purple-100 text-purple-700',
    Won: 'bg-ok-light text-ok',
    Lost: 'bg-danger-light text-danger',
}[s] || 'bg-gray-100 text-gray-600');


// Funnel order: Lead (initial) → Opportunity → Enquiry → Buyer
export const LEAD_STAGES = ['Lead', 'Opportunity', 'Enquiry', 'Buyer'];

export const leadStageOf = (l) => {
    if (l.converted || l.status === 'Won') return 'Buyer';
    if (l.status === 'Follow-up') return 'Enquiry';
    if (l.status === 'Interested' || l.status === 'Contacted') return 'Opportunity';
    return 'Lead'; // New / Lost / anything else
};

// leadStageClass accepts the stage string plus an optional lead object.
// When the lead was auto-reset by the monthly scheduler (monthlyReset: true),
// Opportunity badges render green instead of orange so the team can instantly
// identify freshly-reset leads. The green clears as soon as the salesperson
// manually changes the status.
export const leadStageClass = (s, lead) => {
    if (s === 'Opportunity' && lead && lead.monthlyReset) {
        return 'bg-ok-light text-ok'; // green — monthly auto-reset
    }
    return {
        Lead: 'bg-gray-100 text-gray-600',
        Opportunity: 'bg-warn-light text-warn',
        Enquiry: 'bg-info-light text-info',
        Buyer: 'bg-ok-light text-ok',
    }[s] || 'bg-gray-100 text-gray-600';
};

export const fmtDateTime = (d) => {
    if (!d) return '';
    return new Date(d).toLocaleString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
};

export const fmtTimeOnly = (d) => {
    if (!d) return '—';
    return new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
};

// ── Attendance helpers ────────────────────────────────────────────────────────
export const ATTENDANCE_STATUSES = ['present', 'absent', 'late', 'half_day', 'leave', 'holiday'];

export const attendanceStatusLabel = (s) => ({
    present: 'Present',
    absent: 'Absent',
    late: 'Late',
    half_day: 'Half-Day',
    leave: 'Leave',
    holiday: 'Holiday',
}[s] || s);

export const attendanceStatusClass = (s) => ({
    present: 'bg-ok-light text-ok',
    late: 'bg-warn-light text-warn',
    half_day: 'bg-info-light text-info',
    leave: 'bg-purple-100 text-purple-700',
    holiday: 'bg-gold-light text-gold-700',
    absent: 'bg-danger-light text-danger',
}[s] || 'bg-gray-100 text-gray-600');