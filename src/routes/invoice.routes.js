import { Router } from 'express';
import {
  listInvoices, getInvoice, convertOrder, updateInvoiceItems, deleteInvoice,
  getInvoicePdf, regenerateInvoicePdf, setPaymentStatus,
} from '../controllers/invoice.controller.js';
import { protect, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { invoiceItemsSchema, invoicePaymentSchema, idParam } from '../validators/schemas.js';

const router = Router();
router.use(protect);
router.get('/', listInvoices);
router.get('/:id', validate(idParam), getInvoice);
router.get('/:id/pdf', validate(idParam), getInvoicePdf);
router.post('/:id/pdf/regenerate', validate(idParam), regenerateInvoicePdf);
router.post('/from-order/:id', validate(idParam), convertOrder);
router.put('/:id/items', validate(invoiceItemsSchema), updateInvoiceItems);
router.patch('/:id/payment', validate(invoicePaymentSchema), setPaymentStatus);
router.delete('/:id', authorize('admin'), validate(idParam), deleteInvoice);
export default router;