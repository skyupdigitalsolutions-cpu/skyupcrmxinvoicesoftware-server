import mongoose from 'mongoose';

// One-to-one chat message between two users of the SAME company. Admins can chat
// with anyone, users with each other; admins additionally get read-only
// oversight of every conversation. Every query is company-scoped for isolation.
const messageSchema = new mongoose.Schema({
    company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    from: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    to: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    body: { type: String, required: true, trim: true, maxlength: 4000 },
    // Set when the recipient opens the conversation. null = unread.
    readAt: { type: Date, default: null },
}, { timestamps: true });

messageSchema.index({ company: 1, from: 1, to: 1, createdAt: 1 });
messageSchema.index({ company: 1, to: 1, readAt: 1 });

export const Message = mongoose.model('Message', messageSchema);