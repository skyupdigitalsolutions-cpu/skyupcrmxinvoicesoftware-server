import { Router } from 'express';
import {
    listContacts,
    getConversation,
    sendMessage,
    unreadTotal,
    adminThreads,
    adminThread,
} from '../controllers/chat.controller.js';
import { protect, authorize } from '../middleware/auth.js';

const router = Router();
router.use(protect);

router.get('/contacts', listContacts);
router.get('/unread-count', unreadTotal);

// Admin oversight (declared before the generic :userId route)
router.get('/admin/threads', authorize('admin'), adminThreads);
router.get('/admin/thread/:a/:b', authorize('admin'), adminThread);

router.get('/conversation/:userId', getConversation);
router.post('/conversation/:userId', sendMessage);

export default router;