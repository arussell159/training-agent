import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';

export const STORED_SETTINGS = [
  'INTERVALS_API_KEY','OPENAI_API_KEY','OPENAI_MODEL',
  'VAPID_PUBLIC_KEY','VAPID_PRIVATE_KEY','VAPID_SUBJECT','APP_THEME',
  'METRICS_LAYOUT','APP_DATA','HISTORICAL_ARCHIVE','COACHING_CONFIG','KNOWLEDGE_BASE','CALENDAR_SUMMARY_OPEN','TRAININGPEAKS_IMPORT_REPORT','RACE_PLAN_IMPORT_REPORT','COMPLETION_CONFIRMATION',
];
const BOOTSTRAP_SETTINGS = ['SUPABASE_URL','SUPABASE_SECRET_KEY','SETTINGS_ENCRYPTION_KEY','SETTINGS_SCOPE'];

function pickSettings(config,keys) {
  return Object.fromEntries(keys.filter(key => typeof config[key] === 'string' && config[key]).map(key => [key,config[key]]));
}

export function publicSettings(config) {
  return {
    intervalsConnected:Boolean(config.INTERVALS_API_KEY),
    openAIConnected:Boolean(config.OPENAI_API_KEY),
    supabaseConnected:Boolean(config.SUPABASE_URL && config.SUPABASE_SECRET_KEY),
    supabaseNeedsUrl:Boolean(config.SUPABASE_SECRET_KEY && !config.SUPABASE_URL),
    settingsStorage:'supabase',
    theme:['light','dark','system'].includes(config.APP_THEME) ? config.APP_THEME : null,
    metricsLayout:config.METRICS_LAYOUT ? JSON.parse(config.METRICS_LAYOUT) : null,
    calendarSummaryOpen:config.CALENDAR_SUMMARY_OPEN !== 'false',
    settingsError:config.settingsError || null,
  };
}

export function createSupabaseSettingsStore(bootstrap,fetchImpl = fetch) {
  const url = String(bootstrap.SUPABASE_URL || '').replace(/\/$/,'');
  const secret = bootstrap.SUPABASE_SECRET_KEY;
  if (!url || !secret) throw new Error('Configure the backend Supabase URL and secret before saving Settings.');
  if (!/^https:\/\//.test(url)) throw new Error('Supabase settings require an HTTPS project URL.');
  // A stable dedicated key is recommended. The backend service secret is the bootstrap fallback.
  const material = bootstrap.SETTINGS_ENCRYPTION_KEY || secret;
  if (material.length < 32) throw new Error('Settings encryption requires a backend secret of at least 32 characters.');
  const key = createHash('sha256').update(`ar-performance-settings:v1:${material}`).digest();
  const scope = bootstrap.SETTINGS_SCOPE || 'default';
  function encrypt(name,value) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm',key,iv);
    cipher.setAAD(Buffer.from(`${scope}:${name}`));
    const encrypted = Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
    return ['v1',iv.toString('base64'),cipher.getAuthTag().toString('base64'),encrypted.toString('base64')].join('.');
  }
  function decrypt(name,value) {
    try {
      const [version,iv,tag,encrypted,...extra] = String(value).split('.');
      if (version !== 'v1' || extra.length) throw new Error('Invalid format');
      const decipher = createDecipheriv('aes-256-gcm',key,Buffer.from(iv,'base64'));
      decipher.setAAD(Buffer.from(`${scope}:${name}`));
      decipher.setAuthTag(Buffer.from(tag,'base64'));
      return Buffer.concat([decipher.update(Buffer.from(encrypted,'base64')),decipher.final()]).toString('utf8');
    } catch {
      throw new Error('Saved Settings could not be decrypted. Restore the original backend settings encryption key.');
    }
  }
  async function request(query,options = {}) {
    let response;
    try {
      response = await fetchImpl(`${url}/rest/v1/app_settings${query}`,{
        ...options, signal:AbortSignal.timeout(15_000),
        headers:{apikey:secret,...(!String(secret).startsWith('sb_secret_') ? {Authorization:`Bearer ${secret}`} : {}),
          'Content-Type':'application/json',Accept:'application/json','Cache-Control':'no-cache',...options.headers},
      });
    } catch {throw new Error('Supabase Settings could not be reached. Nothing was saved; retry when the connection is restored.');}
    if (!response.ok) {
      if (response.status === 404) throw new Error('Supabase Settings table is missing. Run app-backend/supabase/settings.sql in the Supabase SQL editor.');
      // Never echo provider error bodies: they may contain submitted credentials or encrypted values.
      if (response.status === 401) throw new Error('Supabase rejected the locally configured backend secret (401). Update the project URL and secret together in Settings → Supabase. Your Intervals.icu key was not rejected by this error.');
      throw new Error(`Supabase Settings request failed (${response.status}). Check the backend Supabase configuration and table permissions.`);
    }
    return response.json();
  }
  return {
    async read() {
      const rows = await request(`?scope=eq.${encodeURIComponent(scope)}&select=name,encrypted_value`);
      return Object.fromEntries(rows.filter(row => STORED_SETTINGS.includes(row.name)).map(row => [row.name,decrypt(row.name,row.encrypted_value)]));
    },
    async save(patch) {
      const values = pickSettings(patch,STORED_SETTINGS);
      const rows = Object.entries(values).map(([name,value]) => ({scope,name,encrypted_value:encrypt(name,value),updated_at:new Date().toISOString()}));
      if (!rows.length) return;
      const saved = await request('?on_conflict=scope,name',{
        method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify(rows),
      });
      if (Object.entries(values).some(([name,value]) => {
        const row = saved.find(row => row.scope === scope && row.name === name);
        return !row || decrypt(name,row.encrypted_value) !== value;
      })) throw new Error('Supabase did not confirm the saved Settings. Reload before retrying.');
    },
  };
}

// Bootstrap credentials come from the backend environment/local file, not from the database they unlock.
export function createSettingsService({readBootstrap,writeBootstrap,fetchImpl = fetch,hosted = false}) {
  return {
    async read() {
      const bootstrap = await readBootstrap();
      if (!bootstrap.SUPABASE_URL || !bootstrap.SUPABASE_SECRET_KEY) return bootstrap;
      try {
        const saved = await createSupabaseSettingsStore(bootstrap,fetchImpl).read();
        // Saved application settings take precedence over older environment/local application keys.
        return {...bootstrap,...saved};
      } catch(error) {
        // Keep the recovery form usable even when the database bootstrap needs repair.
        return {...bootstrap,settingsError:error.message};
      }
    },
    async save(patch) {
      const bootstrap = await readBootstrap();
      const target = {...bootstrap,...pickSettings(patch,BOOTSTRAP_SETTINGS)};
      const bootstrapChanged = BOOTSTRAP_SETTINGS.some(name => target[name] !== bootstrap[name]);
      if (bootstrapChanged && hosted) throw new Error('Set the Supabase URL and secret in the deployment environment. Hosted Settings cannot change their database bootstrap connection.');
      const store = createSupabaseSettingsStore(target,fetchImpl);
      // Ensure the destination table is reachable, including when only saving bootstrap fields.
      const existing = await store.read();
      const migrated = Object.fromEntries(Object.entries(pickSettings(bootstrap,STORED_SETTINGS)).filter(([name]) => !existing[name]));
      await store.save({...migrated,...patch});
      if (bootstrapChanged || (!hosted && STORED_SETTINGS.some(name => bootstrap[name]))) await writeBootstrap(pickSettings(target,BOOTSTRAP_SETTINGS));
      return {...target,...await store.read()};
    },
  };
}
