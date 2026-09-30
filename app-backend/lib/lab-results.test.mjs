import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createLabResultsHttp, readLabResults, validateLabResults } from './lab-results.mjs';

// Synthetic fixtures only. Never commit measured athlete results to this repository.
const env = { TRAINING_DATA_GITHUB_REPO: 'example/private-records', TRAINING_DATA_GITHUB_TOKEN: 'dummy-test-token', TRAINING_DATA_GITHUB_BRANCH: 'main' };
const revision = 'a'.repeat(40), fileSha = 'b'.repeat(40);
function fixture() { return { schema_version: 1, reports: [{
  id: 'synthetic-report', title: 'Example panel', laboratory: 'Example laboratory', collected_date: '2000-01-02', reported_date: '2000-01-03', fasting: true,
  source_filename: 'example.pdf', patient_id: 'must-not-leave-server',
  results: [{ id: 'example-marker', name: 'Example marker', section: 'Example group', value: 42, unit: 'example units', reference: '<40', flag: 'H',
    risk_ranges: 'Optimal <40; Moderate 40–60; High >60.', population_reference: 'Example population: 20–80.', notes: null, source_page: 1 }],
}] }; }
function response(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } }); }
function githubMock({ payload = fixture(), isPrivate = true, fileStatus = 200, branchStatus = 200, metadataStatus = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/repos/example/private-records')) return response({ private: isPrivate }, metadataStatus);
    if (url.includes('/commits/')) return response({ sha: revision }, branchStatus);
    if (url.includes('/contents/lab-tests/clinical-labs.json')) return response({ encoding: 'base64', sha: fileSha, content: Buffer.from(JSON.stringify(payload)).toString('base64') }, fileStatus);
    throw Error('Unexpected request');
  };
  return { calls, fetchImpl };
}
function mockRes() { return { status: null, headers: {}, body: '', writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body) { this.body = body; } }; }

