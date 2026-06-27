/**
 * Multi-tenant isolation test — verifies one company can NEVER see or touch
 * another company's data. Run against a RUNNING server (local or staging).
 *
 *   node src/utils/testTenantIsolation.js
 *
 * Env:
 *   API_URL        base URL (default http://localhost:5000/api)
 *   DEV_USERNAME   developer login (default "developer")
 *   DEV_PASSWORD   developer password (default "developer123")
 *
 * It creates two throwaway companies (slugs prefixed "isotest-"), an admin in
 * each, seeds a lead+order in each, then asserts cross-company access is denied.
 * Nothing is left enabled — the test companies are deactivated at the end
 * (full delete is blocked while users exist, by design).
 */

const API = process.env.API_URL || 'http://127.0.0.1:5000/api';
const DEV_USERNAME = process.env.DEV_USERNAME || 'developer';
const DEV_PASSWORD = process.env.DEV_PASSWORD || 'developer123';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓', msg); } else { fail++; console.log('  ✗ FAIL:', msg); } };

const req = async (method, path, { token, body } = {}) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* non-json */ }
  return { status: res.status, data };
};

const login = async (username, password) => {
  const { status, data } = await req('POST', '/auth/login', { body: { username, password } });
  if (status !== 200 || !data?.accessToken) throw new Error(`login failed for ${username} (${status})`);
  return data.accessToken;
};

const run = async () => {
  const stamp = Date.now();
  console.log(`\nMulti-tenant isolation test → ${API}\n`);

  // Preflight: confirm the server is reachable before doing anything else.
  try {
    const h = await fetch(`${API}/health`);
    if (!h.ok) throw new Error(`health check returned ${h.status}`);
  } catch (e) {
    console.error(`✗ Cannot reach the API at ${API}`);
    console.error('  - Is the server running? (npm run dev)');
    console.error('  - Try setting API_URL explicitly, e.g.:');
    console.error('      $env:API_URL="http://127.0.0.1:5000/api"; node src/utils/testTenantIsolation.js');
    console.error(`  - underlying error: ${e.message}`);
    process.exit(1);
  }

  // Developer login
  const devToken = await login(DEV_USERNAME, DEV_PASSWORD);
  console.log('• developer authenticated');

  // Create two companies
  const mk = async (n) => {
    const { status, data } = await req('POST', '/companies', {
      token: devToken,
      body: { name: `IsoTest ${n} ${stamp}`, slug: `isotest-${n}-${stamp}`, limits: { maxAdmins: 2, maxEmployees: 5 } },
    });
    if (status !== 201) throw new Error(`company ${n} create failed (${status})`);
    return data.company.id;
  };
  const compA = await mk('A');
  const compB = await mk('B');
  console.log('• created companies A & B');

  // Provision an admin in each
  const mkAdmin = async (companyId, tag) => {
    const username = `isoadmin_${tag}_${stamp}`;
    const { status } = await req('POST', `/companies/${companyId}/admin`, {
      token: devToken, body: { name: `Admin ${tag}`, username, password: 'test1234' },
    });
    if (status !== 201) throw new Error(`admin ${tag} create failed (${status})`);
    return login(username, 'test1234');
  };
  const tokenA = await mkAdmin(compA, 'a');
  const tokenB = await mkAdmin(compB, 'b');
  console.log('• provisioned admin A & admin B\n');

  // Seed a lead + order in company A
  const leadA = (await req('POST', '/leads', {
    token: tokenA, body: { name: 'Cust A', mobile: `90000${stamp % 100000}`, country: 'UAE', city: 'AQ', source: 'Walk-in', interest: 'shoes', remark: 'x' },
  })).data?.lead;
  const orderA = (await req('POST', '/orders', {
    token: tokenA, body: { customer: 'Cust A', country: 'UAE', city: 'AQ', mobile: '900', payTerms: 'CASH', items: [{ modelCode: 'A1', description: 'd', unit: 'PAIR', brand: 'b', qty: 1, price: 100 }], discount: 0 },
  })).data?.order;

  console.log('── Isolation assertions ──');

  // A sees its own data
  const aLeads = (await req('GET', '/leads', { token: tokenA })).data?.leads || [];
  const aOrders = (await req('GET', '/orders', { token: tokenA })).data?.orders || [];
  ok(aLeads.some((l) => l._id === leadA?._id), 'Admin A sees its own lead');
  ok(aOrders.some((o) => o._id === orderA?._id), 'Admin A sees its own order');

  // B must NOT see A's data in lists
  const bLeads = (await req('GET', '/leads', { token: tokenB })).data?.leads || [];
  const bOrders = (await req('GET', '/orders', { token: tokenB })).data?.orders || [];
  ok(!bLeads.some((l) => l._id === leadA?._id), 'Admin B does NOT see company A lead in list');
  ok(!bOrders.some((o) => o._id === orderA?._id), 'Admin B does NOT see company A order in list');

  // B must NOT fetch A's records by id (expect 404)
  if (leadA?._id) {
    const r = await req('GET', `/leads/${leadA._id}`, { token: tokenB });
    ok(r.status === 404, `Admin B gets 404 fetching company A lead by id (got ${r.status})`);
  }
  if (orderA?._id) {
    const r = await req('DELETE', `/orders/${orderA._id}`, { token: tokenB });
    ok(r.status === 404, `Admin B cannot delete company A order (got ${r.status})`);
  }

  // B's user list must not include A's users
  const bUsers = (await req('GET', '/users', { token: tokenB })).data?.users || [];
  ok(!bUsers.some((u) => u.username?.includes('_a_')), 'Admin B user list excludes company A admin');

  // Limit enforcement: company B allows 5 employees — create 6th should fail
  let limitHit = false;
  for (let i = 0; i < 6; i++) {
    const r = await req('POST', '/users', {
      token: tokenB, body: { name: `E${i}`, username: `isoemp_${i}_${stamp}`, password: 'test1234', role: 'sales' },
    });
    if (r.status === 403) { limitHit = true; break; }
  }
  ok(limitHit, 'Employee limit is enforced (6th create blocked with 403)');

  // Cleanup: deactivate the test companies (delete is blocked while users exist)
  await req('PATCH', `/companies/${compA}`, { token: devToken, body: { active: false } });
  await req('PATCH', `/companies/${compB}`, { token: devToken, body: { active: false } });
  console.log('\n• test companies deactivated (cleanup)');

  console.log(`\nRESULT: ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
};

run().catch((e) => { console.error('\n✗ test errored:', e.message); process.exit(1); });