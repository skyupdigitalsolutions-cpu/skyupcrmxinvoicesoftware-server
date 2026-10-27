// routes/sensy.routes.js
import { Router } from 'express';
import { sensyWebhook, getSensySettings, setSensySettings } from '../controllers/sensy.controller.js';
import { protect, authorize } from '../middleware/auth.js';

const router = Router();

// ── PUBLIC — Sensy calls this with ?secret=xxx, no JWT ───────────────────────
router.post('/webhook', sensyWebhook);

// ── PROTECTED — admin only ────────────────────────────────────────────────────
router.use(protect, authorize('admin'));
router.get('/settings',  getSensySettings);
router.patch('/settings', setSensySettings);

export default router;
