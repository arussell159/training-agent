import http from 'node:http';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createContextStore } from './lib/supabase-context.mjs';
import { addLocalComment, readLocalContext, updateLocalWorkout } from './lib/local-context.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const configPath = path.join(__dirname, 'config.json');
const distPath = path.join(__dirname, 'dist');
const coachingConfigPath = path.join(__dirname, 'coaching-config.json');

const serverState = {
  child: null,
  logs: [],
  pid: null,
};

async function readConfig() {
  try {
    const raw = await fs.readFile(configPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function writeConfig(data) {
  await fs.mkdir(__dirname, { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(data, null, 2));
}

function buildConfigResponse(config) {
  return {
    trainingPeaksConnected: Boolean(config.TP_AUTH_COOKIE),
    openAIConnected: Boolean(config.OPENAI_API_KEY),
    supabaseConnected: Boolean(config.SUPABASE_URL && config.SUPABASE_SECRET_KEY),
    supabaseNeedsUrl: Boolean(config.SUPABASE_SECRET_KEY && !config.SUPABASE_URL),
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 1_000_000) reject(new Error('Request too large')); });
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch (error) { reject(error); } });
  });
}

async function runCoach(message) {
  const config = await readConfig();
  if (!config.OPENAI_API_KEY) throw new Error('OpenAI is not configured');
  const coach = JSON.parse(await fs.readFile(coachingConfigPath, 'utf8'));
  const contextStore = createContextStore(config, updateLogs);
  const local = await readLocalContext();
  let context = { coaching: coach, workouts: local.history, planned: local.planned, comments: local.comments, athlete: local.athlete, metrics: local.metrics };
  if (contextStore.ready) {
    try { context = { ...context, ...await contextStore.getContext() }; } catch (error) { updateLogs(`context read failed: ${error.message}`); }
  }
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.OPENAI_MODEL || 'gpt-5-mini', store: false, max_output_tokens: 350,
      instructions: `${coach.vision}\n${coach.rules.join('\n')}\nRespond in 1-4 short sentences. If proposing a TrainingPeaks change, ask for approval.`,
      input: `90-day athlete context:\n${JSON.stringify(context).slice(0, 70000)}\n\nAthlete: ${message}`,
    }),
  });
  if (!response.ok) throw new Error(`OpenAI request failed (${response.status})`);
  const data = await response.json();
  return data.output_text || data.output?.flatMap(item => item.content || []).find(item => item.type === 'output_text')?.text || 'No coaching response returned.';
}

function updateLogs(message) {
  serverState.logs.push(message);
  if (serverState.logs.length > 200) {
    serverState.logs.shift();
  }
}

function stopProcess() {
  if (!serverState.child) return;

  try {
    serverState.child.kill('SIGTERM');
  } catch {
    // ignore
  }

  serverState.child = null;
  serverState.pid = null;
}

function startServer() {
  if (serverState.child) {
    return { running: true, pid: serverState.pid, message: 'Server already running.' };
  }

  const projectRoot = path.resolve(__dirname, '..');
  const child = spawn('node', ['dist/index.js'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      ...(readConfigSync() || {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  serverState.child = child;
  serverState.pid = child.pid;

  child.stdout.on('data', (data) => {
    const text = data.toString();
    updateLogs(text.trim());
  });

  child.stderr.on('data', (data) => {
    const text = data.toString();
    updateLogs(text.trim());
  });

  child.on('exit', (code, signal) => {
    updateLogs(`Child exited with code=${code} signal=${signal ?? 'none'}`);
    serverState.child = null;
    serverState.pid = null;
  });

  return { running: true, pid: child.pid, message: 'Server started.' };
}

function readConfigSync() {
  try {
    const raw = fsSync.readFileSync(configPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/api/config') {
      if (req.method === 'GET') {
        const config = await readConfig();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(buildConfigResponse(config)));
        return;
      }

      if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
          try {
            const payload = JSON.parse(body || '{}');
            const current = await readConfig();
            const next = {
              ...current,
              ...(payload.TP_AUTH_COOKIE ? { TP_AUTH_COOKIE: payload.TP_AUTH_COOKIE } : {}),
              ...(payload.OPENAI_API_KEY ? { OPENAI_API_KEY: payload.OPENAI_API_KEY } : {}),
              ...(payload.SUPABASE_URL ? { SUPABASE_URL: payload.SUPABASE_URL } : {}),
            };
            await writeConfig(next);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(buildConfigResponse(next)));
          } catch (error) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error.message }));
          }
        });
        return;
      }
    }

    if (req.url === '/api/coach' && req.method === 'POST') {
      const payload = await readBody(req);
      if (typeof payload.message !== 'string' || !payload.message.trim()) throw new Error('Message is required');
      const message = await runCoach(payload.message.trim());
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message }));
      return;
    }

    if (req.url === '/api/context/status') {
      const config = await readConfig();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ready:Boolean(config.SUPABASE_URL && config.SUPABASE_SECRET_KEY), retentionDays:90, needsProjectUrl:Boolean(config.SUPABASE_SECRET_KEY && !config.SUPABASE_URL) }));
      return;
    }

    if (req.url === '/api/training-context' && req.method === 'GET') {
      const config = await readConfig();
      const local = await readLocalContext();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ...local, source:config.TP_AUTH_COOKIE ? 'trainingpeaks' : 'local-live', retention_days:90 }));
      return;
    }

    if (req.url?.startsWith('/api/workouts/') && req.method === 'PATCH') {
      const id = decodeURIComponent(req.url.split('/').pop());
      const payload = await readBody(req);
      const workout = await updateLocalWorkout(id, String(payload.change || 'Approved coaching adjustment'));
      updateLogs(`local workout updated: ${id}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(workout));
      return;
    }

    if (req.url === '/api/comments' && req.method === 'POST') {
      const payload = await readBody(req);
      const comment = await addLocalComment(String(payload.workoutId || ''), String(payload.body || ''));
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(comment));
      return;
    }

    if (req.url === '/api/start') {
      if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
      }

      const result = startServer();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    if (req.url === '/api/stop') {
      if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
      }

      stopProcess();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ running: false, pid: null, message: 'Server stopped.' }));
      return;
    }

    if (req.url === '/api/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ running: !!serverState.child, pid: serverState.pid, logs: serverState.logs }));
      return;
    }

    const cleanUrl = decodeURIComponent((req.url || '/').split('?')[0]);
    const requested = cleanUrl === '/' ? 'index.html' : cleanUrl.slice(1);
    const candidate = path.resolve(distPath, requested);
    const safePath = candidate.startsWith(distPath + path.sep) ? candidate : path.join(distPath, 'index.html');
    let filePath = safePath;
    try { await fs.access(filePath); } catch { filePath = path.join(distPath, 'index.html'); }
    const ext = path.extname(filePath);
    const contentTypes = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.webmanifest':'application/manifest+json' };
    const file = await fs.readFile(filePath);
    res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable' });
    res.end(file);
    return;
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
});

const port = Number(process.env.PORT || 4173);
server.listen(port, () => {
  console.log(`UI server listening on http://localhost:${port}`);
});
