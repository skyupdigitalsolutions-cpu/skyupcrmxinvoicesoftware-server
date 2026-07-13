import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { Message } from '../models/Message.js';
import { User } from '../models/User.js';
import { notifyUsers } from '../utils/notify.js';

// Chat is company-scoped; the developer account (no company) can't use it.
const companyOf = (req) => {
    if (req.user.role === 'developer' || !req.user.company) {
        throw new ApiError(403, 'Chat is only available inside a company account.');
    }
    return req.user.company;
};

const isObjId = (v) => /^[0-9a-fA-F]{24}$/.test(String(v));

const publicUser = (u) => ({ id: u._id, name: u.name, username: u.username, role: u.role, active: u.active });

// Confirm the other party is a real, non-developer user in the same company.
const resolveCounterpart = async(userId, companyId, meId) => {
    if (!isObjId(userId)) throw new ApiError(400, 'Invalid user id.');
    if (String(userId) === String(meId)) throw new ApiError(400, 'You cannot chat with yourself.');
    const other = await User.findOne({ _id: userId, company: companyId, role: { $ne: 'developer' } })
        .select('name username role active');
    if (!other) throw new ApiError(404, 'User not found in your company.');
    return other;
};

// ── GET /chat/contacts ───────────────────────────────────────────────────────
export const listContacts = asyncHandler(async(req, res) => {
    const companyId = companyOf(req);
    const me = req.user._id;

    const users = await User.find({ company: companyId, role: { $ne: 'developer' }, _id: { $ne: me } })
        .select('name username role active').sort({ name: 1 }).lean();

    const lastAgg = await Message.aggregate([
        { $match: { company: companyId, $or: [{ from: me }, { to: me }] } },
        { $sort: { createdAt: -1 } },
        {
            $group: {
                _id: { $cond: [{ $eq: ['$from', me] }, '$to', '$from'] },
                lastBody: { $first: '$body' },
                lastAt: { $first: '$createdAt' },
                lastFromMe: { $first: { $eq: ['$from', me] } },
            },
        },
    ]);
    const lastMap = {};
    lastAgg.forEach((r) => { lastMap[String(r._id)] = r; });

    const unreadAgg = await Message.aggregate([
        { $match: { company: companyId, to: me, readAt: null } },
        { $group: { _id: '$from', n: { $sum: 1 } } },
    ]);
    const unreadMap = {};
    unreadAgg.forEach((r) => { unreadMap[String(r._id)] = r.n; });

    const contacts = users.map((u) => {
        const last = lastMap[String(u._id)];
        return {
            ...publicUser(u),
            unread: unreadMap[String(u._id)] || 0,
            lastMessage: last ? { body: last.lastBody, at: last.lastAt, fromMe: !!last.lastFromMe } : null,
        };
    }).sort((a, b) => {
        const at = a.lastMessage ? new Date(a.lastMessage.at).getTime() : 0;
        const bt = b.lastMessage ? new Date(b.lastMessage.at).getTime() : 0;
        if (bt !== at) return bt - at;
        return a.name.localeCompare(b.name);
    });

    res.json({ success: true, contacts });
});

// ── GET /chat/conversation/:userId ───────────────────────────────────────────
export const getConversation = asyncHandler(async(req, res) => {
    const companyId = companyOf(req);
    const me = req.user._id;
    const other = await resolveCounterpart(req.params.userId, companyId, me);

    const messages = await Message.find({
        company: companyId,
        $or: [
            { from: me, to: other._id },
            { from: other._id, to: me },
        ],
    }).sort({ createdAt: 1 }).limit(400).lean();

    await Message.updateMany({ company: companyId, from: other._id, to: me, readAt: null }, { $set: { readAt: new Date() } });

    res.json({
        success: true,
        user: publicUser(other),
        messages: messages.map((m) => ({
            id: m._id,
            body: m.body,
            at: m.createdAt,
            fromMe: String(m.from) === String(me),
            readAt: m.readAt,
        })),
    });
});

