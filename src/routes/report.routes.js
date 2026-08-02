import { Router } from 'express';
import { dashboard, salesReport, dailyReport, monthlyComparison } from '../controllers/report.controller.js';
import { protect, authorize } from '../middleware/auth.js';

const router = Router();
router.use(protect);
router.get('/dashboard', dashboard);
router.get('/daily', authorize('admin', 'sales'), dailyReport);
router.get('/sales', authorize('admin'), salesReport);
router.get('/monthly-comparison', authorize('admin'), monthlyComparison);
export default router;