import mongoose from 'mongoose';

// Every outbound template/session message and every inbound reply, tied to a
// lead. This is what powers both the "all leads' shared template + response"
// table and the per-lead chat thread on the Communication page.
const MESSAGE_STATUSES = ['queued', 'sent', 'delivered', 'read', 'replied', 'failed'];

const whatsAppMessageSchema = new mongoose.Schema(
  {
    company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    // Optional — a message can be sent to a CSV-imported number that isn't a
    // lead yet. `lead` is set once/if that number is later added as a lead
    // (see the "Add as Lead" flow triggered on their first reply); until
    // then, contactName/contactNumber/contactCountry are the source of truth
    // for who this conversation is with.
    lead: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null, index: true },
    contactName:    { type: String, default: '' },
    contactNumber:  { type: String, default: '', index: true }, // E.164-ish digits, always set (lead or not) — used to group a conversation when there's no lead yet
    contactCountry: { type: String, default: '' },

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

    // Whether a staff member has opened this INBOUND reply yet (set true when
    // the thread is opened via getThread). Distinct from `status: 'read'`
    // above, which is the outbound delivery/read-receipt from WhatsApp itself
    // — this `seen` flag is about OUR side having viewed an inbound message,
    // and is what drives the "new reply" indicator on the Communication page.
    seen: { type: Boolean, default: false, index: true },

    msg91RequestId: { type: String, default: '', index: true }, // returned by MSG91 on send, used to match delivery/read webhook callbacks

    sentBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // who triggered an outbound send (null for inbound)
  },
  { timestamps: true }
);

whatsAppMessageSchema.index({ company: 1, lead: 1, createdAt: 1 });
whatsAppMessageSchema.index({ company: 1, contactNumber: 1, createdAt: 1 });
// Compound indexes for listConversations aggregation ($match + $sort + $group)
whatsAppMessageSchema.index({ company: 1, createdAt: -1 });
// For getSessionWindow — last inbound per lead
whatsAppMessageSchema.index({ lead: 1, company: 1, direction: 1, createdAt: -1 });
// For webhook dedup check
whatsAppMessageSchema.index({ msg91RequestId: 1, direction: 1 }, { sparse: true });
// For outbound status update
whatsAppMessageSchema.index({ msg91RequestId: 1, contactNumber: 1 });

whatsAppMessageSchema.methods.toSafeJSON = function () {
  return {
    id: this._id,
    lead: this.lead,
    contactName: this.contactName,
    contactNumber: this.contactNumber,
    contactCountry: this.contactCountry,
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
    seen: this.seen,
    createdAt: this.createdAt,
  };
};

export { MESSAGE_STATUSES };
export const WhatsAppMessage = mongoose.model('WhatsAppMessage', whatsAppMessageSchema);