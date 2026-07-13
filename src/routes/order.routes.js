import { Router } from 'express';
import {
    listOrders,
    getOrder,
    createOrder,
    updateOrder,
    updateStatus,
    deleteOrder,
    customerLookup,
} from '../controllers/order.controller.js';
import { protect, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { createOrderSchema, updateOrderSchema, statusSchema, idParam } from '../validators/schemas.js';

const router = Router();
router.use(protect);
router.get('/', listOrders);
// Two-segment path declared before /:id so it isn't captured by the param route.
router.get('/customer-lookup', customerLookup);
router.post('/', validate(createOrderSchema), createOrder);
router.get('/:id', validate(idParam), getOrder);
router.put('/:id', validate(updateOrderSchema), updateOrder);
router.patch('/:id/status', validate(statusSchema), updateStatus);
router.delete('/:id', authorize('admin'), validate(idParam), deleteOrder);
export default router;