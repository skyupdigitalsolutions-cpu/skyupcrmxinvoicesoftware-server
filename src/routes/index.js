import { Router } from 'express';
import authRoutes from './auth.routes.js';
import userRoutes from './user.routes.js';
import orderRoutes from './order.routes.js';
import invoiceRoutes from './invoice.routes.js';
import reportRoutes from './report.routes.js';
import leadRoutes from './lead.routes.js';
import attendanceRoutes from './attendance.routes.js';
import companyRoutes from './Company.routes.js';
import notificationRoutes from './notification.routes.js';
import platformRoutes from './platform.routes.js';
import chatRoutes from './chat.routes.js';

const router = Router();
router.get('/health', (_req, res) => res.json({ success: true, status: 'ok', time: new Date().toISOString() }));

// ── TEMPORARY DIAGNOSTIC — remove after confirming whether Render is
// blocking outbound SMTP ports. Does a raw TCP connect only (no SMTP
// protocol, no credentials involved) so a failure here can only mean the
// network path itself is blocked — never a Gmail/app-password/config issue.
// Usage: GET /api/_diag/port-check?host=smtp.gmail.com&port=587
router.get('/_diag/port-check', async (req, res) => {
    const net = await import('net');
    const host = String(req.query.host || 'smtp.gmail.com');
    const port = Number(req.query.port) || 587;
    const timeoutMs = 8000;

    const result = await new Promise((resolve) => {
        const start = Date.now();
        const socket = new net.Socket();
        let done = false;
        const finish = (ok, reason) => {
            if (done) return;
            done = true;
            socket.destroy();
            resolve({ ok, reason, ms: Date.now() - start });
        };
        socket.setTimeout(timeoutMs);
        socket.once('connect', () => finish(true, 'connected'));
        socket.once('timeout', () => finish(false, `timed out after ${timeoutMs}ms — port is very likely blocked/dropped by the network`));
        socket.once('error', (err) => {
            // Node's dual-stack (IPv6+IPv4) auto-connect throws an
            // AggregateError with a blank top-level message when every
            // address fails — unwrap it so the real reason (ECONNREFUSED,
            // ETIMEDOUT, etc.) for each attempted address is visible.
            if (err && Array.isArray(err.errors) && err.errors.length) {
                const detail = err.errors.map((e) => `${e.address || '?'}:${e.port || ''} → ${e.code || e.message || 'unknown'}`).join(' | ');
                return finish(false, `connection error (${err.errors.length} address(es) tried): ${detail}`);
            }
            finish(false, `connection error: ${err?.code || err?.message || String(err)}`);
        });
        socket.connect(port, host);
    });

    res.json({ success: true, host, port, ...result });
});

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/orders', orderRoutes);
router.use('/invoices', invoiceRoutes);
router.use('/reports', reportRoutes);
router.use('/leads', leadRoutes);
router.use('/attendance', attendanceRoutes);
router.use('/companies', companyRoutes);
router.use('/notifications', notificationRoutes);
router.use('/platform', platformRoutes);
router.use('/chat', chatRoutes);
export default router;