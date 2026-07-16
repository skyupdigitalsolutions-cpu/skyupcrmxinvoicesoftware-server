import { asyncHandler } from '../utils/asyncHandler.js';
import { Terms } from '../models/Terms.js';

// GET /terms/current — any authenticated user (used by TermsViewerModal and
// TermsGate). Auto-creates the singleton with default content on first call.
export const getCurrentTerms = asyncHandler(async (_req, res) => {
  const doc = await Terms.getSingleton();
  res.json({ success: true, terms: doc.toSafeJSON() });
});

// POST /terms/accept — records that the logged-in user has accepted the
// CURRENT published version (whatever Terms.version is right now). Called by
// TermsGate's "I Agree" button.
export const acceptTerms = asyncHandler(async (req, res) => {
  const doc = await Terms.getSingleton();
  req.user.termsAcceptedVersion = doc.version;
  req.user.termsAcceptedAt = new Date();
  await req.user.save();
  res.json({ success: true, termsAcceptedVersion: req.user.termsAcceptedVersion });
});

// PATCH /terms/current — developer only. Bumps `version` whenever the
// published content actually changes, so TermsGate knows to ask existing
// users to re-accept.
export const setCurrentTerms = asyncHandler(async (req, res) => {
  const doc = await Terms.getSingleton();
  const { title, effectiveDate, intro, sections, declaration } = req.body || {};

  let changed = false;
  if (title !== undefined && title !== doc.title) { doc.title = title; changed = true; }
  if (effectiveDate !== undefined && effectiveDate !== doc.effectiveDate) { doc.effectiveDate = effectiveDate; changed = true; }
  if (intro !== undefined && intro !== doc.intro) { doc.intro = intro; changed = true; }
  if (declaration !== undefined && declaration !== doc.declaration) { doc.declaration = declaration; changed = true; }
  if (Array.isArray(sections)) {
    doc.sections = sections.map((s) => ({ heading: s.heading || '', body: s.body || '' }));
    changed = true;
  }
  if (changed) doc.version += 1;

  await doc.save();
  res.json({ success: true, terms: doc.toSafeJSON() });
});