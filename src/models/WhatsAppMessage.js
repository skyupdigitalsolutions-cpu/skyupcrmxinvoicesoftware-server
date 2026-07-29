import mongoose from 'mongoose';

// Every outbound template/session message and every inbound reply, tied to a
// lead. This is what powers both the "all leads' shared template + response"
// table and the per-lead chat thread on the Communication page.
const MESSAGE_STATUSES = ['queued', 'sent', 'delivered', 'read', 'replied', 'failed'];

const whatsAppMessageSchema = new mongoose.Schema(
  {
    company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    lead:    { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },

    direction: { type: String, enum: ['out', 'in'], required: true }, // 'out' = we sent it, 'in' = lead replied
    kind:      { type: String, enum: ['template', 'session'], default: 'session' }, // template = auto/bulk send, session = manual continue-chat or inbound reply

    templateName: { type: String, default: '' }, // set for outbound template sends
    variables:    { type: [String], default: [] },
    text:         { type: String, default: '' }, // rendered/plain text body shown in the thread

    // Media attachment (image/document/video/audio) — set when this message
    // carries a file instead of / alongside plain text.
    mediaUrl:      { type: String, default: '' },
    mediaType:     { type: String, enum: ['', 'image', 'document', 'video', 'audio'], default: '' },
    mediaFilename: { type: String, default: '' },

    status: { type: String, enum: MESSAGE_STATUSES, default: 'queued', index: true },
    error:  { type: String, default: '' },

    msg91RequestId: { type: String, default: '', index: true }, // returned by MSG91 on send, used to match delivery/read webhook callbacks

    sentBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // who triggered an outbound send (null for inbound)
  },
  { timestamps: true }
);

whatsAppMessageSchema.index({ company: 1, lead: 1, createdAt: 1 });

whatsAppMessageSchema.methods.toSafeJSON = function () {
  return {
    id: this._id,
    lead: this.lead,
    direction: this.direction,
    kind: this.kind,
    templateName: this.templateName,
    variables: this.variables,
    text: this.text,
    mediaUrl: this.mediaUrl,
    mediaType: this.mediaType,
    mediaFilename: this.mediaFilename,
    status: this.status,
    error: this.error,
    createdAt: this.createdAt,
  };
};

export { MESSAGE_STATUSES };
export const WhatsAppMessage = mongoose.model('WhatsAppMessage', whatsAppMessageSchema);