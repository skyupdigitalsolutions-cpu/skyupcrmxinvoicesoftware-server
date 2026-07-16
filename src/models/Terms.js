// Terms.js
// Platform-wide Terms & Conditions — a singleton document (like
// PlatformSettings), managed only by the developer. Every company/user sees
// the same published terms; there's no per-company customization.
//
// `sections` is an ordered list of {heading, body} pairs, rendered by both
// the blocking acceptance gate (TermsGate) and the read-only viewer
// (TermsViewerModal) exactly as stored here.
import mongoose from 'mongoose';

const sectionSchema = new mongoose.Schema(
  { heading: { type: String, default: '', trim: true }, body: { type: String, default: '', trim: true } },
  { _id: false }
);

const termsSchema = new mongoose.Schema(
  {
    singleton: { type: String, default: 'terms', unique: true, index: true },
    title: { type: String, default: 'Terms & Conditions', trim: true },
    // Free-text date shown under the title (e.g. "16 Jul 2026") — plain
    // string rather than a Date, since this is just a display label, not
    // used in any date logic.
    effectiveDate: { type: String, default: '', trim: true },
    intro: { type: String, default: '', trim: true },
    sections: { type: [sectionSchema], default: [] },
    // Shown by TermsGate next to the acceptance checkbox — not part of the
    // scrollable body itself, since it's the actual thing a user "signs".
    declaration: { type: String, default: '', trim: true },
    // Bumped whenever the developer publishes an update. TermsGate compares
    // this against what a user last accepted to decide whether re-acceptance
    // is required.
    version: { type: Number, default: 1 },
  },
  { timestamps: true }
);

// Default content — the actual current Terms & Conditions. This is what a
// brand-new deployment (or a fresh singleton row) starts with; the developer
// can edit it afterward via PATCH /terms/current.
const DEFAULT_SECTIONS = [
  { heading: '1. Invoice Accuracy', body: 'The Customer is solely responsible for verifying the accuracy of invoices, quotations, taxes, pricing, discounts and customer information before issuing documents.' },
  { heading: '2. GST & Tax Compliance', body: 'Customers are solely responsible for GST registration, GST rates, HSN/SAC codes, filings and compliance. SkyUp does not provide tax or legal advice.' },
  { heading: '3. Accounting Responsibility', body: 'The software is not a substitute for professional accounting services.' },
  { heading: '4. Financial Reports', body: 'Reports are generated from user-entered data. SkyUp is not responsible for inaccurate reports caused by incorrect entries.' },
  { heading: '5. Invoice Numbering', body: 'Customers are responsible for maintaining legally compliant invoice numbering.' },
  { heading: '6. Customer & Supplier Data', body: 'Customers must maintain accurate customer and supplier information.' },
  { heading: '7. Pricing Responsibility', body: 'Customers must verify pricing, taxes, discounts and charges before issuing invoices.' },
  { heading: '8. Inventory Accuracy', body: 'Inventory balances depend on user entries and should be verified.' },
  { heading: '9. Stock Valuation', body: 'Inventory valuation reports should be independently verified.' },
  { heading: '10. Purchase Management', body: 'Customers are responsible for validating purchase entries and supplier records.' },
  { heading: '11. Payment Records', body: 'Customers must maintain accurate payment records and bank reconciliation.' },
  { heading: '12. Outstanding Balances', body: 'Outstanding reports should be independently verified before recovery actions.' },
  { heading: '13. Credit/Debit Notes', body: 'Customers are responsible for compliance with applicable accounting and GST regulations.' },
  { heading: '14. Multi-User Responsibility', body: 'Organizations must assign proper permissions and are responsible for actions under valid accounts.' },
  { heading: '15. Deleted Records', body: 'Deleting financial records may affect reports and cannot always be reversed.' },
  { heading: '16. Invoice PDF Generation', body: 'Customers should review all PDFs before sharing.' },
  { heading: '17. Emailing Invoices', body: 'Customers are responsible for recipient email accuracy.' },
  { heading: '18. Digital Signatures', body: 'Customers are responsible for lawful use of uploaded signatures.' },
  { heading: '19. Currency Handling', body: 'Customers must verify currency and exchange rates where applicable.' },
  { heading: '20. Data Import', body: 'Imported data should be verified before use.' },
  { heading: '21. Data Export', body: "Exported files become the customer's responsibility after download." },
  { heading: '22. Financial Backup', body: 'Customers should maintain independent backups.' },
  { heading: '23. Third-Party Payment Gateway', body: "Payment gateway services are governed by third-party terms." },
  { heading: '24. Barcode & QR Codes', body: 'Customers should verify barcode/QR data before printing.' },
  { heading: '25. Business Compliance', body: 'Customers remain responsible for compliance with applicable business laws.' },
  { heading: '26. Fraud Prevention', body: 'Customers must safeguard credentials and financial records.' },
  { heading: '27. Audit Responsibility', body: 'Customers are responsible for statutory record retention.' },
  { heading: '28. Limitation of Financial Liability', body: 'SkyUp is not liable for tax penalties, accounting errors, business losses or statutory non-compliance resulting from user actions.' },
  { heading: '29. Software Availability', body: 'Temporary downtime due to maintenance or third-party services shall not constitute breach.' },
  { heading: '30. Acceptance of Generated Documents', body: 'Documents generated through the software are deemed approved once downloaded, printed or shared.' },
];

const DEFAULT_INTRO = 'This document contains  industry-standard Terms & Conditions for the SkyUp CRM Software.';

const DEFAULT_DECLARATION = 'I acknowledge that I have read and agree to the SkyUp CRM Software Terms & Conditions. I understand that I am solely responsible for the accuracy of invoices, tax calculations, GST compliance, accounting records, customer and supplier information, inventory records, payment entries and statutory obligations. SkyUp provides software tools only and does not provide accounting, taxation or legal advice.';

termsSchema.statics.getSingleton = async function () {
  let doc = await this.findOne({ singleton: 'terms' });
  if (!doc) {
    doc = await this.create({
      singleton: 'terms',
      title: 'SkyUp CRM — Terms & Conditions',
      intro: DEFAULT_INTRO,
      sections: DEFAULT_SECTIONS,
      declaration: DEFAULT_DECLARATION,
    });
  }
  return doc;
};

termsSchema.methods.toSafeJSON = function () {
  return {
    title: this.title,
    effectiveDate: this.effectiveDate,
    intro: this.intro,
    sections: this.sections,
    declaration: this.declaration,
    version: this.version,
    updatedAt: this.updatedAt,
  };
};

export const Terms = mongoose.model('Terms', termsSchema);