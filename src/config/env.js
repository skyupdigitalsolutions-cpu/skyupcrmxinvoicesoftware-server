import dotenv from 'dotenv';
dotenv.config();

const required = ['MONGO_URI', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'];
const missing = required.filter((k) => !process.env[k] || process.env[k].startsWith('replace_'));
if (missing.length && process.env.NODE_ENV !== 'test') {
  console.warn(`⚠  Missing/placeholder env vars: ${missing.join(', ')}. See .env.example`);
}

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 5000,
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  mongoUri: process.env.MONGO_URI,
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    accessExpires: process.env.JWT_ACCESS_EXPIRES || '15m',
    refreshExpires: process.env.JWT_REFRESH_EXPIRES || '7d',
  },
  isProd: process.env.NODE_ENV === 'production',

  // ── Brevo (platform-level) ────────────────────────────────────────────────
  // Used for system emails: password reset, etc.
  // Set these in your .env file:
  //   BREVO_API_KEY       = xkeysib-…
  //   BREVO_SENDER_EMAIL  = no-reply@yourplatform.com  (must be verified in Brevo)
  //   BREVO_SENDER_NAME   = Your Platform Name
  brevo: {
    apiKey:      process.env.BREVO_API_KEY      || '',
    senderEmail: process.env.BREVO_SENDER_EMAIL || '',
    senderName:  process.env.BREVO_SENDER_NAME  || 'CRM Platform',
  },
};