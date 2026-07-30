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