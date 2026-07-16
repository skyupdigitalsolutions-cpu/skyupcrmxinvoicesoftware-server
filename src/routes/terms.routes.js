import { Router } from 'express';
import { getCurrentTerms, setCurrentTerms, acceptTerms } from '../controllers/terms.controller.js';
import { protect, developerOnly } from '../middleware/auth.js';

const router = Router();
router.use(protect); // any authenticated user can read/accept

router.get('/current', getCurrentTerms);
router.post('/accept', acceptTerms);
router.patch('/current', developerOnly, setCurrentTerms); // developer only

export default router;