// routes/tally.routes.js — mounted at /api/tally
import { Router } from 'express';
import { protect, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { connectorAuth, connectorLimiter } from '../middleware/connectorAuth.js';
import * as c from '../controllers/tally.controller.js';
import * as s from '../validators/tallySchemas.js';

// ── Connector (Windows agent) — connector token, never a user JWT ───────────
const agent = Router();
agent.use(connectorLimiter, connectorAuth);
agent.post('/heartbeat',            validate(s.heartbeatSchema),  c.agentHeartbeat);
agent.post('/jobs/claim',                                          c.agentClaimJob);
agent.post('/jobs/:id/success',     validate(s.jobSuccessSchema), c.agentJobSuccess);
agent.post('/jobs/:id/failure',     validate(s.jobFailureSchema), c.agentJobFailure);

// ── CRM users ────────────────────────────────────────────────────────────────
const users = Router();
users.use(protect);
const admin = authorize('admin', 'developer');

// Badges on Orders / Purchase Orders lists: any signed-in user of the tenant.
users.post('/sync-status', validate(s.syncStatusSchema), c.syncStatus);

users.get('/status', admin, c.getStatus);

users.get('/connectors',               admin, c.listConnectors);
users.post('/connectors',              admin, validate(s.createConnectorSchema), c.createConnector);
users.patch('/connectors/:id',         admin, validate(s.updateConnectorSchema), c.updateConnector);
users.post('/connectors/:id/rotate',   admin, validate(s.connectorIdSchema), c.rotateConnectorToken);
users.post('/connectors/:id/revoke',   admin, validate(s.connectorIdSchema), c.revokeConnector);

users.get('/mappings',                 admin, validate(s.listMappingsSchema), c.listMappings);
users.post('/mappings',                admin, validate(s.upsertMappingSchema), c.upsertMapping);
users.post('/mappings/bulk',           admin, validate(s.bulkMappingSchema), c.bulkUpsertMappings);
users.delete('/mappings/:id',          admin, validate(s.mappingIdSchema), c.deleteMapping);

users.post('/sync/:type/:id',          admin, validate(s.syncSchema), c.syncToTally);
users.get('/jobs',                     admin, validate(s.listJobsSchema), c.listJobs);
users.get('/jobs/:id',                 admin, validate(s.jobIdSchema), c.getJob);
users.post('/jobs/:id/retry',          admin, validate(s.jobIdSchema), c.retryJob);
users.post('/jobs/:id/resolve',        admin, validate(s.resolveJobSchema), c.resolveJob);

const router = Router();
router.use('/agent', agent);
router.use('/', users);
export default router;
