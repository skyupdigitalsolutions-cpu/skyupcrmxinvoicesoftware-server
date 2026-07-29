// Mirrors the core of the client's built-in COUNTRY_CODES map (see
// client/src/utils/format.js) — enough to resolve a dial code for a lead's
// stored country so WhatsApp sends go out in full international format.
// NOTE: countries a user has added manually in the browser (custom-country
// registry) aren't known here since that list is browser-local; if a lead's
// mobile doesn't already look like it includes a country code, sending will
// fail with a clear error rather than silently guessing wrong.
const DIAL_CODES = {
    UAE: '971', 'Saudi Arabia': '966', Kuwait: '965', Qatar: '974', Bahrain: '973',
    Oman: '968', Iran: '98', Iraq: '964', Syria: '963', Yemen: '967', Lebanon: '961',
    Georgia: '995', India: '91', 'Sri Lanka': '94', 'United Kingdom': '44',
    Egypt: '20', Sudan: '249', 'South Sudan': '211', Libya: '218', Algeria: '213',
    Morocco: '212', Tunisia: '216',
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