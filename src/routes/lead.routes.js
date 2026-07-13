import { Router } from 'express';
import {
    lookupByPhone,
    listLeads,
    getLead,
    createLead,
    updateLead,
    setLeadStatus,
    logCall,
    addNote,
    convertLead,
    deleteLead,
    listDeletedContacts,
} from '../controllers/lead.controller.js';
import { protect, authorize } from '../middleware/auth.js';

const router = Router();

// All routes require a valid session
router.use(protect);

// ── Phone duplicate check (GET /leads/lookup?mobile=…&country=…) ─────────────
// Must be declared BEFORE /:id to avoid being caught by the param route
router.get('/lookup', lookupByPhone);

// ── Deleted contacts report (admin only) ─────────────────────────────────────
// Two-segment path, declared before /:id so it isn't caught by the param route.
router.get('/deleted/report', authorize('admin'), listDeletedContacts);

// ── CRUD ──────────────────────────────────────────────────────────────────────
router.get('/', listLeads);
router.post('/', createLead);
router.get('/:id', getLead);
router.put('/:id', updateLead);

// ── Status (owner / admin) ────────────────────────────────────────────────────
router.patch('/:id/status', setLeadStatus);

// ── Discussion – any authenticated employee can contribute ────────────────────
router.post('/:id/call', logCall);
router.post('/:id/note', addNote);

// ── Convert to order (owner / admin) ─────────────────────────────────────────
router.post('/:id/convert', convertLead);

// ── Delete (admin only) ───────────────────────────────────────────────────────
router.delete('/:id', authorize('admin'), deleteLead);

export default router;