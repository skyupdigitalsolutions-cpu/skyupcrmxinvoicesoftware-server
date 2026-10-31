import { api } from './client.js';

export const authApi = {
    login: (body) => api.post('/auth/login', body).then((r) => r.data),
    logout: () => api.post('/auth/logout').then((r) => r.data),
    me: () => api.get('/auth/me').then((r) => r.data),
    forgotPassword: (body) => api.post('/auth/forgot-password', body).then((r) => r.data),
    resetPassword: (body) => api.post('/auth/reset-password', body).then((r) => r.data),
};

export const orderApi = {
    list: (params) => api.get('/orders', { params }).then((r) => r.data.orders),
    get: (id) => api.get(`/orders/${id}`).then((r) => r.data.order),
    create: (body) => api.post('/orders', body).then((r) => r.data.order),
    update: (id, body) => api.put(`/orders/${id}`, body).then((r) => r.data.order),
    setStatus: (id, body) => api.patch(`/orders/${id}/status`, body).then((r) => r.data.order),
    customerLookup: (params) => api.get('/orders/customer-lookup', { params }).then((r) => r.data),
    remove: (id) => api.delete(`/orders/${id}`).then((r) => r.data),
};

export const whatsappApi = {
    getSettings: () => api.get('/whatsapp/settings').then((r) => r.data.msg91),
    setSettings: (body) => api.put('/whatsapp/settings', body).then((r) => r.data.msg91),
    listTemplates: () => api.get('/whatsapp/templates').then((r) => r.data.templates),
    createTemplate: (body) => api.post('/whatsapp/templates', body).then((r) => r.data.template),
    updateTemplate: (id, body) => api.put(`/whatsapp/templates/${id}`, body).then((r) => r.data.template),
    deleteTemplate: (id) => api.delete(`/whatsapp/templates/${id}`).then((r) => r.data),
    sendTemplate: (body) => api.post('/whatsapp/send-template', body).then((r) => r.data.results),
    sendReply: (body) => api.post('/whatsapp/reply', body).then((r) => r.data),
    sendMedia: (body) => api.post('/whatsapp/send-media', body).then((r) => r.data),
    listConversations: () => api.get('/whatsapp/conversations').then((r) => r.data.conversations),
    getThread: (leadId) => api.get(`/whatsapp/thread/${leadId}`).then((r) => r.data),
    getThreadByNumber: (contactNumber) => api.get(`/whatsapp/thread-by-number/${encodeURIComponent(contactNumber)}`).then((r) => r.data),
    relinkContact: (body) => api.post('/whatsapp/relink-contact', body).then((r) => r.data),
    getSessionWindow: (leadId) => api.get(`/whatsapp/session-window/${leadId}`).then((r) => r.data),
    getTemplateSentStatus: (leadIds, templateName) =>
        api.get('/whatsapp/template-status', { params: { leadIds: leadIds.join(','), templateName } })
            .then((r) => r.data.statuses)
            .catch(() =>
                // Fallback for older server deployments that used a different route name
                api.get('/whatsapp/template-sent-status', { params: { leadIds: leadIds.join(','), templateName } })
                    .then((r) => r.data.statuses)
                    .catch(() => ({}))
            ),
};

export const chequeApi = {
    list: (params) => api.get('/cheques', { params }).then((r) => r.data.cheques),
    get: (id) => api.get(`/cheques/${id}`).then((r) => r.data.cheque),
    create: (body) => api.post('/cheques', body).then((r) => r.data.cheque),
    update: (id, body) => api.put(`/cheques/${id}`, body).then((r) => r.data.cheque),
    setStatus: (id, status) => api.patch(`/cheques/${id}/status`, { status }).then((r) => r.data.cheque),
    remove: (id) => api.delete(`/cheques/${id}`).then((r) => r.data),
};

