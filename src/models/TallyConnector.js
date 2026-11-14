// models/TallyConnector.js
// One registered Windows connector per CRM company (tenant). The connector
// authenticates with an opaque token; only its SHA-256 hash is stored here.
// The per-company Tally settings (company name, ledgers, godown, voucher type
// names) live on the connector so a sync snapshot can be built at enqueue time.
import mongoose from 'mongoose';

const tallyConnectorSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  name:    { type: String, trim: true, default: 'Tally Connector', maxlength: 80 },

  // Auth: sha256(token). The plain token is shown ONCE at creation/rotation.
  tokenHash:   { type: String, required: true, unique: true, select: false },
  tokenPrefix: { type: String, default: '' }, // first chars, safe to show in UI/logs

  active:    { type: Boolean, default: true, index: true },
  revokedAt: { type: Date, default: null },

  // ── Tally settings (allowlist + mapping defaults) ─────────────────────────
  settings: {
    tallyCompanyName:         { type: String, trim: true, default: 'Neo Spotek - Test', maxlength: 120 },
    baseCurrency:             { type: String, trim: true, uppercase: true, default: 'AED', maxlength: 10 },
    salesOrderVoucherType:    { type: String, trim: true, default: 'Sales Order', maxlength: 80 },
    purchaseOrderVoucherType: { type: String, trim: true, default: 'Purchase Order', maxlength: 80 },
    salesLedger:              { type: String, trim: true, default: '', maxlength: 120 },
    purchaseLedger:           { type: String, trim: true, default: '', maxlength: 120 },
    godown:                   { type: String, trim: true, default: 'Main Location', maxlength: 120 },
    timezone:                 { type: String, trim: true, default: 'Asia/Dubai', maxlength: 60 },
  },

  // ── Last heartbeat (reported by the connector) ────────────────────────────
  lastSeenAt:        { type: Date, default: null },
  lastHeartbeat: {
    agentVersion:     { type: String, default: '' },
    hostname:         { type: String, default: '' },
    tallyReachable:   { type: Boolean, default: false },
    loadedCompanies:  { type: [String], default: [] },
    companyOk:        { type: Boolean, default: false },
    currencyOk:       { type: Boolean, default: false },
    message:          { type: String, default: '' },
  },

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

// At most ONE active connector per company.
tallyConnectorSchema.index(
  { company: 1 },
  { unique: true, partialFilterExpression: { active: true }, name: 'one_active_connector_per_company' }
);

export const TallyConnector = mongoose.model('TallyConnector', tallyConnectorSchema);
