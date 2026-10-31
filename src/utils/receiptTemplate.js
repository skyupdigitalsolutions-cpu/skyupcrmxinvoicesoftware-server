// receiptTemplate.js — the RECEIPT VOUCHER template.
//
// The voucher layout (A4 portrait, boxes, dotted rows, Arabic labels) lives in
// utils/receiptPdf.js. Everything on it that is *content* — and therefore what
// you edit to rebrand the receipt — is defined here, in one place.
//
// This is copied from the company's printed receipt book. Only the company
// name changes per company: it is read from Company Branding (legalName /
// legalNameAr) and falls back to nameEn / nameAr below.

export const RECEIPT_TEMPLATE = {
  // Fallback company name (used when Branding has none).
  nameEn: 'NEO SPOTEK TRADING L.L.C.',
  nameAr: 'نيو سبوتك للتجارة ش.ذ.م.م.',

  // Phone lines under the logo. icon: 'desk' | 'mobile'. whatsapp: true adds the WhatsApp mark.
  phones: [
    { icon: 'desk', text: '+971 4 2369059 (Office)' },
    { icon: 'mobile', text: '+971 56 5245049 (Accounts)' },
    { icon: 'mobile', text: '+971 58 6198100', whatsapp: true },
  ],

  // Address lines (right side, under the company name), website and e-mail.
  address: [
    'Shop: M23, P.O.Box: 112507, Al Anood Center',
    'Al Musalla Road, Near Souq Al Wasl, Deira-Dubai-U.A.E',
  ],
  website: 'www.wakshw.co',
  email: 'altowarstardxb@gmail.com',

  // File name used for the blank, print-and-fill version.
  blankFilename: 'Receipt-Voucher-Template-A4.pdf',
};
