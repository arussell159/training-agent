import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const shift = (day, n) => new Date(Date.parse(day) + n * 86400000).toISOString().slice(0, 10);
const value = (n, suffix = '') => n == null ? 'Unavailable' : `${n}${suffix}`;

export function blockReady(block, today, events) {
  if (block.end_date < today) return true;
  if (block.end_date !== today) return false;
  const planned = events.filter(e => String(e.start_date_local).slice(0, 10) === today && ['WORKOUT', 'RACE'].includes(e.category));
  return planned.length > 0 && planned.every(e => e.paired_activity_id);
}

export function buildBlockReport(block, history) {
  const rows = block.weeks.map(w => history.weekly_180d?.find(r => r.week_start === w.start_date));
  if (!rows.length || rows.some(r => !r)) throw new Error('Complete block history is not available.');
  if (rows.some(r => r.total_hours == null || r.total_tss == null)) throw new Error('Block volume history is incomplete.');
  const last = rows.at(-1);
  const before = history.weekly_180d.find(r => r.week_start === shift(block.start_date, -7));
  const hours = rows.reduce((n, r) => n + r.total_hours, 0);
  const tss = rows.reduce((n, r) => n + r.total_tss, 0);
  const lines = [
    `SECTION 11 — BLOCK REPORT (${block.start_date} – ${block.end_date})`,
    `Weeks in block: ${rows.length}`, `Phase: ${block.phase}`,
    `Data: history.json generated ${history.generated_at}`,
    '', 'COACH SUMMARY',
    `${block.phase} completed with ${hours.toFixed(2)} hours and ${Math.round(tss)} TSS across ${rows.length} weeks.`,
    '', 'PHASE TIMELINE',
    ...block.weeks.map((w, i) => `Wk ${i + 1} (${w.start_date} – ${w.end_date}): ${w.phase} (app plan)`),
    '', 'VOLUME PROGRESSION',
    ...rows.map((r, i) => `Wk ${i + 1}: ${r.total_hours} h / ${r.total_tss} TSS | CTL ${value(r.ctl_end)}`),
    `Block total: ${hours.toFixed(2)} h / ${Math.round(tss)} TSS`,
    '', 'COMPLIANCE',
    `Recorded activities: ${rows.every(r => r.activity_count != null) ? rows.reduce((n, r) => n + r.activity_count, 0) : 'Unavailable'}`,
    'Planned-session compliance and modification reasons: unavailable in historical summary; activity count is not a compliance percentage.',
    '', 'FITNESS PROGRESSION',
    ...[['CTL', 'ctl_end'], ['ATL', 'atl_end'], ['TSB', 'tsb_end']].map(([label, key]) => `${label}: ${value(before?.[key])} → ${value(last[key])}`),
    'Start values use the final day before the block; end values use the final week of the block.',
    `Avg ramp rate: ${rows.every(r => r.ramp_rate != null) ? (rows.reduce((n, r) => n + r.ramp_rate, 0) / rows.length).toFixed(2) + '/week' : 'Unavailable'}`,
    '', 'POLARIZATION BY WEEK',
    ...rows.map((r, i) => `Wk ${i + 1}: Z1+Z2 ${value(r.z1_z2_pct, '%')} | Z3 ${value(r.z3_pct, '%')} | Z4+ ${value(r.z4_plus_pct, '%')}`),
  ];
  for (const [title, metric, samples, unit] of [['DURABILITY BY WEEK','durability_mean','durability_qualifying','%'], ['EFFICIENCY FACTOR BY WEEK','ef_mean','ef_qualifying',''], ['HR RECOVERY BY WEEK','hrrc_mean','hrrc_qualifying',' bpm']]) {
    lines.push('', title, ...rows.map((r, i) => `Wk ${i + 1}: ${value(r[metric], unit)} (${value(r[samples])} qualifying)`));
  }
  lines.push('', 'WELLNESS', ...rows.map((r, i) => `Wk ${i + 1}: HRV ${value(r.avg_hrv, ' ms')} | RHR ${value(r.avg_rhr, ' bpm')} | Sleep ${value(r.avg_sleep_hours, ' h')}`),
    '', 'PHASE PROGRESSION CHECK',
    'Historical weekly aggregates do not establish session-level performance, readiness, or advancement criteria. No phase-advance recommendation is inferred.',
    '', 'DATA LIMITATIONS',
    'Tested FTP changes, detailed compliance, performance markers, and session-level flags are not available in this historical report source. Missing values are not treated as zero.');
  return lines.join('\n');
}