// ── POST /chat/conversation/:userId ──────────────────────────────────────────
export const sendMessage = asyncHandler(async(req, res) => {
    const companyId = companyOf(req);
    const other = await resolveCounterpart(req.params.userId, companyId, req.user._id);
    const body = String((req.body && req.body.body) || '').trim();
    if (!body) throw new ApiError(400, 'Message cannot be empty.');
    if (body.length > 4000) throw new ApiError(400, 'Message is too long.');

    const msg = await Message.create({ company: companyId, from: req.user._id, to: other._id, body });

    // Notify the recipient of the new message so it shows in their bell. The
    // preview is trimmed; failures never block the send (notifyUsers swallows).
    const preview = body.length > 90 ? `${body.slice(0, 90)}…` : body;
    await notifyUsers({
        company: companyId,
        recipients: other._id,
        type: 'chat-message',
        title: `New message from ${req.user.name}`,
        body: preview,
        link: '/chat',
    });

    res.status(201).json({
        success: true,
        message: { id: msg._id, body: msg.body, at: msg.createdAt, fromMe: true, readAt: null },
    });
});

// ── GET /chat/unread-count ────────────────────────────────────────────────────
export const unreadTotal = asyncHandler(async(req, res) => {
    const companyId = companyOf(req);
    const unread = await Message.countDocuments({ company: companyId, to: req.user._id, readAt: null });
    res.json({ success: true, unread });
});

// ── ADMIN OVERSIGHT ──────────────────────────────────────────────────────────

// GET /chat/admin/threads — every conversation in the company (any pair), with
// the last message + participant names. Admin only.
export const adminThreads = asyncHandler(async(req, res) => {
    const companyId = companyOf(req);

    const agg = await Message.aggregate([
        { $match: { company: companyId } },
        { $sort: { createdAt: -1 } },
        {
            $group: {
                // Unordered pair key: smaller id first so (A,B) and (B,A) collapse.
                _id: { $cond: [{ $lt: ['$from', '$to'] }, { a: '$from', b: '$to' }, { a: '$to', b: '$from' }] },
                lastBody: { $first: '$body' },
                lastAt: { $first: '$createdAt' },
                count: { $sum: 1 },
            },
        },
        { $sort: { lastAt: -1 } },
    ]);

    // Attach participant names.
    const ids = [];
    agg.forEach((t) => { ids.push(t._id.a, t._id.b); });
    const users = await User.find({ _id: { $in: ids }, company: companyId }).select('name role').lean();
    const uMap = {};
    users.forEach((u) => { uMap[String(u._id)] = { id: u._id, name: u.name, role: u.role }; });
    const stub = (id) => uMap[String(id)] || { id, name: 'Unknown user', role: '' };

    const threads = agg.map((t) => ({
        a: stub(t._id.a),
        b: stub(t._id.b),
        lastBody: t.lastBody,
        lastAt: t.lastAt,
        count: t.count,
    }));

    res.json({ success: true, threads });
});

// GET /chat/admin/thread/:a/:b — read-only transcript between any two users.
export const adminThread = asyncHandler(async(req, res) => {
    const companyId = companyOf(req);
    const { a, b } = req.params;
    if (!isObjId(a) || !isObjId(b)) throw new ApiError(400, 'Invalid user id.');

    const [ua, ub] = await Promise.all([
        User.findOne({ _id: a, company: companyId }).select('name role').lean(),
        User.findOne({ _id: b, company: companyId }).select('name role').lean(),
    ]);
    if (!ua || !ub) throw new ApiError(404, 'Participant not found in your company.');

    const messages = await Message.find({
        company: companyId,
        $or: [{ from: a, to: b }, { from: b, to: a }],
    }).sort({ createdAt: 1 }).limit(1000).lean();

    res.json({
        success: true,
        a: { id: ua._id, name: ua.name, role: ua.role },
        b: { id: ub._id, name: ub.name, role: ub.role },
        messages: messages.map((m) => ({ id: m._id, body: m.body, at: m.createdAt, fromId: m.from })),
    });
});