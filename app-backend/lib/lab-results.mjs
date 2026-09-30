// Private, read-only laboratory records. No model calls or browser persistence.
const LAB_FILE = 'lab-tests/clinical-labs.json';
const MAX_BYTES = 750000;
class LabResultsError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function text(value, limit = 3000) {
  if (typeof value !== 'string' || value.length > limit) throw new LabResultsError('The saved laboratory record has an unsupported format.');
  return value;
}
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value + 'T12:00:00Z')) || new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) !== value)
    throw new LabResultsError('The saved laboratory record has an invalid date.');
  return value;
}
export function validateLabResults(input) {
  if (!object(input) || input.schema_version !== 1 || !Array.isArray(input.reports) || input.reports.length > 100)
    throw new LabResultsError('The saved laboratory record has an unsupported format.');
  const reportIds = new Set();
  return { schema_version: 1, reports: input.reports.map(report => {
    if (!object(report) || !Array.isArray(report.results) || report.results.length > 300 || ![true, false, null].includes(report.fasting))
      throw new LabResultsError('The saved laboratory record has an unsupported format.');
    const id = text(report.id, 120);
    if (!id || reportIds.has(id)) throw new LabResultsError('The saved laboratory record contains duplicate report identifiers.');
    reportIds.add(id);
    const resultIds = new Set();
    const results = report.results.map(result => {
      if (!object(result) || ![null, 'H', 'L'].includes(result.flag) ||
          !((typeof result.value === 'number' && Number.isFinite(result.value)) || (typeof result.value === 'string' && result.value.length <= 100)) ||
          !Number.isInteger(result.source_page) || result.source_page < 1 || result.source_page > 1000)
        throw new LabResultsError('A saved laboratory result has an unsupported format.');
      const resultId = text(result.id, 120);
      if (!resultId || resultIds.has(resultId)) throw new LabResultsError('The saved laboratory record contains duplicate result identifiers.');
      resultIds.add(resultId);
      return {
        id: resultId, name: text(result.name, 200), section: text(result.section, 200),
        value: result.value, unit: text(result.unit, 80), reference: text(result.reference, 300), flag: result.flag,
        risk_ranges: result.risk_ranges == null ? null : text(result.risk_ranges),
        population_reference: result.population_reference == null ? null : text(result.population_reference),
        notes: result.notes == null ? null : text(result.notes), source_page: result.source_page,
      };
    });
    // Deliberately project only the fields used by the page. Never return patient IDs,
    // credentials, arbitrary extra properties, or the original report's contact details.
    return {
      id, title: text(report.title, 200), laboratory: text(report.laboratory, 200),
      collected_date: date(report.collected_date), reported_date: date(report.reported_date),
      fasting: report.fasting, source_filename: text(report.source_filename, 200), results,
    };
  }).sort((a, b) => b.collected_date.localeCompare(a.collected_date)) };
}
async function boundedJson(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new LabResultsError('The private laboratory source returned no content.');
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) throw new LabResultsError('The saved laboratory file is too large to display.');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new LabResultsError('The private laboratory source returned invalid JSON.'); }
}
export async function readLabResults({ env = process.env, fetchImpl = fetch, signal } = {}) {
  const repo = (env.TRAINING_DATA_GITHUB_REPO || '').trim();
  const token = env.TRAINING_DATA_GITHUB_TOKEN || '';
  const branch = (env.TRAINING_DATA_GITHUB_BRANCH || '').trim() || 'main';
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || repo.split('/').some(part => part === '.' || part === '..') || !token)
    throw new LabResultsError('Configure the private training-data GitHub connection to view laboratory results.', 503);
  const options = {
    method: 'GET', redirect: 'error', cache: 'no-store', signal: signal || AbortSignal.timeout(15000),
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'training-agent-labs' },
  };
  const metadataResponse = await fetchImpl(`https://api.github.com/repos/${repo}`, options);
  if (!metadataResponse.ok) throw new LabResultsError('The private laboratory source could not be accessed. Check the training-data GitHub connection.');
  const metadata = await boundedJson(metadataResponse);
  if (metadata.private !== true) throw new LabResultsError('Laboratory records must be stored in a private training-data repository.', 503);
  const revisionResponse = await fetchImpl(`https://api.github.com/repos/${repo}/commits/${encodeURIComponent(branch)}`, options);
  if (!revisionResponse.ok) throw new LabResultsError('The configured training-data branch could not be read.');
  const revision = await boundedJson(revisionResponse);
  if (!/^[a-f0-9]{40}$/.test(revision.sha || '')) throw new LabResultsError('The private laboratory source returned an invalid revision.');
  const response = await fetchImpl(`https://api.github.com/repos/${repo}/contents/${LAB_FILE}?ref=${revision.sha}`, options);
  if (response.status === 404) return { schema_version: 1, reports: [] };
  if (!response.ok) throw new LabResultsError('The saved laboratory results could not be read. Please try again.');
  const file = await boundedJson(response);
  if (!object(file) || file.encoding !== 'base64' || typeof file.content !== 'string' || !/^[a-f0-9]{40}$/.test(file.sha || ''))
    throw new LabResultsError('The private laboratory source returned an unsupported file.');
  const content = Buffer.from(file.content, 'base64');
  if (content.length > MAX_BYTES) throw new LabResultsError('The saved laboratory file is too large to display.');
  let payload;
  try { payload = JSON.parse(content.toString('utf8')); }
  catch { throw new LabResultsError('The saved laboratory file is not valid JSON.'); }
  return { ...validateLabResults(payload), source_file_sha: file.sha };
}
export function createLabResultsHttp({ env = () => process.env, fetchImpl = fetch } = {}) {
  return async (req, res, pathname) => {
    if (pathname !== '/api/labs') return false;
    const json = (status, payload, extra = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', ...extra });
      res.end(JSON.stringify(payload));
    };
    try {
      if (!req.appSession) throw new LabResultsError('Sign in to your app to view laboratory results.', 401);
      if (req.method !== 'GET') { json(405, { error: 'Method not allowed.' }, { Allow: 'GET' }); return true; }
      json(200, await readLabResults({ env: env(), fetchImpl }));
    } catch (error) {
      json(error instanceof LabResultsError ? error.status : 502, { error: error instanceof LabResultsError
        ? error.message : 'Laboratory results could not be loaded. Please try again.' });
    }
    return true;
  };
}
