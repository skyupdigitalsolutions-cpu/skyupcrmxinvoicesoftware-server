import { Router } from 'express';
import { listUsers, getUserDetail, createUser, updateUser, deleteUser } from '../controllers/user.controller.js';
import { protect, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { createUserSchema, updateUserSchema, idParam } from '../validators/schemas.js';

const router = Router();
router.use(protect, authorize('admin')); // entire resource is admin-only
router.get('/', listUsers);
router.get('/:id', validate(idParam), getUserDetail);
router.post('/', validate(createUserSchema), createUser);
router.patch('/:id', validate(updateUserSchema), updateUser);
router.delete('/:id', validate(idParam), deleteUser);
export default router;