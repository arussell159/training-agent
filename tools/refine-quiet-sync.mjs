// Review-branch installer only; removed before production merge.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
function patch(file, expected, replacements) {
  let text=fs.readFileSync(file,'utf8');
  if(expected && createHash('sha1').update(`blob ${Buffer.byteLength(text)}\0`).update(text).digest('hex')!==expected)throw Error(`Changed source: ${file}`);
  for(const [before,after] of replacements){if(text.split(before).length!==2)throw Error(`Changed anchor in ${file}: ${before.slice(0,60)}`);text=text.replace(before,after);}
  fs.writeFileSync(file,text);
}
patch('ui/src/components/app-auth.tsx','381777708b4dab4c5a5fb8d997ed3efff87f47fe',[
  ['  const revision = useRef(0)','  const revision = useRef(0)\n  const currentSession = useRef<AppSession | null>(null)'],
  ['    setApiAuthenticated(value.authenticated)','    currentSession.current = value\n    setApiAuthenticated(value.authenticated)'],
  ['      if (document.visibilityState !== "hidden")\n        void refresh()', '      void refresh()'],
  ['    const expired = () => {\n      revision.current++','    const expired = () => {\n      currentSession.current = null\n      revision.current++'],
  ['    const storage = (event: StorageEvent) => {', '    // The local expiry clock performs no network access. Actual requests still\n    // use the unchanged server-side session/revocation gate.\n    const checkExpiry = () => {\n      const value = currentSession.current\n      if (value?.authenticated && value.expiresAt && Date.now() >= value.expiresAt) expired()\n    }\n    const storage = (event: StorageEvent) => {'],
  ['window.addEventListener("focus", check)','window.addEventListener("focus", checkExpiry)'],
  ['window.addEventListener("pageshow", check)','window.addEventListener("pageshow", checkExpiry)'],
  ['document.addEventListener("visibilitychange", check)','document.addEventListener("visibilitychange", checkExpiry)'],
  ['window.setInterval(check, 60000)','window.setInterval(checkExpiry, 60000)'],
  ['window.removeEventListener("focus", check)','window.removeEventListener("focus", checkExpiry)'],
  ['window.removeEventListener("pageshow", check)','window.removeEventListener("pageshow", checkExpiry)'],
  ['document.removeEventListener("visibilitychange", check)','document.removeEventListener("visibilitychange", checkExpiry)'],
  ['/* Other tabs also check their server session. */','/* Other tabs receive the sign-out storage event. */'],
]);
patch('ui/src/components/section11-report.tsx','6bde2fcf38d103bc8e24ab0c16e6be6cec7e1024',[
  ['    const timer = window.setInterval(() => {\n      if (!document.hidden) void check()\n    }, 15000)\n','    // Read on opening, a real training-context update, or an explicit action;\n    // an unfinished report must not poll the database indefinitely.\n'],
  ['      clearInterval(timer)\n',''],
]);
patch('app-backend/lib/workout-sync-policy.mjs',null,[
  ["'display_range', 'version', 'cache_scope', 'full_history_available'","'display_range', 'version', 'cache_scope', 'full_history_available', 'first_imported_at'"],
  ['    const row = retained || (collision ?', '    let row = retained || (collision ?'],
  ['    rows.set(String(row.id), row);', '    if (!retained && completedId(row)) {\n      const prior=byId.get(String(row.id)) || byActivity.get(completedId(row));\n      const first=prior?.first_imported_at || (prior ? previous.synced_at : incoming.synced_at);\n      if (first) row={...row,first_imported_at:first};\n    }\n    rows.set(String(row.id), row);'],
]);
patch('app-backend/lib/workout-sync-policy.test.mjs',null,[
  ["const row=workout('late',60);assert.deepEqual(incrementalSnapshot(context([]),context([row]),NOW).workouts,[row]);", "const row=workout('late',60);assert.deepEqual(incrementalSnapshot(context([]),context([row]),NOW).workouts,[{...row,first_imported_at:context([row]).synced_at}]);"],
]);
fs.appendFileSync('app-backend/lib/workout-sync-policy.test.mjs', `\n// Import age must not reset whenever an unrelated new workout is imported.\ntest('missing recording clocks retain their first verified import age across new snapshots',()=>{\n  const now=Date.parse('2026-09-22T18:00:00Z');\n  const old={id:'activity:noclock',activity_id:'noclock',completed:true,status:'completed',workout_date:'2026-09-22',title:'Saved'};\n  const previous={athlete:{time_zone:'UTC'},history:[old],planned:[],synced_at:new Date(now-23*3600000).toISOString()};\n  const newer={...old,id:'activity:newer',activity_id:'newer'};\n  const first=incrementalSnapshot(previous,{...previous,history:[old,newer],synced_at:new Date(now).toISOString()},now);\n  const saved=first.context.history.find(w=>w.activity_id==='noclock');\n  assert.equal(saved.first_imported_at,previous.synced_at);\n  const later=now+2*3600000;\n  const next=incrementalSnapshot(first.context,{...first.context,history:[{...old,title:'Must remain saved'},newer],synced_at:new Date(later).toISOString()},later);\n  assert.equal(next.context.history.find(w=>w.activity_id==='noclock').title,'Saved');\n});\n`);
fs.writeFileSync('app-backend/lib/ui-idle-network.test.mjs', `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport fs from 'node:fs';\ntest('idle authentication timers and resume handlers are local expiry checks only',()=>{\n const text=fs.readFileSync(new URL('../../ui/src/components/app-auth.tsx',import.meta.url),'utf8');\n assert.match(text,/setInterval\\(checkExpiry, 60000\\)/);\n for(const event of ['focus','pageshow','visibilitychange'])assert.ok(text.includes('addEventListener("'+event+'", checkExpiry)'));\n const clock=text.slice(text.indexOf('const checkExpiry ='),text.indexOf('const storage ='));\n assert.ok(clock.includes('expiresAt'));assert.ok(!/refresh\\(|fetch\\(|authRequest\\(/.test(clock));\n assert.ok(text.includes('app-auth-required'));assert.ok(text.includes('training-app-signed-out'));\n});\ntest('report views no longer run an unbounded database status timer',()=>{\n const text=fs.readFileSync(new URL('../../ui/src/components/section11-report.tsx',import.meta.url),'utf8');\n assert.ok(!text.includes('setInterval'));assert.ok(text.includes('training-context-updated'));\n});\n`);
fs.appendFileSync('docs/WORKOUT_SYNC_POLICY.md','\nThe separate frontend authentication timer now checks the already verified session expiry locally, not Supabase. Logout propagation and server authorization on real requests remain. A remotely revoked session may continue showing already cached content until the next actual protected request; no new protected data or mutations are authorized by the local clock. Report views also no longer run an unbounded status timer: opening the view, new training context, and deliberate actions trigger reads.\n');
console.log('Removed the independent idle network timers and stabilized missing-clock import age.');
