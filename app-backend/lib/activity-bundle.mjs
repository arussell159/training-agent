import {createHash} from 'node:crypto';
import {readFitLaps,normalizeAnalysis} from './activity-analysis.mjs';
import {activityRoute} from './activity-route.mjs';
import {recordedExtremes} from './recorded-extremes.mjs';
import {mapIntervalsWorkout} from './intervals.mjs';

export async function downloadOriginalActivityFile(config,id,fetchImpl=fetch) {
  const response=await fetchImpl(`https://intervals.icu/api/v1/activity/${id}/file`,{
    headers:{Authorization:`Basic ${Buffer.from('API_KEY:'+config.INTERVALS_API_KEY).toString('base64')}`},signal:AbortSignal.timeout(30000),
  });
  if(response.status===404)return null;
  if(!response.ok)throw new Error(`Original activity file download failed (${response.status})`);
  return Buffer.from(await response.arrayBuffer());
}

export async function downloadActivityBundle(request,id,downloadFile) {
  if(!/^(i\d+|\d+)$/.test(String(id)))throw new Error('Invalid activity ID');
  const activity=await request(`/activity/${id}?intervals=true`);
  let streams=[];
  try { streams=await request(`/activity/${id}/streams.json`) || []; }
  catch(error){if(error.status!==404)throw error;}
  const bytes=activity.file_type ? await downloadFile(id) : null;
  const fitLaps=bytes && activity.file_type==='fit' ? readFitLaps(bytes) : [];
  const analysis=normalizeAnalysis(activity,streams,fitLaps);
  const summary=mapIntervalsWorkout(activity,String(activity.start_date_local || '').slice(0,10),null,true).workout_summary.completed;
  Object.assign(summary,recordedExtremes(streams));
  return {
    version:1,activity,streams,fitLaps,analysis,summary,route:activityRoute(streams),
    original_file:bytes ? {type:activity.file_type,encoding:'base64',data:bytes.toString('base64'),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')} : null,
    availability:{streams:streams.length>0,original_file:Boolean(bytes)},
  };
}

export function loadActivityBundle(archive,config,request,id) {
  return archive.load(id,'bundle',()=>downloadActivityBundle(request,id,fileId=>downloadOriginalActivityFile(config,fileId)));
}
