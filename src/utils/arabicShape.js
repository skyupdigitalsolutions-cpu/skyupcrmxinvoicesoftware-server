// arabicShape.js
// jsPDF draws characters by codepoint, left-to-right, with zero text shaping
// or bidi support. Arabic needs both: (1) each letter must be swapped for its
// correct isolated/initial/medial/final PRESENTATION FORM codepoint based on
// its neighbors, so letters visually connect, and (2) the character order
// must be reversed for right-to-left display.
//
// This is a from-scratch, dependency-free implementation of the standard
// Unicode Arabic shaping algorithm (Joining_Type based), using the
// Presentation Forms-B block (U+FE70–U+FEFC). It only reorders/reshapes; it
// does not implement full Unicode BiDi, so it's correct for pure-Arabic (or
// pure-Latin) strings but not for freely mixed Arabic+Latin/number runs —
// which covers company names/addresses, the actual use case here.

// [isolated, final, initial, medial] presentation-form codepoints per base
// letter. Right-joining letters (alef, dal, thal, reh, zain, waw, teh
// marbuta, alef maksura, and the alef/waw hamza seats) have no initial/medial
// form — they never connect to the NEXT letter — so those slots are null.
const FORMS = {
  '\u0621': [0xFE80, null, null, null], // hamza (non-joining: isolated only)
  '\u0622': [0xFE81, 0xFE82, null, null], // alef madda
  '\u0623': [0xFE83, 0xFE84, null, null], // alef hamza above
  '\u0624': [0xFE85, 0xFE86, null, null], // waw hamza above
  '\u0625': [0xFE87, 0xFE88, null, null], // alef hamza below
  '\u0626': [0xFE89, 0xFE8A, 0xFE8B, 0xFE8C], // yeh hamza above (dual-joining)
  '\u0627': [0xFE8D, 0xFE8E, null, null], // alef
  '\u0628': [0xFE8F, 0xFE90, 0xFE91, 0xFE92], // beh
  '\u0629': [0xFE93, 0xFE94, null, null], // teh marbuta
  '\u062A': [0xFE95, 0xFE96, 0xFE97, 0xFE98], // teh
  '\u062B': [0xFE99, 0xFE9A, 0xFE9B, 0xFE9C], // theh
  '\u062C': [0xFE9D, 0xFE9E, 0xFE9F, 0xFEA0], // jeem
  '\u062D': [0xFEA1, 0xFEA2, 0xFEA3, 0xFEA4], // hah
  '\u062E': [0xFEA5, 0xFEA6, 0xFEA7, 0xFEA8], // khah
  '\u062F': [0xFEA9, 0xFEAA, null, null], // dal
  '\u0630': [0xFEAB, 0xFEAC, null, null], // thal
  '\u0631': [0xFEAD, 0xFEAE, null, null], // reh
  '\u0632': [0xFEAF, 0xFEB0, null, null], // zain
  '\u0633': [0xFEB1, 0xFEB2, 0xFEB3, 0xFEB4], // seen
  '\u0634': [0xFEB5, 0xFEB6, 0xFEB7, 0xFEB8], // sheen
  '\u0635': [0xFEB9, 0xFEBA, 0xFEBB, 0xFEBC], // sad
  '\u0636': [0xFEBD, 0xFEBE, 0xFEBF, 0xFEC0], // dad
  '\u0637': [0xFEC1, 0xFEC2, 0xFEC3, 0xFEC4], // tah
  '\u0638': [0xFEC5, 0xFEC6, 0xFEC7, 0xFEC8], // zah
  '\u0639': [0xFEC9, 0xFECA, 0xFECB, 0xFECC], // ain
  '\u063A': [0xFECD, 0xFECE, 0xFECF, 0xFED0], // ghain
  '\u0641': [0xFED1, 0xFED2, 0xFED3, 0xFED4], // feh
  '\u0642': [0xFED5, 0xFED6, 0xFED7, 0xFED8], // qaf
  '\u0643': [0xFED9, 0xFEDA, 0xFEDB, 0xFEDC], // kaf
  '\u0644': [0xFEDD, 0xFEDE, 0xFEDF, 0xFEE0], // lam
  '\u0645': [0xFEE1, 0xFEE2, 0xFEE3, 0xFEE4], // meem
  '\u0646': [0xFEE5, 0xFEE6, 0xFEE7, 0xFEE8], // noon
  '\u0647': [0xFEE9, 0xFEEA, 0xFEEB, 0xFEEC], // heh
  '\u0648': [0xFEED, 0xFEEE, null, null], // waw
  '\u0649': [0xFEEF, 0xFEF0, null, null], // alef maksura
  '\u064A': [0xFEF1, 0xFEF2, 0xFEF3, 0xFEF4], // yeh
};

// Arabic diacritics (tashkeel/harakat) — "transparent" for joining: they
// don't break the connection between the letters on either side of them.
const TRANSPARENT = /[\u064B-\u065F\u0670]/;

function isDual(ch) {
  const f = FORMS[ch];
  return !!(f && f[2] !== null); // has an initial form → dual-joining
}
function isJoinable(ch) {
  return !!FORMS[ch];
}

/**
 * Reshape + reverse Arabic text for jsPDF (which does no shaping/bidi of its
 * own). Returns a new string where each Arabic letter has been swapped for
 * its correct presentation-form glyph, and the whole thing is reversed so it
 * displays right-to-left when drawn left-to-right by jsPDF.
 *
 * Non-Arabic characters (Latin, digits, punctuation, spaces) pass through
 * unshaped — they simply break the joining chain around them, same as a
 * space would. Best suited to pure-Arabic strings (company names,
 * addresses) rather than freely mixed Arabic/Latin runs.
 */
export function reshapeArabicForPdf(text) {
  const raw = String(text ?? '');
  if (!raw) return '';

  // Build an index of "letters that matter for joining" (skip diacritics).
  const chars = Array.from(raw);
  const letterIdx = chars.map((c, i) => (TRANSPARENT.test(c) ? -1 : i)).filter((i) => i !== -1);

  const shapedChars = [...chars];
  for (let k = 0; k < letterIdx.length; k++) {
    const i = letterIdx[k];
    const ch = chars[i];
    if (!isJoinable(ch)) continue;

    const prevCh = k > 0 ? chars[letterIdx[k - 1]] : null;
    const nextCh = k < letterIdx.length - 1 ? chars[letterIdx[k + 1]] : null;

    const connectedFromPrev = !!(prevCh && isDual(prevCh));
    const connectedToNext = isDual(ch) && !!(nextCh && isJoinable(nextCh));

    const [isolated, final, initial, medial] = FORMS[ch];
    let codepoint;
    if (connectedFromPrev && connectedToNext) codepoint = medial ?? final ?? isolated;
    else if (connectedFromPrev) codepoint = final ?? isolated;
    else if (connectedToNext) codepoint = initial ?? isolated;
    else codepoint = isolated;

    shapedChars[i] = String.fromCharCode(codepoint);
  }

  return shapedChars.reverse().join('');
}

/** True if the string contains any Arabic-script letters (rough check, good
 *  enough to decide whether a branding field needs the Arabic font/shaping). */
export function containsArabic(text) {
  return /[\u0600-\u06FF]/.test(String(text ?? ''));
}