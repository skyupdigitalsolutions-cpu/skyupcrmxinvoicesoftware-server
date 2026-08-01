// Mirrors the core of the client's built-in COUNTRY_CODES map (see
// client/src/utils/format.js) — enough to resolve a dial code for a lead's
// stored country so WhatsApp sends go out in full international format.
// NOTE: countries a user has added manually in the browser (custom-country
// registry) aren't known here since that list is browser-local; if a lead's
// mobile doesn't already look like it includes a country code, sending will
// fail with a clear error rather than silently guessing wrong.
// Complete world country dial codes — kept in sync with Lead.js DIAL map
// and client/src/utils/format.js COUNTRY_CODES so phone search and
// WhatsApp sending work correctly for customers from any country.
const DIAL_CODES = {
  UAE: '971', 'Saudi Arabia': '966', Kuwait: '965', Qatar: '974', Bahrain: '973',
  Oman: '968', Iran: '98', Iraq: '964', Syria: '963', Yemen: '967', Lebanon: '961',
  Jordan: '962', Palestine: '970', Israel: '972', Turkey: '90',
  Georgia: '995', Armenia: '374', Azerbaijan: '994', Kazakhstan: '7',
  Uzbekistan: '998', Turkmenistan: '993', Tajikistan: '992', Kyrgyzstan: '996',
  Afghanistan: '93', Pakistan: '92',
  India: '91', 'Sri Lanka': '94', Bangladesh: '880', Nepal: '977',
  Bhutan: '975', Maldives: '960',
  Indonesia: '62', Malaysia: '60', Philippines: '63', Thailand: '66',
  Vietnam: '84', Singapore: '65', Myanmar: '95', Cambodia: '855',
  Laos: '856', Brunei: '673',
  China: '86', Japan: '81', 'South Korea': '82', Mongolia: '976',
  Taiwan: '886', 'Hong Kong': '852', Macau: '853',
  'United Kingdom': '44', Germany: '49', France: '33', Italy: '39',
  Spain: '34', Portugal: '351', Netherlands: '31', Belgium: '32',
  Switzerland: '41', Austria: '43', Sweden: '46', Norway: '47',
  Denmark: '45', Finland: '358', Ireland: '353', Greece: '30',
  Poland: '48', 'Czech Republic': '420', Slovakia: '421', Hungary: '36',
  Romania: '40', Bulgaria: '359', Croatia: '385', Serbia: '381',
  Slovenia: '386', Albania: '355', Ukraine: '380', Belarus: '375',
  Moldova: '373', Russia: '7', Estonia: '372', Latvia: '371',
  Lithuania: '370', Luxembourg: '352', Iceland: '354', Malta: '356', Cyprus: '357',
  USA: '1', Canada: '1', Mexico: '52', Brazil: '55', Argentina: '54',
  Colombia: '57', Chile: '56', Peru: '51', Venezuela: '58', Ecuador: '593',
  Bolivia: '591', Paraguay: '595', Uruguay: '598', Guyana: '592',
  Suriname: '597', Panama: '507', 'Costa Rica': '506', Guatemala: '502',
  Honduras: '504', 'El Salvador': '503', Nicaragua: '505', Cuba: '53', Haiti: '509',
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
  Australia: '61', 'New Zealand': '64', Fiji: '679', 'Papua New Guinea': '675',
};

// Returns a full international number (digits only, no leading +) suitable
// for MSG91, or '' if it can't be confidently resolved. Mirrors Lead.js's
// normalizePhone exactly so this always matches the lead's stored mobileKey.
export function toE164(mobile, country) {
    let digits = String(mobile || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.startsWith('0')) digits = digits.slice(1); // strip leading zero
    // Already looks like it includes a country code (long enough).
    if (digits.length >= 11) return digits;
    const code = DIAL_CODES[country] || '';
    if (!code) return '';
    return `${code}${digits}`;
}

const escapeRx = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ── Free-text phone search ───────────────────────────────────────────────────
// Turns whatever a user types into a search box — "+971 50 673 1305",
// "00971506731305", "0506731305", "506731305", "506-731-305" — into match
// candidates, so search never depends on the caller typing the country code
// (or not), a leading trunk zero (or not), or any particular punctuation.
//
// Returns null if the input has fewer than 3 digits (too short to be a
// meaningful phone search — avoids over-matching on plain text searches that
// happen to contain a digit or two).
//
//   mobileKeyRegex   — for a normalised `mobileKey` field (digits only,
//                       country code, no leading zero — see Lead.js /
//                       normalizePhone). A plain "contains" match already
//                       handles country-code-or-not and leading-zero-or-not,
//                       since both variants are always substrings of the key.
//   rawFieldRegexes  — for a free-text `mobile` field that may still contain
//                       spaces/dashes/parens and may or may not include the
//                       country code (Order.mobile / Invoice.mobile — these
//                       models don't store a normalised key). Each candidate
//                       allows any run of non-digit characters between
//                       digits, so formatting differences never block a
//                       match; multiple digit-variants are tried since we
//                       don't know whether the stored value has the country
//                       code, a leading zero, neither, or both.
export function phoneSearchCandidates(raw) {
    const digits = String(raw || '').replace(/\D/g, '');
    if (digits.length < 3) return null;

    // Repeatedly try each reduction (00-prefix, leading trunk zero, known
    // dial code) against every variant found so far, until nothing new turns
    // up — handles combinations like "00" + country code together, not just
    // a single reduction off the raw digits.
    const variants = new Set([digits]);
    let grew = true;
    while (grew) {
        grew = false;
        for (const v of [...variants]) {
            const candidates = [];
            if (v.startsWith('00')) candidates.push(v.slice(2));
            if (v.startsWith('0')) candidates.push(v.slice(1));
            Object.values(DIAL_CODES).forEach((code) => {
                if (code && v.startsWith(code) && v.length > code.length) candidates.push(v.slice(code.length));
            });
            for (const c of candidates) {
                if (c && !variants.has(c)) { variants.add(c); grew = true; }
            }
        }
    }

    const mobileKeyRegex = new RegExp([...variants].map(escapeRx).join('|'));
    const rawFieldRegexes = [...variants].map(
        (v) => new RegExp(v.split('').map(escapeRx).join('\\D*'))
    );

    return { digits, mobileKeyRegex, rawFieldRegexes };
}