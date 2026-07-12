import { Router } from 'express';
import {
  getPlatformSettings, setExpiryEmail, testExpiryEmail,
} from '../controllers/platform.controller.js';
import { protect, developerOnly } from '../middleware/auth.js';

const router = Router();
router.use(protect, developerOnly);

router.get('/settings', getPlatformSettings);
router.patch('/expiry-email', setExpiryEmail);
router.post('/expiry-email/test', testExpiryEmail);

export default router;
