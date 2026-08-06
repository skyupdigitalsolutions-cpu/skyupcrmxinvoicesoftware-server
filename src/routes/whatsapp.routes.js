import { Router } from 'express';
import {
    getSettings,
    setSettings,
    listTemplates,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    sendTemplate,
    sendReply,
    sendMedia,
    listConversations,
    getThread,
    getThreadByNumber,
    relinkContact,
    webhook,
    getTemplateSentStatus,
    getSessionWindow,
} from '../controllers/whatsapp.controller.js';
import { protect } from '../middleware/auth.js';

const router = Router();

// Public — MSG91 calls this directly, no session cookie/JWT available.
// Verified via a shared secret query param instead (see controller).
router.post('/webhook', webhook);

// Everything else requires an authenticated tenant user.
router.use(protect);

router.get('/settings', getSettings);
router.put('/settings', setSettings);

router.get('/templates', listTemplates);
router.post('/templates', createTemplate);
router.put('/templates/:id', updateTemplate);
router.delete('/templates/:id', deleteTemplate);

router.post('/send-template', sendTemplate);
router.post('/reply', sendReply);
router.post('/send-media', sendMedia);

router.get('/conversations', listConversations);
router.post('/template-status', getTemplateSentStatus);  // POST — leadIds array can be 1000+ entries, too large for a GET query string
router.get('/thread/:leadId', getThread);
router.get('/thread-by-number/:contactNumber', getThreadByNumber);
router.get('/session-window/:leadId', getSessionWindow);
router.post('/relink-contact', relinkContact);

export default router;