import { Router } from 'express';
import {
    listCheques,
    getCheque,
    createCheque,
    updateCheque,
    setChequeStatus,
    deleteCheque,
} from '../controllers/cheque.controller.js';
import { protect } from '../middleware/auth.js';

const router = Router();
router.use(protect);

router.get('/', listCheques);
router.post('/', createCheque);
router.get('/:id', getCheque);
router.put('/:id', updateCheque);
router.patch('/:id/status', setChequeStatus);
router.delete('/:id', deleteCheque);

export default router;