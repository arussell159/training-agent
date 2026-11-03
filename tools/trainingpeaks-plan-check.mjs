// Read-only imported-plan UI coverage against disposable local APIs.
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {normalizeTrainingPeaksPlan,overlayTrainingPeaksSnapshot} from '../app-backend/lib/trainingpeaks-planned-model.mjs';
const require=createRequire(import.meta.url),{chromium}=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const origin=process.env.MOBILE_TEST_ORIGIN||'http://127.0.0.1:5343',output='artifacts/trainingpeaks-plans/ui';
assert.ok(['localhost','127.0.0.1'].includes(new URL(origin).hostname));await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'msedge'}),errors=[],badReads=[],writes=[],results=[];
try{for(const width of [390,1280]){
 const context=await browser.newContext({viewport:{width,height:900},isMobile:width<768,hasTouch:width<768,serviceWorkers:'block'});
 await context.addInitScript(()=>localStorage.setItem('ar-performance:mobile-home-layout','classic'));
 const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const shift=n=>new Date(Date.parse(today+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
 const interval=(name,intensityClass,value,minValue,maxValue)=>({name,intensityClass,length:{value,unit:'second'},targets:[{minValue,maxValue}]});
 const plans=[['Bike',2],['Run',3],['Swim',1]].map(([sport,type],i)=>normalizeTrainingPeaksPlan({
  workoutId:9001+i,athleteId:123,workoutDay:shift(i),title:`TP imported ${sport}`,
  description:'Exact source instructions. Keep the effort controlled.',workoutTypeValueId:type,totalTimePlanned:0.5,tssPlanned:30,
  structure:{primaryIntensityMetric:sport==='Bike'?'percentOfFtp':'percentOfThresholdPace',structure:[
   {type:'step',steps:[interval('Warm Up','warmUp',300,60,70)]},
   {type:'repetition',length:{value:3,unit:'repetition'},steps:[interval('Work','active',180,90,100)]},
  ]},
 },{athleteId:123,today}));
 const snapshot={activatedDay:today,workouts:plans,lastSyncedAt:new Date().toISOString()};
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());if(url.origin!==origin)return route.abort();
  if(!url.pathname.startsWith('/api/'))return route.continue();
  const api=url.searchParams.get('__api_route')||url.pathname.slice(5);
  if(api.includes('trainingpeaks%3A')||api.includes('trainingpeaks:')){if(!api.startsWith('workout-history/'))badReads.push(api)}
  if(['POST','PUT','PATCH','DELETE'].includes(req.method())&&!['training-live','trainingpeaks/planned'].includes(api))writes.push(api);
  if(api==='trainingpeaks/planned')return route.fulfill({json:{enabled:true,count:3,lastSyncedAt:snapshot.lastSyncedAt,error:null}});
  if(api.startsWith('workout-history/trainingpeaks'))return route.fulfill({json:{workout:plans.find(w=>w.id===decodeURIComponent(api.split('/')[1]))}});
  if(['training-context','training-updates'].includes(api)){
   const response=await route.fetch(),body=await response.json();
   if(body.unchanged)return route.fulfill({response,json:body});
   const decorated=overlayTrainingPeaksSnapshot(body.context||body,snapshot,today);
   return route.fulfill({response,json:body.context?{...body,context:decorated}:decorated});
  }
  return route.continue();
 });
 await page.goto(origin+'/calendar',{waitUntil:'networkidle'});
 await page.getByText('Plans from TrainingPeaks',{exact:false}).first().waitFor();
 for(const plan of plans){
  const card=page.locator(`[data-workout-id="${plan.id}"]`).first();await card.scrollIntoViewIfNeeded();await card.click();
  const detail=page.locator(`[data-trainingpeaks-workout="${plan.id}"]`);await detail.waitFor();
  await detail.getByText('Exact source instructions. Keep the effort controlled.',{exact:true}).waitFor();
  assert.equal(await detail.locator('input,textarea,select,button[aria-label*="Edit"]').count(),0);
  assert.ok((await detail.getByRole('link',{name:'Open in TrainingPeaks'}).getAttribute('href')).endsWith(plan.id.split(':')[1]));
  assert.equal(await detail.locator('[data-workout-profile]').count(),1);
  await page.screenshot({path:path.join(output,`${width}-${plan.sport}.png`)});
  if(width<768)await detail.getByRole('button',{name:'Back',exact:true}).click();else await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
 }
 const refresh=page.getByRole('button',{name:'Refresh plans',exact:true});await refresh.evaluate(node=>node.scrollIntoView({block:'center',behavior:'instant'}));await refresh.click();await page.getByText('TrainingPeaks plans refreshed.',{exact:true}).waitFor();
 await page.goto(origin+'/?workout=trainingpeaks%3A9002',{waitUntil:'networkidle'});await page.locator('[data-trainingpeaks-workout="trainingpeaks:9002"]').waitFor();
 results.push({width,sports:3,readOnly:true,refresh:true,directLink:true});await context.close();
}}finally{await browser.close();await fs.writeFile(path.join(output,'result.json'),JSON.stringify({results,errors,badReads,writes},null,2));}
assert.deepEqual(errors,[]);assert.deepEqual(badReads,[]);assert.deepEqual(writes,[]);console.log(JSON.stringify(results));
