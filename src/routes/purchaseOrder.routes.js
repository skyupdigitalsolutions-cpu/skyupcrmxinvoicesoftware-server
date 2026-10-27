// routes/purchaseOrder.routes.js
import { Router } from 'express';
import {
  listPurchaseOrders,
  getPurchaseOrder,
  createPurchaseOrder,
  updatePurchaseOrder,
  setPurchaseOrderStatus,
  setPurchaseOrderPayment,
  deletePurchaseOrder,
} from '../controllers/purchaseOrder.controller.js';
import { protect, authorize } from '../middleware/auth.js';

const router = Router();
router.use(protect);

router.get('/',    listPurchaseOrders);
router.post('/',   createPurchaseOrder);
router.get('/:id', getPurchaseOrder);
router.put('/:id', updatePurchaseOrder);
router.patch('/:id/status',  setPurchaseOrderStatus);
router.patch('/:id/payment', setPurchaseOrderPayment);
router.delete('/:id', authorize('admin'), deletePurchaseOrder);

export default router;
