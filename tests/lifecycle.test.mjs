// End-to-end-ish test of the REAL controller/scheduler code with the DB stubbed.
// Run from the server folder: TZ=Asia/Kolkata NODE_ENV=test node tests/lifecycle.test.mjs
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
mongoose.set('bufferCommands', false);

// ---- controllable clock --------------------------------------------------
const RealDate = Date; let clock = new RealDate('2026-10-30T08:30:00Z').getTime();
class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(clock); } static now() { return clock; } }
RealDate.now = () => clock;   // schema defaults (`default: Date.now`) pick this up
const at = (iso) => { clock = new RealDate(iso).getTime(); };

const base = '../src';
const { Lead } = await import(`${base}/models/Lead.js`);
const { Company } = await import(`${base}/models/Company.js`);
const leadCtl = await import(`${base}/controllers/lead.controller.js`);
const { tick } = await import(`${base}/utils/monthlyStageResetScheduler.js`);

const reportCtl = await import(`${base}/controllers/report.controller.js`);
const { Order } = await import(`${base}/models/Order.js`);
const { Invoice } = await import(`${base}/models/Invoice.js`);
const { User } = await import(`${base}/models/User.js`);
const { Attendance } = await import(`${base}/models/Attendance.js`);
const { AttendanceConfig } = await import(`${base}/models/AttendanceConfig.js`);
globalThis.Date = FakeDate;   // installed AFTER models load (Mongoose binds `Date` at schema build)

const COMPANY = new mongoose.Types.ObjectId(); const USER = new mongoose.Types.ObjectId();
const mk = (name, status, createdIso) => { at(createdIso); const l = new Lead({ company: COMPANY, name, mobile: '5' + Math.random().toString().slice(2, 10), status, owner: USER, ownerName: 'Sam', createdAt: new RealDate(createdIso), updatedAt: new RealDate(createdIso) }); l.save = async function () { this.updatedAt = new RealDate(clock); return this; }; return l; };

const DB = [];                                            // fake collection
Lead.findOne = async (q) => DB.find((l) => String(l._id) === String(q._id));
Lead.find = (q) => ({ sort: () => ({ lean: async () => DB.map((l) => l.toObject()) }) });
Company.find = () => ({ select: () => ({ lean: async () => [{ _id: COMPANY, name: 'Co' }] }) });
// minimal Mongo semantics for the scheduler's updateMany
Lead.updateMany = async (filter, update) => {
  const hits = DB.filter((l) => String(l.company) === String(filter.company) && l.status === filter.status &&
    (!filter.updatedAt?.$lt || l.updatedAt < filter.updatedAt.$lt));
  hits.forEach((l) => { Object.assign(l, update.$set); l.editHistory.push(update.$push.editHistory); l.updatedAt = new RealDate(clock); });
  return { modifiedCount: hits.length };
};

const admin = { _id: USER, role: 'admin', name: 'Sam', company: COMPANY };
const call = async (fn, req) => { let out; await fn({ query: {}, params: {}, body: {}, user: admin, ...req }, { json: (x) => (out = x), status() { return this; } }, (e) => { throw e; }); return out; };
const list = async (query) => (await call(leadCtl.listLeads, { query })).leads;
const find = (arr, l) => arr.find((x) => String(x._id) === String(l._id));
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('  ✓', name); };

// ===== Scenario 1 — the one you described =====
const cust = mk('Customer A', 'Interested', '2026-10-05T04:00:00Z'); DB.push(cust);
at('2026-10-30T08:30:00Z');                                          // 30 Oct 14:00 IST — order placed
await call(leadCtl.markLeadBuyer, { params: { id: cust._id }, body: { orderNo: 101 } });
ok('30 Oct: live status is Won', () => assert.equal(cust.status, 'Won'));

at('2026-10-31T17:00:00Z');                                          // 31 Oct 22:30 IST — month not over
await tick();
ok('31 Oct tick does NOT reset a Buyer', () => assert.equal(cust.status, 'Won'));

at('2026-10-31T18:36:00Z');                                          // 1 Nov 00:06 IST
await tick();
ok('1 Nov: reset to Interested', () => assert.equal(cust.status, 'Interested'));
ok('reset history entry uses a real status value', () => assert.equal(cust.editHistory.at(-1).changes[0].to, 'Interested'));
ok('converted stays true (still has an order)', () => assert.equal(cust.converted, true));

at('2026-11-02T06:00:00Z');
const r30 = find(await list({ asOf: '2026-10-30', from: '2026-10-30', tz: '-330' }), cust);
ok('REPORT 30 Oct → customer present as Buyer (Won)', () => { assert.ok(r30); assert.equal(r30.status, 'Won'); assert.equal(r30.currentStatus, 'Interested'); });
ok('report does not leak editHistory to the browser', () => assert.equal(r30.editHistory, undefined));
const rNov = find(await list({ asOf: '2026-11-30', from: '2026-11-01', tz: '-330' }), cust);
ok('REPORT November → same customer present as Opportunity (Interested)', () => { assert.ok(rNov); assert.equal(rNov.status, 'Interested'); });
const rOctAll = find(await list({ asOf: '2026-10-31', from: '2026-10-01', tz: '-330' }), cust);
ok('REPORT whole October → Buyer', () => assert.equal(rOctAll.status, 'Won'));
const live = find(await list({}), cust);
ok('Live list (no date) → Interested', () => assert.equal(live.status, 'Interested'));

