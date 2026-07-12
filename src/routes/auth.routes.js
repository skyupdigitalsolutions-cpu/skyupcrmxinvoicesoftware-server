import { Router } from 'express';
import { login, refresh, logout, me, forgotPassword, resetPassword } from '../controllers/auth.controller.js';
import { protect } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { authLimiter } from '../middleware/rateLimit.js';
import { loginSchema, forgotPasswordSchema, resetPasswordSchema } from '../validators/schemas.js';

const router = Router();
router.post('/login',          authLimiter, validate(loginSchema),          login);
router.post('/refresh',                                                      refresh);
router.post('/logout',         protect,                                      logout);
router.get('/me',              protect,                                      me);
router.post('/forgot-password', authLimiter, validate(forgotPasswordSchema), forgotPassword);
router.post('/reset-password',              validate(resetPasswordSchema),   resetPassword);
export default router;
