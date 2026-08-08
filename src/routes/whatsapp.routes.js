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
    getSessionWindow,
    getTemplateSentStatus,
    webhook,
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
router.get('/thread/:leadId', getThread);
router.get('/thread-by-number/:contactNumber', getThreadByNumber);
router.post('/relink-contact', relinkContact);

// Session window — tells the UI whether the 24h free-reply window is open
router.get('/session-window/:leadId', getSessionWindow);

// Template sent status — bulk send modal uses this to grey out already-sent leads
router.post('/template-sent-status', getTemplateSentStatus);

export default router;