export const invoiceApi = {
    list: (params) => api.get('/invoices', { params }).then((r) => r.data.invoices),
    setPayment: (id, paymentStatus) => api.patch(`/invoices/${id}/payment`, { paymentStatus }).then((r) => r.data.invoice),
    get: (id) => api.get(`/invoices/${id}`).then((r) => r.data.invoice),
    fromOrder: (orderId) => api.post(`/invoices/from-order/${orderId}`).then((r) => r.data.invoice),
    updateItems: (id, items) => api.put(`/invoices/${id}/items`, { items }).then((r) => r.data.invoice),
    remove: (id) => api.delete(`/invoices/${id}`).then((r) => r.data),
    // PDF: GET /invoices/:id/pdf → stream or redirect to Cloudinary
    pdfUrl: (id) => `/api/invoices/${id}/pdf`,
    // Force-regenerate PDF and re-upload to Cloudinary
    regeneratePdf: (id) => api.post(`/invoices/${id}/pdf/regenerate`).then((r) => r.data),
};

export const userApi = {
    list: () => api.get('/users').then((r) => r.data.users),
    get: (id) => api.get(`/users/${id}`).then((r) => r.data),
    create: (body) => api.post('/users', body).then((r) => r.data.user),
    update: (id, body) => api.patch(`/users/${id}`, body).then((r) => r.data.user),
    remove: (id) => api.delete(`/users/${id}`).then((r) => r.data),
};

export const reportApi = {
    dashboard: (params) => api.get('/reports/dashboard', { params }).then((r) => r.data),
    daily: (params) => api.get('/reports/daily', { params }).then((r) => r.data),
    sales: (params) => api.get('/reports/sales', { params }).then((r) => r.data),
    monthlyComparison: (params) => api.get('/reports/monthly-comparison', { params }).then((r) => r.data),
};

export const leadApi = {
    list: (params) => api.get('/leads', { params }).then((r) => r.data.leads),
    get: (id) => api.get(`/leads/${id}`).then((r) => r.data), // returns { lead, isOwner, canEdit, canContribute }
    create: (body) => api.post('/leads', body).then((r) => r.data.lead),
    bulkCreate: (leads) => api.post('/leads/bulk', { leads }).then((r) => r.data), // { created, skipped, failed, errors }
    bulkUpdate: (updates) => api.put('/leads/bulk-update', { updates }).then((r) => r.data), // { updated, unchanged, failed, errors }
    update: (id, body) => api.put(`/leads/${id}`, body).then((r) => r.data.lead),
    setStatus: (id, body) => api.patch(`/leads/${id}/status`, body).then((r) => r.data.lead),
    logCall: (id, body) => api.post(`/leads/${id}/call`, body).then((r) => r.data.lead),
    addNote: (id, body) => api.post(`/leads/${id}/note`, body).then((r) => r.data.lead),
    convert: (id, body) => api.post(`/leads/${id}/convert`, body).then((r) => r.data),
    markBuyer: (id, body) => api.post(`/leads/${id}/mark-buyer`, body).then((r) => r.data),
    remove: (id) => api.delete(`/leads/${id}`).then((r) => r.data),
    lookup: (mobile, country) => api.get('/leads/lookup', { params: { mobile, country } }).then((r) => r.data),
    deletedContacts: (params) => api.get('/leads/deleted/report', { params }).then((r) => r.data.contacts),
    listDuplicates: () => api.get('/leads/duplicates').then((r) => r.data.groups),
    merge: (body) => api.post('/leads/merge', body).then((r) => r.data),
};

