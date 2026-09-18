import test from 'node:test';
import assert from 'node:assert/strict';
import { blockReady, buildBlockReport, writeBlockNote } from '../automation/block-report.mjs';
import { reportBlockManifest } from './publish-report-blocks.mjs';
const block = {start_date:'2026-09-07', end_date:'2026-09-20', phase:'Peak', weeks:[{start_date:'2026-09-07',end_date:'2026-09-13',phase:'Peak'},{start_date:'2026-09-14',end_date:'2026-09-20',phase:'Peak'}]};
test('same-day block requires every scheduled workout paired; rest day waits until tomorrow', () => {
  assert.equal(blockReady(block,'2026-09-20',[]),false);
  const event = {start_date_local:'2026-09-20T10:00:00',category:'WORKOUT',paired_activity_id:'i1'};
  assert.equal(blockReady(block,'2026-09-20',[event]),true);
  assert.equal(blockReady(block,'2026-09-20',[event,{...event,paired_activity_id:null}]),false);
  assert.equal(blockReady(block,'2026-09-21',[]),true);
});
test('only active app plan defines contiguous blocks', () => {
  const weeks = block.weeks.map(w=>({startDate:w.start_date,endDate:w.end_date,phase:w.phase}));
  const manifest = reportBlockManifest([{id:'a',weeks},{id:'other',weeks:[]}],'a');
  assert.equal(manifest.blocks.length,1);
  assert.equal(manifest.blocks[0].end_date,block.end_date);
  assert.equal(reportBlockManifest([{id:'a',weeks}],'missing').blocks.length,0);
});
test('block source coverage required and missing observations remain unavailable', () => {
  assert.throws(()=>buildBlockReport(block,{weekly_180d:[]}),/history/);
  const text=buildBlockReport(block,{generated_at:'now',weekly_180d:block.weeks.map(w=>({week_start:w.start_date,total_hours:5,total_tss:200}))});
  assert.match(text,/10.00 hours and 400 TSS/);
  assert.match(text,/HRV Unavailable/);
});
test('block append preserves weekly text, verifies ambiguous write, and does not regenerate', async () => {
  let note={id:1, external_id:'section11-weekly-report-2026-09-14',description:'Existing weekly report'};
  let writes=0;
  const request=async (_,options) => {
    if (!options) return [note];
    writes++; note={...note,...JSON.parse(options.body)}; throw new Error('Network interrupted after write');
  };
  assert.deepEqual(await writeBlockNote(request,block,'Block text'),{saved:true});
  assert.match(note.description,/^Existing weekly report/);
  assert.deepEqual(await writeBlockNote(request,block,'Changed report'),{unchanged:true});
  assert.equal(writes,1);
});