test('preserves reported flags, reference inequalities and separate risk bands', () => {
  const result = validateLabResults(fixture()).reports[0].results[0];
  assert.equal(result.flag, 'H');
  assert.equal(result.reference, '<40');
  assert.equal(result.risk_ranges, 'Optimal <40; Moderate 40–60; High >60.');
  assert.equal(result.value, 42);
});
test('projects only display fields, excluding extra identifiers', () => {
  const result = validateLabResults(fixture());
  assert.equal(result.reports[0].patient_id, undefined);
  assert.ok(!JSON.stringify(result).includes('must-not-leave-server'));
});
test('accepts categorical results without invented numeric ranges', () => {
  const f = fixture(); Object.assign(f.reports[0].results[0], { value: 'Example A', unit: '', reference: 'Example A', flag: null });
  assert.equal(validateLabResults(f).reports[0].results[0].value, 'Example A');
});
test('rejects unsupported schemas and malformed dates, values or flags', () => {
  assert.throws(() => validateLabResults({ schema_version: 2, reports: [] }));
  for (const invalid of ['2000-02-30', 'yesterday', '2000-01-02T00:00:00Z']) {
    const f = fixture(); f.reports[0].collected_date = invalid; assert.throws(() => validateLabResults(f));
  }
  for (const value of [NaN, Infinity, null, {}]) {
    const f = fixture(); f.reports[0].results[0].value = value; assert.throws(() => validateLabResults(f));
  }
  const f = fixture(); f.reports[0].results[0].flag = 'diagnosis'; assert.throws(() => validateLabResults(f));
});
test('rejects duplicate report and result IDs', () => {
  const f = fixture(); f.reports.push(structuredClone(f.reports[0])); assert.throws(() => validateLabResults(f));
  const g = fixture(); g.reports[0].results.push(structuredClone(g.reports[0].results[0])); assert.throws(() => validateLabResults(g));
});
test('reads a private, commit-pinned record without requiring an AI key', async () => {
  const mock = githubMock(); const result = await readLabResults({ env, fetchImpl: mock.fetchImpl });
  assert.equal(result.reports.length, 1); assert.equal(result.source_file_sha, fileSha);
  assert.ok(mock.calls[2].url.endsWith('?ref=' + revision));
  assert.ok(mock.calls.every(({ options }) => options.method === 'GET' && options.cache === 'no-store' && options.redirect === 'error'));
});
test('does not read clinical files from a public repository', async () => {
  const mock = githubMock({ isPrivate: false });
  await assert.rejects(readLabResults({ env, fetchImpl: mock.fetchImpl }), /private training-data repository/);
  assert.equal(mock.calls.length, 1);
});
test('distinguishes a missing lab file from authentication and branch failures', async () => {
  assert.deepEqual((await readLabResults({ env, fetchImpl: githubMock({ fileStatus: 404 }).fetchImpl })).reports, []);
  await assert.rejects(readLabResults({ env, fetchImpl: githubMock({ metadataStatus: 403 }).fetchImpl }));
  await assert.rejects(readLabResults({ env, fetchImpl: githubMock({ branchStatus: 404 }).fetchImpl }), /branch/);
  await assert.rejects(readLabResults({ env, fetchImpl: githubMock({ fileStatus: 500 }).fetchImpl }));
});
test('rejects invalid configuration before network access', async () => {
  const fetchImpl = async () => { throw Error('should not be called'); };
  await assert.rejects(readLabResults({ env: {}, fetchImpl }), /Configure/);
  await assert.rejects(readLabResults({ env: { ...env, TRAINING_DATA_GITHUB_REPO: '../other' }, fetchImpl }), /Configure/);
});
test('requires an authenticated app session before fetching private records', async () => {
  const mock = githubMock(); const handler = createLabResultsHttp({ env: () => env, fetchImpl: mock.fetchImpl });
  const res = mockRes(); assert.equal(await handler({ method: 'GET' }, res, '/api/labs'), true);
  assert.equal(res.status, 401); assert.equal(res.headers['Cache-Control'], 'no-store'); assert.equal(mock.calls.length, 0);
});
test('GET works after authentication; writes are rejected', async () => {
  const mock = githubMock(); const handler = createLabResultsHttp({ env: () => env, fetchImpl: mock.fetchImpl });
  const res = mockRes(); await handler({ method: 'GET', appSession: {} }, res, '/api/labs');
  assert.equal(res.status, 200); assert.equal(JSON.parse(res.body).reports.length, 1);
  assert.equal(res.headers['Cache-Control'], 'no-store'); assert.equal(res.headers['X-Content-Type-Options'], 'nosniff');
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    const denied = mockRes(); await handler({ method, appSession: {} }, denied, '/api/labs');
    assert.equal(denied.status, 405); assert.equal(denied.headers.Allow, 'GET');
  }
  assert.equal(mock.calls.length, 3);
});
test('ignores other routes and never echoes raw upstream errors or credentials', async () => {
  const handler = createLabResultsHttp({ env: () => env, fetchImpl: async () => { throw Error('secret-upstream-detail'); } });
  assert.equal(await handler({ method: 'GET', appSession: {} }, mockRes(), '/api/unrelated'), false);
  const res = mockRes(); await handler({ method: 'GET', appSession: {} }, res, '/api/labs');
  assert.equal(res.status, 502); assert.ok(!res.body.includes('secret-upstream-detail')); assert.ok(!res.body.includes(env.TRAINING_DATA_GITHUB_TOKEN));
});
test('desktop routing and mobile panels include labs without adding a sixth bottom-nav item', () => {
  const app = fs.readFileSync(new URL('../../ui/src/App.tsx', import.meta.url), 'utf8');
  const tabs = fs.readFileSync(new URL('../../ui/src/components/ui/navbars.tsx', import.meta.url), 'utf8');
  const menu = fs.readFileSync(new URL('../../ui/src/components/ui/mobile-header-menu.tsx', import.meta.url), 'utf8');
  assert.match(app, /pathname === "\/labs"/); assert.match(app, /<LabResultsPage \/>/);
  assert.match(tabs, /pageDestinations\.map/); assert.match(tabs, /destinations\.map\(\(\{ label, displayLabel/);
  assert.match(menu, /detail: "Lab Results"/);
});