export const attendanceApi = {
    // Self-service
    clockIn: (coords) => api.post('/attendance/clock-in', coords || {}).then((r) => r.data.record),
    clockOut: (coords) => api.post('/attendance/clock-out', coords || {}).then((r) => r.data.record),
    startBreak: (reason) => api.post('/attendance/break/start', { reason }).then((r) => r.data.record),
    endBreak: () => api.post('/attendance/break/end').then((r) => r.data.record),
    myToday: () => api.get('/attendance/my-today').then((r) => r.data.record),
    // Live-location tracking
    trackingConfig: () => api.get('/attendance/tracking').then((r) => r.data.tracking),
    recordLocation: (coords) => api.post('/attendance/location', coords || {}).then((r) => r.data),
    userLocations: (userId, date) => api.get(`/attendance/location/${userId}`, { params: { date } }).then((r) => r.data),
    // Admin / management table
    report: (params) => api.get('/attendance/report', { params }).then((r) => r.data.records),
    users: () => api.get('/attendance/users').then((r) => r.data.users),
    upsert: (body) => api.post('/attendance', body).then((r) => r.data.record),
    update: (id, body) => api.put(`/attendance/${id}`, body).then((r) => r.data.record),
    remove: (id) => api.delete(`/attendance/${id}`).then((r) => r.data),
    // Admin rules / config
    getConfig: () => api.get('/attendance/config').then((r) => r.data.config),
    saveConfig: (body) => api.put('/attendance/config', body).then((r) => r.data.config),
};
// ── Developer: companies + per-company limits ───────────────────────────────
export const companyApi = {
    list: () => api.get('/companies').then((r) => r.data.companies),
    get: (id) => api.get(`/companies/${id}`).then((r) => r.data.company),
    create: (body) => api.post('/companies', body).then((r) => r.data), // { company, admin }
    update: (id, body) => api.patch(`/companies/${id}`, body).then((r) => r.data.company),
    remove: (id) => api.delete(`/companies/${id}`).then((r) => r.data),
    stats: () => api.get('/companies/stats/overview').then((r) => r.data),
    setSubscription: (id, body) => api.patch(`/companies/${id}/subscription`, body).then((r) => r.data.company),
    createAdmin: (id, body) => api.post(`/companies/${id}/admin`, body).then((r) => r.data.user),
    setCloudinary: (id, body) => api.patch(`/companies/${id}/cloudinary`, body).then((r) => r.data),
    setBranding: (id, body) => api.patch(`/companies/${id}/branding`, body).then((r) => r.data),
    uploadLogo: (id, image, target) => api.post(`/companies/${id}/logo`, { image, target }).then((r) => r.data), // { url, logoUrl, receiptLogoUrl }
    setEmailReport: (id, body) => api.patch(`/companies/${id}/email-report`, body).then((r) => r.data),
    testEmailReport: (id) => api.post(`/companies/${id}/email-report/test`).then((r) => r.data),
};
// ── Notifications (per-user, company-scoped) ────────────────────────────────
export const notificationApi = {
    list: (params) => api.get('/notifications', { params }).then((r) => r.data), // { notifications, unread }
    unreadCount: () => api.get('/notifications/unread-count').then((r) => r.data.unread),
    markRead: (id) => api.patch(`/notifications/${id}/read`).then((r) => r.data),
    markAllRead: () => api.patch('/notifications/read-all').then((r) => r.data),
    remove: (id) => api.delete(`/notifications/${id}`).then((r) => r.data),
};

// ── Chat (per-company, 1:1 messaging + admin oversight) ─────────────────────
export const chatApi = {
    contacts: () => api.get('/chat/contacts').then((r) => r.data.contacts),
    unreadCount: () => api.get('/chat/unread-count').then((r) => r.data.unread),
    conversation: (userId) => api.get(`/chat/conversation/${userId}`).then((r) => r.data),
    send: (userId, body) => api.post(`/chat/conversation/${userId}`, { body }).then((r) => r.data.message),
    adminThreads: () => api.get('/chat/admin/threads').then((r) => r.data.threads),
    adminThread: (a, b) => api.get(`/chat/admin/thread/${a}/${b}`).then((r) => r.data),
};

// ── Platform settings (developer only) ──────────────────────────────────────
export const platformApi = {
    getSettings: () => api.get('/platform/settings').then((r) => r.data.settings),
    setExpiryEmail: (body) => api.patch('/platform/expiry-email', body).then((r) => r.data.settings),
    testExpiryEmail: (to) => api.post('/platform/expiry-email/test', { to }).then((r) => r.data),
};

// ── Terms & Conditions ──────────────────────────────────────────────────────
export const termsApi = {
    getCurrent: () => api.get('/terms/current').then((r) => r.data.terms),
    accept: () => api.post('/terms/accept').then((r) => r.data),
    // developer only
    setCurrent: (body) => api.patch('/terms/current', body).then((r) => r.data.terms),
};
