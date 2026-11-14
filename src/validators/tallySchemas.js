// validators/tallySchemas.js — request schemas for /api/tally (used with middleware/validate.js)
import * as yup from 'yup';
import { objectId } from './schemas.js';
import { TALLY_MAPPING_KINDS } from '../models/TallyMapping.js';

export const TALLY_ERROR_CODES = [
  'TALLY_UNAVAILABLE', 'TALLY_TIMEOUT', 'AMBIGUOUS_TIMEOUT', 'COMPANY_MISMATCH', 'CURRENCY_MISMATCH',
  'UNMAPPED_MASTER', 'TALLY_IMPORT_ERROR', 'DUPLICATE_REFERENCE', 'VERIFY_FAILED', 'UNEXPECTED_RESPONSE',
  'INVALID_PAYLOAD', 'UNSUPPORTED_TYPE', 'VOUCHER_NOT_FOUND', 'VOUCHER_CANCELLED', 'INTERNAL_ERROR',
];

const str = (max) => yup.string().trim().max(max);
const idParam = yup.object({ id: objectId.required() });

const settingsShape = yup.object({
  tallyCompanyName:         str(120).notRequired(),
  baseCurrency:             str(10).notRequired(),
  salesOrderVoucherType:    str(80).notRequired(),
  purchaseOrderVoucherType: str(80).notRequired(),
  salesLedger:              str(120).notRequired(),
  purchaseLedger:           str(120).notRequired(),
  godown:                   str(120).notRequired(),
  timezone:                 str(60).notRequired(),
}).default(undefined).notRequired();

// ── Admin ────────────────────────────────────────────────────────────────────
export const createConnectorSchema = {
  body: yup.object({ name: str(80).notRequired(), settings: settingsShape }),
};
export const updateConnectorSchema = {
  params: idParam,
  body: yup.object({ name: str(80).notRequired(), settings: settingsShape }),
};
export const connectorIdSchema = { params: idParam };

export const syncSchema = {
  params: yup.object({
    type: yup.string().oneOf(['sales-order', 'purchase-order']).required(),
    id: objectId.required(),
  }),
};

export const syncStatusSchema = {
  body: yup.object({
    type: yup.string().oneOf(['SALES_ORDER', 'PURCHASE_ORDER']).required(),
    ids: yup.array().of(objectId.required()).max(1000).required(),
  }),
};

export const listJobsSchema = {
  query: yup.object({
    status: yup.string().oneOf(['PENDING', 'PROCESSING', 'SYNCED', 'FAILED', 'NEEDS_REVIEW', 'DETACHED']).notRequired(),
    limit: yup.number().integer().min(1).max(200).default(50),
    company: objectId.notRequired(),
  }),
};

export const jobIdSchema = { params: idParam };

export const resolveJobSchema = {
  params: idParam,
  body: yup.object({
    outcome: yup.string().oneOf(['SYNCED', 'DETACHED']).required(),
    note: str(500).required('Add a note explaining what was done in Tally'),
    tallyVoucherNumber: str(80).notRequired(),
  }),
};

const mappingItem = yup.object({
  kind: yup.string().oneOf(TALLY_MAPPING_KINDS).required(),
  crmValue: str(200).notRequired(),   // customer / supplier / unit
  modelCode: str(120).notRequired(),  // item
  size: str(60).notRequired(),        // item ('' or '*' = any size)
  tallyName: str(200).min(1).required('Tally name is required'),
  tallyUnit: str(40).notRequired(),
});

export const upsertMappingSchema = { body: mappingItem };
export const bulkMappingSchema = { body: yup.object({ mappings: yup.array().of(mappingItem).min(1).max(500).required() }) };
export const listMappingsSchema = {
  query: yup.object({ kind: yup.string().oneOf(TALLY_MAPPING_KINDS).notRequired(), company: objectId.notRequired() }),
};
export const mappingIdSchema = { params: idParam };

// ── Connector (agent) ────────────────────────────────────────────────────────
export const heartbeatSchema = {
  body: yup.object({
    agentVersion: str(40).default(''),
    hostname: str(120).default(''),
    tallyReachable: yup.boolean().default(false),
    loadedCompanies: yup.array().of(str(200)).max(50).default([]),
    companyOk: yup.boolean().default(false),
    currencyOk: yup.boolean().default(false),
    message: str(500).default(''),
  }),
};

export const jobSuccessSchema = {
  params: idParam,
  body: yup.object({
    leaseId: str(100).required(),
    verified: yup.boolean().oneOf([true], 'Voucher must be verified in Tally before reporting success').required(),
    reconciled: yup.boolean().default(false),
    tallyVoucherNumber: str(80).default(''),
    tallyMasterId: str(80).default(''),
    tallyGuid: str(120).default(''),
    message: str(500).default(''),
  }),
};

export const jobFailureSchema = {
  params: idParam,
  body: yup.object({
    leaseId: str(100).required(),
    code: yup.string().oneOf(TALLY_ERROR_CODES).required(),
    message: str(1000).default(''),
    retryable: yup.boolean().default(false),
    needsReview: yup.boolean().default(false),
    details: yup.mixed().notRequired(),
  }),
};
