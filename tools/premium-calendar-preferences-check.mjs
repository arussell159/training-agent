// Production UI, disposable in-memory preview only. No account/provider writes.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {simpleWorkoutModel} from '../app-backend/lib/simple-workout.mjs';
import {newStep} from '../app-backend/lib/workout-editor-model.mjs';
const require = createRequire(import.meta.url);
const engines = require(path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const engine = process.env.PREFERENCES_ENGINE || 'chromium';
const port = Number(process.env.PREFERENCES_PORT || 5471);
const origin = `http://127.0.0.1:${port}`;
const output = `artifacts/premium-app/calendar-preferences-${engine}`;
const server = spawn(process.execPath, ['tools/desktop-preview.mjs', '--calendar-edits', `--port=${port}`], {stdio:['ignore','pipe','pipe']});
const evidence = {engine, checks:[], errors:[]};
let browser;
try {
  await fs.mkdir(output, {recursive:true});
  await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',code=>reject(Error(`Preview exited ${code}`)));});
  browser = await engines[engine].launch({headless:true,...(engine==='chromium'?{channel:'msedge'}:{executablePath:process.env.PREFERENCES_EXECUTABLE})});
  evidence.version = browser.version();
  const day = new Date();
  const date = day.toLocaleDateString('en-CA');
  for (const width of [1280,390]) {
    const context = await browser.newContext({viewport:{width,height:844}, serviceWorkers:'block', isMobile:width<768, hasTouch:width<768});
    const page = await context.newPage();
    page.on('pageerror',error=>evidence.errors.push(error.message));
    page.on('console',message=>{if(message.type()==='error')evidence.errors.push(message.text());});
    const ids=[];
    await page.route(url=>url.pathname==='/api/training-context'||url.searchParams.get('__api_route')==='training-context',async route=>{
      const response=await route.fetch(),data=await response.json();
      const sample=[...data.history,...data.planned].find(row=>row.id==='event:9004');
      assert.ok(sample);
      const workouts=[];
      for(const [index,sport] of ['Swim','Bike','Run'].entries()) {
        const simple=simpleWorkoutModel({name:`Simple ${sport}`,sport:sport==='Bike'?'Ride':sport,date,values:{duration_seconds:1800,distance_meters:1000}});
        for(const [kind,model,structure] of [
          ['simple',simple,undefined],
          ['native',undefined,JSON.stringify({steps:[{duration:1800,distance:1000}]})],
          ['intervals',{...simple,steps:[newStep(simple.sport)]},undefined],
        ]) {
          const id=`event:${9800+index*10+['simple','native','intervals'].indexOf(kind)}`;
          ids.push({id,kind,sport});
          workouts.push({...sample,id,title:`${kind} ${sport}`,sport,workout_date:date,planned_workout_date:date,date,status:'planned',activity_id:null,completed_data:null,editor_model:model,structure,unstructured:false});
        }
      }
      data.history=[];data.planned=workouts;
      await route.fulfill({response,json:data});
    });
    await page.goto(`${origin}/calendar?theme=light`,{waitUntil:'networkidle'});
    if(width>=768)await page.getByRole('button',{name:'Today',exact:true}).click();
    for(const {id,kind,sport} of ids.slice(0,9)) {
      const card=page.locator(`[data-workout-id="${id}"]`).first();
      await card.waitFor({state:'attached'});
      const profile=card.locator('.calendar-workout-profile-chart, [data-workout-profile]');
      assert.equal(await profile.count()>0,kind==='intervals',`${width}px ${kind} ${sport}`);
    }
    if(width>=768) {
      const style=await page.locator('.calendar-desktop-month-trigger').evaluate(node=>({size:getComputedStyle(node).fontSize,weight:getComputedStyle(node).fontWeight}));
      assert.deepEqual(style,{size:'20px',weight:'400'});
      assert.equal(await page.locator('.calendar-workout-card').first().evaluate(node=>getComputedStyle(node).paddingTop),'12px');
      assert.deepEqual(await page.locator('.calendar-summary-sports').first().locator('thead th').allTextContents(),['Sport','Planned','Completed']);
    }
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:`${output}/${width}.png`});
    evidence.checks.push({width,profileCases:9,restoredCalendar:width>=768,overflow:false});
    await context.close();
  }
  for(const [sport,unit,label] of [['Swim','secs/100y','Pace (m:ss/100yds)'],['Run','secs/mi','Pace (min/mile)']]) {
    const page=await browser.newPage({viewport:{width:1280,height:820}});
    page.on('pageerror',error=>evidence.errors.push(error.message));
    page.on('console',message=>{if(message.type()==='error')evidence.errors.push(message.text());});
    await page.goto(`${origin}/calendar?theme=light`,{waitUntil:'networkidle'});
    await page.getByRole('button',{name:'Today',exact:true}).click();
    // Cancel the Today smooth-scroll before moving to another date, as a user scroll does.
    await page.mouse.wheel(0,1);
    const createDay=new Date(day);createDay.setDate(createDay.getDate()+3);
    const plus=page.getByRole('button',{name:`Add workout for ${createDay.toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}`,exact:true});
    await plus.evaluate(node=>node.scrollIntoView({block:'center',inline:'nearest'}));
    const bounds=await plus.boundingBox();
    await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);
    await page.screenshot({path:`${output}/${sport.toLowerCase()}-before-add.png`});
    console.log('add-control',sport,await plus.evaluate(node=>{const b=node.getBoundingClientRect();return {x:b.x,y:b.y,pointerEvents:getComputedStyle(node).pointerEvents,hit:document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)?.className};}));
    await plus.click();
    await page.getByRole('dialog').getByRole('button',{name:sport,exact:true}).click();
    await page.getByRole('button',{name:'Build Workout',exact:true}).click();
    const setup=page.getByRole('group',{name:'Workout builder setup',exact:true});
    const units=setup.getByLabel('Builder intensity units',{exact:true});
    assert.equal(await units.inputValue(),unit);
    assert.equal(await units.locator('option:checked').textContent(),label);
    await setup.getByRole('button',{name:'Continue',exact:true}).click();
    assert.equal(await page.getByLabel('Workout target units',{exact:true}).inputValue(),unit);
    await page.screenshot({path:`${output}/${sport.toLowerCase()}-default.png`});
    evidence.checks.push({sport,defaultUnit:unit,label,continuesInEditor:true});
    const alternateSport=sport==='Swim'?'Run':'Swim';
    await page.getByLabel('Workout sport',{exact:true}).selectOption(alternateSport);
    assert.equal(await page.getByLabel('Builder intensity units',{exact:true}).inputValue(),sport==='Swim'?'secs/mi':'secs/100y');
    evidence.checks.push({sportSwitch:`${sport} to ${alternateSport}`,defaultUpdates:true});
    await page.close();
  }
  // Simulate a workout created on another device: server accepts it before a
  // fresh browser has ever stored its local journal/provider identity.
  const freshPage=await browser.newPage({viewport:{width:1280,height:820}});
  freshPage.on('pageerror',error=>evidence.errors.push(error.message));
  freshPage.on('console',message=>{if(message.type()==='error')evidence.errors.push(message.text());});
  const creationId=randomUUID(),workoutId=`app:${creationId}`;
  const created=await freshPage.request.post(`${origin}/api/workout-commits`,{data:{operationId:randomUUID(),action:'create',input:{creationId,model:simpleWorkoutModel({name:'Fresh device simple bike',sport:'Ride',date,values:{duration_seconds:1800}}),values:{duration_seconds:1800},comment:'Saved on another device',commentId:randomUUID()}}});
  assert.ok(created.ok(),await created.text());
  let invalidCommentReads=0;
  freshPage.on('request',request=>{const url=new URL(request.url());if(url.searchParams.get('workoutId')===workoutId&&(url.pathname==='/api/comments'||url.searchParams.get('__api_route')==='comments'))invalidCommentReads++;});
  await freshPage.goto(`${origin}/calendar?theme=light`,{waitUntil:'networkidle'});
  await freshPage.getByRole('button',{name:'Today',exact:true}).click();
  await freshPage.mouse.wheel(0,1);
  await freshPage.locator(`[data-workout-id="${workoutId}"]`).click();
  const details=freshPage.getByRole('dialog');
  await details.getByText('Saved on another device',{exact:true}).waitFor();
  assert.equal(await details.locator('[data-workout-profile]').count(),0);
  assert.doesNotMatch(await details.innerText(),/Choose a calendar workout\./);
  assert.equal(invalidCommentReads,0);
  await freshPage.screenshot({path:`${output}/fresh-device-comments.png`});
  evidence.checks.push({freshDeviceComments:true,simpleDetailProfileAbsent:true,invalidCommentReads});
  await freshPage.close();
  assert.deepEqual(evidence.errors,[]);
  await fs.writeFile(`${output}/evidence.json`,JSON.stringify(evidence,null,2));
  console.log(JSON.stringify(evidence,null,2));
} finally {await browser?.close();server.kill();}
