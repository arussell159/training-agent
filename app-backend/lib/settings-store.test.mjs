import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createSupabaseSettingsStore,createSettingsService,publicSettings} from './settings-store.mjs';

const bootstrap={SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_fixture_only_abcdefghijklmnopqrstuvwxyz123456'};
function fakeDatabase() {
  const rows=new Map();
  const requests=[];
  const fetchImpl=async(url,options)=>{
    requests.push({url,options});
    assert.equal(options.headers.apikey,bootstrap.SUPABASE_SECRET_KEY);
    if(options.method==='POST') {
      const incoming=JSON.parse(options.body);
      for(const row of incoming)rows.set(`${row.scope}:${row.name}`,row);
      return {ok:true,json:async()=>incoming};
    }
    const scope=new URL(url).searchParams.get('scope')?.slice(3);
    return {ok:true,json:async()=>[...rows.values()].filter(r=>r.scope===scope)};
  };
  return {rows,requests,fetchImpl};
}

test('settings persist encrypted and survive fresh instances without local file writes',async()=>{
  const db=fakeDatabase();
  let localWrites=0;
  const options={readBootstrap:async()=>({...bootstrap,INTERVALS_API_KEY:'old-environment-key'}),writeBootstrap:async()=>{localWrites++;},fetchImpl:db.fetchImpl,hosted:true};
  const first=createSettingsService(options);
  await first.save({INTERVALS_API_KEY:'saved-key',OPENAI_API_KEY:'fixture-openai-key'});
  assert.equal(localWrites,0);
  assert.doesNotMatch(JSON.stringify([...db.rows.values()]),/saved-key|fixture-openai-key|old-environment-key/);
  const fresh=createSettingsService(options);
  assert.equal((await fresh.read()).INTERVALS_API_KEY,'saved-key');
  await fresh.save({APP_THEME:'dark'});
  const result=await createSettingsService(options).read();
  assert.equal(result.INTERVALS_API_KEY,'saved-key');
  assert.equal(result.OPENAI_API_KEY,'fixture-openai-key');
  assert.equal(result.APP_THEME,'dark');
  assert.deepEqual(publicSettings(result),{intervalsConnected:true,openAIConnected:true,supabaseConnected:true,supabaseNeedsUrl:false,settingsStorage:'supabase',theme:'dark',settingsError:null});
});

test('encryption is randomized, authenticated and scoped; bootstrap secrets are not stored',async()=>{
  const db=fakeDatabase();
  const store=createSupabaseSettingsStore(bootstrap,db.fetchImpl);
  await store.save({...bootstrap,INTERVALS_API_KEY:'fixture-key',SETTINGS_ENCRYPTION_KEY:'never-store-bootstrap-key'});
  const before=db.rows.get('default:INTERVALS_API_KEY').encrypted_value;
  assert.equal(db.rows.size,1);
  await store.save({INTERVALS_API_KEY:'fixture-key'});
  assert.notEqual(db.rows.get('default:INTERVALS_API_KEY').encrypted_value,before);
  db.rows.get('default:INTERVALS_API_KEY').encrypted_value=before.slice(0,-2)+'AA';
  await assert.rejects(store.read(),/could not be decrypted/);
});

test('a stable encryption key allows the Supabase service secret to rotate',async()=>{
  const db=fakeDatabase();
  const encryption='stable-fixture-encryption-key-1234567890';
  await createSupabaseSettingsStore({...bootstrap,SETTINGS_ENCRYPTION_KEY:encryption},db.fetchImpl).save({INTERVALS_API_KEY:'fixture-key'});
  const rotated=createSupabaseSettingsStore({...bootstrap,SUPABASE_SECRET_KEY:'sb_secret_new_fixture_abcdefghijklmnopqrstuvwxyz123456',SETTINGS_ENCRYPTION_KEY:encryption},async()=>({ok:true,json:async()=>[...db.rows.values()]}));
  assert.equal((await rotated.read()).INTERVALS_API_KEY,'fixture-key');
});

test('missing table and failed writes return actionable errors, never raw provider data or local fallback',async()=>{
  const missing=createSupabaseSettingsStore(bootstrap,async()=>({ok:false,status:404}));
  await assert.rejects(missing.read(),/settings.sql/);
  let localWrites=0;
  const service=createSettingsService({readBootstrap:async()=>bootstrap,writeBootstrap:async()=>{localWrites++;},fetchImpl:async(url,options)=>options.method==='POST'?{ok:false,status:500,text:async()=> 'private-provider-response'}:{ok:true,json:async()=>[]}});
  await assert.rejects(service.save({INTERVALS_API_KEY:'fixture-key'}),error=>/Settings request failed/.test(error.message)&&!error.message.includes('private-provider-response'));
  assert.equal(localWrites,0);
});

test('hosted bootstrap changes are rejected rather than falsely saved',async()=>{
  const service=createSettingsService({readBootstrap:async()=>bootstrap,writeBootstrap:async()=>{throw Error('must not write');},hosted:true,fetchImpl:async()=>{throw Error('must not request');}});
  await assert.rejects(service.save({SUPABASE_URL:'https://different.supabase.co'}),/deployment environment/);
});

test('a rejected database connection leaves localhost recovery settings available',async()=>{
  const service=createSettingsService({readBootstrap:async()=>bootstrap,writeBootstrap:async()=>{},fetchImpl:async()=>({ok:false,status:401})});
  const config=await service.read();
  assert.match(config.settingsError,/locally configured backend secret/);
  assert.match(publicSettings(config).settingsError,/401/);
  await assert.rejects(service.save({INTERVALS_API_KEY:'fixture-key'}),/Supabase rejected/);
});

test('writes must be returned and confirmed by Supabase',async()=>{
  const store=createSupabaseSettingsStore(bootstrap,async()=>({ok:true,json:async()=>[]}));
  await assert.rejects(store.save({INTERVALS_API_KEY:'fixture-key'}),/did not confirm/);
});

test('config API save and reload expose only status, with no stale-cache headers or local persistence',async()=>{
  const originalFetch=globalThis.fetch;
  const envNames=['SUPABASE_URL','SUPABASE_SECRET_KEY','VERCEL','OPENAI_API_KEY'];
  const previous=Object.fromEntries(envNames.map(name=>[name,process.env[name]]));
  process.env.SUPABASE_URL=bootstrap.SUPABASE_URL;
  process.env.SUPABASE_SECRET_KEY=bootstrap.SUPABASE_SECRET_KEY;
  process.env.VERCEL='1';
  process.env.OPENAI_API_KEY='fixture-openai-key';
  const db=fakeDatabase();
  let validations=0;
  globalThis.fetch=async(url,options)=>{
    if(url==='https://intervals.icu/api/v1/athlete/0') {
      validations++;
      return {ok:true,text:async()=>'{"id":"fixture-athlete"}'};
    }
    return db.fetchImpl(url,options);
  };
  try {
    const {handleRequest}=await import('./../server.mjs');
    async function request(method,body) {
      const req=Readable.from(body?[JSON.stringify(body)]:[]);
      req.method=method;req.url='/api/handler?__api_route=config';
      let status,headers,result;
      const res={writeHead:(s,h)=>{status=s;headers=h;},end:value=>{result=JSON.parse(value);}};
      await handleRequest(req,res);
      return {status,headers,result};
    }
    const saved=await request('POST',{INTERVALS_API_KEY:'fixture-key'});
    assert.equal(saved.status,200);
    assert.equal(saved.result.intervalsConnected,true);
    assert.equal(validations,1);
    const reloaded=await request('GET');
    assert.equal(reloaded.result.intervalsConnected,true);
    assert.equal(reloaded.headers['Cache-Control'],'no-store');
    assert.doesNotMatch(JSON.stringify(reloaded.result),/fixture-key|SUPABASE_SECRET_KEY|INTERVALS_API_KEY/);
    const appearance=await request('POST',{APP_THEME:'dark'});
    assert.equal(appearance.result.theme,'dark');
    assert.equal((await request('GET')).result.intervalsConnected,true);
    assert.equal((await request('POST',{APP_THEME:'invalid'})).status,400);
  } finally {
    globalThis.fetch=originalFetch;
    for(const [name,value] of Object.entries(previous)) {
      if(value===undefined)delete process.env[name];else process.env[name]=value;
    }
  }
});