// ===== Scenario 2 — bought on the 1st, after midnight =====
const early = mk('Customer B', 'Interested', '2026-10-01T04:00:00Z'); DB.push(early);
at('2026-10-31T18:31:00Z');                                          // 1 Nov 00:01 IST
await call(leadCtl.markLeadBuyer, { params: { id: early._id }, body: { orderNo: 102 } });
at('2026-10-31T18:40:00Z'); await tick();
ok('bought 00:01 on the 1st → stays Buyer (this month\'s sale)', () => assert.equal(early.status, 'Won'));

// ===== Scenario 3 — server was down on the 1st, catches up on the 2nd =====
const late = mk('Customer C', 'Interested', '2026-10-02T04:00:00Z'); DB.push(late);
at('2026-10-29T08:00:00Z'); await call(leadCtl.markLeadBuyer, { params: { id: late._id }, body: { orderNo: 103 } });
at('2026-11-02T09:00:00Z'); await tick();
ok('missed 1st → reset on next tick (catch-up)', () => assert.equal(late.status, 'Interested'));
const lateNov = find(await list({ asOf: '2026-11-02', from: '2026-11-01', tz: '-330' }), late);

// ===== Scenario 4 — repeat purchase in November, reset in December =====
at('2026-11-05T09:00:00Z'); await call(leadCtl.markLeadBuyer, { params: { id: cust._id }, body: { orderNo: 104 } });
ok('Nov 5 repurchase → Buyer again', () => assert.equal(cust.status, 'Won'));
at('2026-11-20T09:00:00Z'); await tick();
ok('mid-month tick leaves this month\'s Buyer alone', () => assert.equal(cust.status, 'Won'));
at('2026-11-30T18:36:00Z'); await tick();                            // 1 Dec 00:06 IST
ok('1 Dec → Opportunity again', () => assert.equal(cust.status, 'Interested'));
const nov = find(await list({ asOf: '2026-11-30', from: '2026-11-01', tz: '-330' }), cust);
ok('November report → Buyer (repurchase on 5 Nov)', () => assert.equal(nov.status, 'Won'));
const dec = find(await list({ asOf: '2026-12-02', from: '2026-12-01', tz: '-330' }), cust);
ok('December report → Opportunity (reset on 1 Dec)', () => assert.equal(dec.status, 'Interested'));

// ===== Scenario 5 — report endpoints (daily report, monthly comparison, dashboard) =====
const chain = (arr) => { const c = { sort: () => c, select: () => c, populate: () => c, lean: async () => arr, then: (r, j) => Promise.resolve(arr).then(r, j) }; return c; };
Order.find = () => chain([]); Invoice.find = () => chain([]); User.find = () => chain([]); Attendance.find = () => chain([]);
AttendanceConfig.getForCompany = () => Promise.reject(new Error('stub'));
const rawLeads = () => DB.map((l) => l.toObject());
Lead.find = (q) => {
  let arr = rawLeads();
  if (q?.createdAt) arr = arr.filter((l) => new RealDate(l.createdAt) >= q.createdAt.$gte && new RealDate(l.createdAt) <= q.createdAt.$lte);
  if (q?.followUpAt) arr = [];
  return chain(arr);
};
// Customer D: created AND bought on 30 Oct (09:00Z), auto-reset on 1 Nov
const d = mk('Customer D', 'New', '2026-10-30T03:00:00Z'); DB.push(d);
at('2026-10-30T09:00:00Z'); await call(leadCtl.markLeadBuyer, { params: { id: d._id }, body: { orderNo: 110 } });
at('2026-11-30T18:36:00Z'); await tick();      // (also resets anything else still Won)
at('2026-12-03T06:00:00Z');
const day30 = await call(reportCtl.dailyReport, { query: { date: '2026-10-30' } });
ok('DAILY report for 30 Oct (run in Dec) → Buyer count 1, row says Won', () => {
  assert.equal(day30.summary.converted, 1);
  assert.equal(day30.leads.find((x) => x.name === 'Customer D').status, 'Won');
});
const mc = await call(reportCtl.monthlyComparison, {});
const octRow = mc.months.find((m) => m.key === '2026-10');
ok('MONTHLY comparison Oct row still counts Oct\'s Buyers after resets', () => assert.ok(octRow.buyers >= 2, JSON.stringify(octRow)));
ok('MONTHLY comparison: reset customers are not double counted as Buyers now', () => assert.equal(mc.months.at(-1).buyers, 0));
const dash = await call(reportCtl.dashboard ?? reportCtl.overview ?? reportCtl.summary, { query: { range: 'monthly' } });
ok('DASHBOARD Buyers = current Buyers only (converted flag no longer counts)', () => assert.equal(dash.stats.buyers, 0));
ok('DASHBOARD buyers-over-time keeps the Oct/Nov buyers', () => assert.ok(dash.leads.overTime.reduce((a, b) => a + b.converted, 0) >= 3));

console.log(`\n${n} checks passed`);
