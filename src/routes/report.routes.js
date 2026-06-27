import { Router } from 'express';
import { dashboard, salesReport, dailyReport } from '../controllers/report.controller.js';
import { protect, authorize } from '../middleware/auth.js';

const router = Router();
router.use(protect);
router.get('/dashboard', dashboard);
// Daily report is available to admins and sales employees. The controller
// scopes the data per role: a sales user only ever sees their own leads,
// orders, invoices, deliveries and attendance.
router.get('/daily', authorize('admin', 'sales'), dailyReport);
// Company-wide sales analytics remain admin-only.
router.get('/sales', authorize('admin'), salesReport);
export default router;