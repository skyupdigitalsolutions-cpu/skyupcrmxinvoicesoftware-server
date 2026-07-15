import { Router } from 'express';
import {
  listCompanies, getCompany, createCompany, updateCompany, deleteCompany,
  createCompanyAdmin, setSubscription, developerStats,
  setCloudinary, setEmailReport, testEmailReport, setBranding, uploadCompanyLogo,
} from '../controllers/Company.controller.js';
import { protect, developerOnly } from '../middleware/auth.js';

const router = Router();

// Everything here is platform-developer only.
router.use(protect, developerOnly);

router.get('/stats/overview', developerStats);
router.get('/', listCompanies);
router.post('/', createCompany);
router.get('/:id', getCompany);
router.patch('/:id', updateCompany);
router.patch('/:id/subscription', setSubscription);
router.patch('/:id/cloudinary', setCloudinary);
router.patch('/:id/branding', setBranding);
router.post('/:id/logo', uploadCompanyLogo);
router.patch('/:id/email-report', setEmailReport);
router.post('/:id/email-report/test', testEmailReport);
router.delete('/:id', deleteCompany);
router.post('/:id/admin', createCompanyAdmin);

export default router;