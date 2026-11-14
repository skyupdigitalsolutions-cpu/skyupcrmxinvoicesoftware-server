// middleware/connectorAuth.js
// Authenticates the Windows Tally connector (NOT a user). The connector sends
//   Authorization: Bearer tcn_<random>
// We hash it and look up an ACTIVE connector. Tokens are never logged.
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { ApiError } from '../utils/ApiError.js';
import { TallyConnector } from '../models/TallyConnector.js';
import { Company } from '../models/Company.js';
import { subscriptionState } from '../utils/subscriptionStatus.js';

export const CONNECTOR_TOKEN_PREFIX = 'tcn_';

export const hashConnectorToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

export const generateConnectorToken = () => {
  const token = CONNECTOR_TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
  return { token, tokenHash: hashConnectorToken(token), tokenPrefix: token.slice(0, 10) };
};

export const connectorAuth = async (req, _res, next) => {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token || !token.startsWith(CONNECTOR_TOKEN_PREFIX) || token.length > 200) {
      throw new ApiError(401, 'Connector not authenticated');
    }

    const connector = await TallyConnector.findOne({ tokenHash: hashConnectorToken(token), active: true });
    if (!connector) throw new ApiError(401, 'Connector token invalid or revoked');

    const company = await Company.findById(connector.company).lean();
    if (!company || company.active === false) throw new ApiError(403, 'Company account is deactivated');
    if (subscriptionState(company).paused) throw new ApiError(402, 'Company subscription is paused');

    req.connector = connector;
    req.connectorCompany = company;
    next();
  } catch (err) {
    next(err);
  }
};

// Separate limiter for connector traffic (10 s polling ≈ 90 req / 15 min).
export const connectorLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Connector is polling too fast.' },
});
