// Component geometry evidence, not a whole-image parity certificate.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
let playwright;
try{playwright=require("playwright");}catch{playwright=require(path.join(os.homedir(),".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));}
const origin=process.env.APP_TEST_ORIGIN||"http://127.0.0.1:5218";
assert.ok(["127.0.0.1","localhost"].includes(new URL(origin).hostname));
const out=path.resolve("artifacts/trainingpeaks-parity");
const readDate=async page=>{
  await page.locator('.dsb-picker-date').getByRole('spinbutton',{name:'Year',exact:true}).waitFor();
  const fields=Object.fromEntries(await page.locator('.dsb-picker-date').getByRole('spinbutton').evaluateAll(es=>es.map(e=>[e.getAttribute('aria-label'),e.getAttribute('aria-valuenow')])));
  return `${fields.Year}-${String(fields.Month).padStart(2,'0')}-${String(fields.Day).padStart(2,'0')}`;
};
const chooseDate=async(page,value)=>{
  const current=await readDate(page);
  if(current===value)return;
  await page.locator('.dsb-picker-date').getByRole('button',{name:/Choose date/}).click();
  const grid=page.getByRole('grid');await grid.waitFor();
  // The measured pair uses a date in the same observed month. No DOM mutation.
  assert.equal(current.slice(0,7),value.slice(0,7),'Geometry requires the paired reference month');
  await grid.getByRole('gridcell',{name:String(Number(value.slice(8))),exact:true}).click();
  await grid.waitFor({state:'hidden'});
  assert.equal(await readDate(page),value);
};
await fs.mkdir(out,{recursive:true});
const browser=await playwright.chromium.launch({headless:true,channel:"msedge"});
const context=await browser.newContext({viewport:{width:1280,height:720},deviceScaleFactor:1,colorScheme:"light",locale:"en-US"});
const page=await context.newPage(), errors=[];
page.on("pageerror",error=>errors.push(error.message));
await context.route("**/*",route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
try{
  await page.goto(`${origin}/calendar?theme=light`,{waitUntil:"networkidle"});
  assert.equal(await page.evaluate(()=>window.__localPreview?.synthetic),true);
  const beforeModal=await page.evaluate(()=>({scrollX,scrollY,clientWidth:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,innerWidth}));
  const day=new Date();day.setDate(day.getDate()+3);
  await page.getByRole("button",{name:`Add workout for ${day.toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"})}`,exact:true}).press("Enter");
  await page.locator(".calendar-add-dialog").getByRole("button",{name:"Strength",exact:true}).click();
  await page.getByRole("button",{name:"New Strength Builder",exact:true}).click();
  await page.locator(".dsb-dialog #dsb-workout-title").waitFor();
  const draftDate=await readDate(page);
  const referenceDate="2026-10-31";
  await chooseDate(page,referenceDate);
  await page.locator(".dsb-summary h2").click();
  await page.evaluate(()=>document.fonts.ready);
  const geometry=await page.locator(".dsb-dialog").evaluate(element=>Object.fromEntries([ ["dialog",element],["header",element.querySelector(".dsb-header")],["summary",element.querySelector(".dsb-summary")],["main",element.querySelector(".dsb-main")],["fields",element.querySelector(".dsb-workout-fields")],["title",element.querySelector("#dsb-workout-title")],["add",element.querySelector(".dsb-add-block > button")] ].map(([name,node])=>{const style=getComputedStyle(node);return[name,{rect:node.getBoundingClientRect().toJSON(),width:style.width,height:style.height,lineHeight:style.lineHeight,font:style.font,padding:style.padding,border:style.border,radius:style.borderRadius}]})));
  await page.screenshot({path:path.join(out,"local-strength-empty.png"),animations:"disabled"});
  // The reference Add Block button pulses. Compare its independently observed
  // computed layout size separately from its transient transformed rectangle.
  const reference={dialog:{x:32,y:32,width:1216,height:656},header:{x:32,y:32,width:1216,height:72},summary:{x:108,y:104,width:320,height:584},main:{x:428,y:104,width:744,height:584},fields:{x:452,y:116,width:681,height:177.0625},title:{x:476,y:140,width:633,height:38.5625}};
  const differences=Object.fromEntries(Object.entries(reference).map(([key,expected])=>[key,Object.fromEntries(Object.entries(expected).map(([property,value])=>[property,geometry[key].rect[property]-value]))]));
  const addReferenceCss={width:128.188,height:32,lineHeight:18.75,padding:"2px 14px",radius:"64px"};
  const addCssDifferences=Object.fromEntries(["width","height","lineHeight"].map(key=>[key,parseFloat(geometry.add[key])-addReferenceCss[key]]));
  const controlsReference=JSON.parse(await fs.readFile(path.join(out,"reference-strength-summary-controls-styles.json"),"utf8"));
  // Empty Strength is valid. Changing its date now correctly enables Save;
  // restore the pristine date before comparing the reference disabled state.
  await chooseDate(page,draftDate);
  await page.locator(".dsb-summary h2").click();
  assert.equal(await page.getByRole('button',{name:'Save',exact:true}).isDisabled(),true);
  const controls=await page.locator('.dsb-dialog').evaluate(element=>{
    const snap=node=>{const s=getComputedStyle(node);return {rect:node.getBoundingClientRect().toJSON(),padding:s.padding,radius:s.borderRadius,border:s.border,bg:s.backgroundColor,color:s.color,opacity:s.opacity,shadow:s.boxShadow,textAlign:s.textAlign,fontSize:s.fontSize,lineHeight:s.lineHeight,fontWeight:s.fontWeight,backdropFilter:s.backdropFilter};};
    return {table:snap(element.querySelector('.dsb-summary dl')),rows:[...element.querySelectorAll('.dsb-summary dl>div')].map(row=>({row:snap(row),label:snap(row.querySelector('dt')),value:snap(row.querySelector('input')||row.querySelector('dd'))})),save:['Save','Save & Close'].map(name=>snap([...element.querySelectorAll('button')].find(e=>e.textContent===name))),headerIcons:['Strength workout options','Close Strength builder'].map(name=>snap(element.querySelector(`button[aria-label="${name}"]`))),backdrop:snap(document.querySelector('.dsb-backdrop'))};
  });
  await fs.writeFile(path.join(out,'paired-strength-summary-controls.json'),JSON.stringify({reference:controlsReference,local:controls,localPristineDate:draftDate,certificate:false},null,2));
  await fs.writeFile(path.join(out,"paired-strength-empty-geometry.json"),JSON.stringify({viewport:{width:1280,height:720,dpr:1},referenceDate,localDate:referenceDate,controlsPristineDate:draftDate,reference,local:geometry,differences,addReferenceCss,addCssDifferences,errors,certificate:false,reason:"Live reference full-page capture is JPEG; these are observed component rectangles and computed layout properties only."},null,2));
  console.log(JSON.stringify({differences,addCssDifferences,errors},null,2));
  assert.deepEqual(errors,[]);
  for(const [name,box] of Object.entries(differences))for(const [property,delta] of Object.entries(box))assert.ok(Math.abs(delta)<=0.5,`${name}.${property} differs by ${delta}px`);
  for(const [property,delta] of Object.entries(addCssDifferences))assert.ok(Math.abs(delta)<=0.02,`Add Block layout ${property} differs by ${delta}px`);
  assert.equal(geometry.add.padding,addReferenceCss.padding);
  assert.equal(geometry.add.radius,addReferenceCss.radius);
  for(const key of ['x','y','width','height']) assert.ok(Math.abs(controls.table.rect[key]-controlsReference.table.rect[key])<=.02,`Summary table ${key}: ${controls.table.rect[key]} vs ${controlsReference.table.rect[key]}`);
  assert.equal(controls.backdrop.bg,'rgba(0, 0, 0, 0.5)');
  assert.equal(controls.backdrop.backdropFilter,'none');
  const modalViewport=await page.evaluate(()=>({innerWidth,innerHeight,scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth}));
  assert.equal(controls.backdrop.rect.x,0);
  assert.equal(controls.backdrop.rect.right,modalViewport.innerWidth,'Strength backdrop must cover the scrollbar gutter too');
  assert.equal(controls.backdrop.rect.bottom,modalViewport.innerHeight);
  assert.ok(modalViewport.scrollWidth<=modalViewport.innerWidth,'Strength modal must not introduce horizontal overflow');
  for(let i=0;i<controls.save.length;i++)for(const key of ['bg','color','opacity','border','radius','padding','shadow'])assert.equal(controls.save[i][key],controlsReference.save[i][key],`Save ${i} ${key}`);
  const headerReference=JSON.parse(await fs.readFile(path.join(out,'reference-strength-header-controls.json'),'utf8'));
  for(const [index,local] of [...controls.save,...controls.headerIcons].entries()){
    const expected=headerReference.buttons[index+2];
    for(const key of ['x','y','width','height'])assert.ok(Math.abs(local.rect[key]-expected.rect[key])<=.02,`Header control ${index} ${key}: ${local.rect[key]} vs ${expected.rect[key]}`);
  }
  const glyphReference=JSON.parse(await fs.readFile(path.join(out,'reference-strength-navigation-glyphs.json'),'utf8'));
  const glyphs=await page.locator('.dsb-dialog').evaluate(element=>[
    ['options',element.querySelector('button[aria-label="Strength workout options"]')],
    ['Close',element.querySelector('button[aria-label="Close Strength builder"]')],
    ...[...element.querySelectorAll('.dsb-left-nav button,.dsb-right-nav button')].map(node=>[node.textContent.replace(/\s+/g,' ').trim(),node])
  ].map(([name,node])=>{const svg=node.querySelector('svg');return{name,rect:svg.getBoundingClientRect().toJSON(),viewBox:svg.getAttribute('viewBox'),paths:[...svg.querySelectorAll('path')].map(path=>path.getAttribute('d'))}}));
  for(const observed of glyphReference){
    const local=glyphs.find(row=>row.name.replace(/\s/g,'')===observed.name.replace(/\s/g,''));assert.ok(local,observed.name);
    for(const key of ['x','y','width','height'])assert.ok(Math.abs(local.rect[key]-observed.svgs[0].rect[key])<=.02,`${observed.name} glyph ${key}: ${local.rect[key]} vs ${observed.svgs[0].rect[key]}`);
    const expectedPaths=[...observed.svgs[0].html.matchAll(/<path\b[^>]*\bd="([^"]*)"/g)].map(match=>match[1]);
    assert.deepEqual(local.paths,expectedPaths,`${observed.name} rendered vector paths`);
  }
  const captionReference=JSON.parse(await fs.readFile(path.join(out,'reference-strength-navigation-captions.json'),'utf8'));
  const captions=await page.locator('.dsb-view-label').evaluateAll(es=>es.map(e=>{const s=getComputedStyle(e);return{name:e.textContent,rect:e.getBoundingClientRect().toJSON(),fontSize:s.fontSize,fontWeight:s.fontWeight,lineHeight:s.lineHeight}}));
  for(const observed of captionReference){
    const local=captions.find(row=>row.name===observed.name),expected=observed.children[0];assert.ok(local,observed.name);
    for(const key of ['x','y','width','height'])assert.ok(Math.abs(local.rect[key]-expected.rect[key])<=.02,`${observed.name} caption ${key}: ${local.rect[key]} vs ${expected.rect[key]}`);
    for(const key of ['fontSize','fontWeight','lineHeight'])assert.equal(local[key],expected[key],`${observed.name} caption ${key}`);
  }
  await fs.writeFile(path.join(out,'paired-strength-header-glyphs.json'),JSON.stringify({headerReference,localHeader:[...controls.save,...controls.headerIcons],glyphReference,localGlyphs:glyphs,captionReference,localCaptions:captions,certificate:false},null,2));
  for(let i=0;i<controls.rows.length;i++){
    for(const key of ['x','y','width','height'])assert.ok(Math.abs(controls.rows[i].row.rect[key]-controlsReference.rows[i].row.rect[key])<=.02,`Summary row ${i} ${key}`);
    assert.equal(controls.rows[i].label.fontSize,'13px');
    assert.equal(controls.rows[i].label.fontWeight,'500');
    assert.equal(controls.rows[i].label.lineHeight,'16.25px');
    if(i<4){assert.equal(controls.rows[i].value.rect.width,100);assert.equal(controls.rows[i].value.textAlign,'center');assert.equal(controls.rows[i].value.fontSize,'15px');assert.equal(controls.rows[i].value.lineHeight,'22.5px');}
  }
  await chooseDate(page,draftDate);
  await page.getByRole("button",{name:"Close Strength builder",exact:true}).click();
  await page.locator('.dsb-backdrop').waitFor({state:'detached'});
  const afterModal=await page.evaluate(()=>({scrollX,scrollY,clientWidth:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,innerWidth}));
  assert.deepEqual(afterModal,beforeModal,'Closing Strength must restore viewport geometry and scroll');
  await fs.writeFile(path.join(out,'strength-modal-scroll-coverage.json'),JSON.stringify({beforeModal,modalViewport,backdrop:controls.backdrop.rect,afterModal,certificate:false},null,2));
}finally{await browser.close();}