export async function writeBlockNote(request, block, report) {
  const end = new Date(block.end_date + 'T00:00:00Z');
  const monday = shift(block.end_date, -((end.getUTCDay() + 6) % 7));
  const external = `section11-weekly-report-${monday}`;
  const marker = `[[SECTION11_REPORT:BLOCK:${block.start_date}:${block.end_date}]]`;
  const closing = `[[/SECTION11_REPORT:BLOCK:${block.start_date}:${block.end_date}]]`;
  const get = () => request(`events?oldest=${monday}&newest=${shift(monday, 6)}`);
  const matches = (await get()).filter(e => e.external_id === external);
  if (matches.length > 1) throw new Error('Multiple notes share the weekly report identifier.');
  const current = matches[0];
  if (current?.description?.includes(marker) && current.description.includes(closing)) return { unchanged: true };
  const description = [current?.description?.trim(), `${marker}\n${report}\n${closing}`].filter(Boolean).join('\n\n');
  let error;
  try {
    if (current) await request(`events/${current.id}`, { method: 'PUT', body: JSON.stringify({ description }) });
    else await request('events/bulk?upsert=true', { method: 'POST', body: JSON.stringify([{ category:'NOTE', type:'Other', start_date_local:`${monday}T00:00:00`, for_week:true, external_id:external, name:`Section 11 Weekly Notes — ${monday}`, description }]) });
  } catch (caught) { error = caught; }
  const after = (await get()).filter(e => e.external_id === external);
  if (after.length !== 1 || after[0].description !== description) throw error || new Error('Block report write could not be verified.');
  return { saved: true };
}

async function main() {
  const manifest = JSON.parse(await fs.readFile('app-report-blocks.json', 'utf8'));
  if (manifest.schema_version !== 1 || manifest.source !== 'training-agent-active-plan') throw new Error('Invalid app block schedule.');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: manifest.time_zone, year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date());
  const check = process.argv.includes('--check');
  const history = check ? null : JSON.parse(await fs.readFile('history.json', 'utf8'));
  if (history && (!Number.isFinite(Date.parse(history.generated_at)) || Date.now() - Date.parse(history.generated_at) > 2 * 3600000)) throw new Error('Refresh history before generating block reports.');
  const request = async (endpoint, options = {}) => {
    const response = await fetch(`https://intervals.icu/api/v1/athlete/${encodeURIComponent(process.env.ATHLETE_ID)}/${endpoint}`, { ...options, headers:{ Authorization:`Basic ${Buffer.from(`API_KEY:${process.env.INTERVALS_KEY}`).toString('base64')}`, 'Content-Type':'application/json' }, signal:AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Intervals.icu returned ${response.status}.`);
    return response.status === 204 ? null : response.json();
  };
  let needsHistory = false;
  for (const block of manifest.blocks) {
    if (block.end_date < manifest.enabled_from || block.end_date > today) continue;
    const events = await request(`events?oldest=${block.start_date}&newest=${block.end_date}`);
    const marker = `[[SECTION11_REPORT:BLOCK:${block.start_date}:${block.end_date}]]`;
    if (events.some(e => e.description?.includes(marker))) continue;
    if (!blockReady(block, today, events)) continue;
    needsHistory = true;
    if (check) continue;
    console.log(JSON.stringify({ block: block.start_date, ...await writeBlockNote(request, block, buildBlockReport(block, history)) }));
  }
  if (check && process.env.GITHUB_OUTPUT) await fs.appendFile(process.env.GITHUB_OUTPUT, `needs_history=${needsHistory}\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
