import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const dataPath = path.join(root, "local-data.json")
const DAY = 86_400_000
const sports = ["Run", "Bike", "Swim", "Run", "Bike", "Recovery", "Swim"]
const titles = { Run:"Aerobic run", Bike:"Endurance ride", Swim:"Technique + aerobic", Recovery:"Rest day" }

function dateAt(offset) { return new Date(Date.UTC(2026, 8, 14) + offset * DAY).toISOString().slice(0, 10) }
function buildHistory() {
  return Array.from({ length:90 }, (_, index) => {
    const daysAgo = 89 - index, sport = sports[index % sports.length]
    const completed = sport !== "Recovery" && index % 13 !== 0
    const duration = sport === "Bike" ? 75 + index % 35 : sport === "Run" ? 38 + index % 25 : sport === "Swim" ? 45 + index % 15 : 0
    const compliance = completed ? Math.min(108, 87 + index % 18) : sport === "Recovery" ? 100 : 0
    return {
      id:`history-${daysAgo}`, athlete_id:"default", workout_date:dateAt(-daysAgo), sport,
      title:titles[sport], planned:{ duration_minutes:duration, tss:Math.round(duration * (sport === "Bike" ? .82 : .72)), purpose:sport === "Recovery" ? "Absorb training" : "Build repeatable aerobic fitness" },
      completed:completed ? { duration_minutes:Math.round(duration * compliance / 100), distance: sport === "Bike" ? Math.round(duration * .48 * 10) / 10 : sport === "Run" ? Math.round(duration * .115 * 10) / 10 : Math.round(duration * 45), avg_hr: sport === "Swim" ? 128 : 136 + index % 9, normalized_power:sport === "Bike" ? 201 + index % 24 : null, rpe:4 + index % 4 } : {},
      recovery:{ score:58 + index % 31, sleep_hours:Math.round((6.4 + index % 13 / 10) * 10) / 10, hrv:47 + index % 16, resting_hr:46 + index % 7 },
      compliance, risk_level:index % 17 === 0 ? "medium" : "low", failure_signals:index % 29 === 0 ? ["late_interval_fade","elevated_rpe"] : [],
      post_comment:index % 29 === 0 ? "Legs faded late; breathing stayed controlled." : index % 11 === 0 ? "Felt smooth and controlled." : ""
    }
  })
}

const planned = [
  {id:"mon",day:"MON",date:"Sep 14",workout_date:"2026-09-14",sport:"Swim",title:"Easy technique",duration:"45 min",goal:"Stay relaxed and sharpen feel for the water.",details:"Warm Up:\n1 x (200 FS in Z2 + 100 Drill in Z2 + 20 secs rest).\n\nMain Set:\n6 x (100 FS in Z2 + 20 secs rest),\n4 x (50 Build in Z3 + 20 secs rest).\n\nWarm Down:\n1 x (200 Choice in Z2).",status:"completed",risk:"low",load:31},
  {id:"tue",day:"TUE",date:"Sep 15",workout_date:"2026-09-15",sport:"Bike",title:"Race power touch",duration:"1h 05m",goal:"Keep race power familiar without carrying fatigue forward.",details:"15 min easy · 3 × 8 min @ 240–250W · 4 min easy · 10 min cool down",status:"today",risk:"medium",load:54,recommendation:"Drop the three blocks by 10–15 watts after yesterday’s poor recovery score."},
  {id:"wed",day:"WED",date:"Sep 16",workout_date:"2026-09-16",sport:"Run",title:"Easy + strides",duration:"40 min",goal:"Keep cadence sharp while protecting freshness.",details:"30 min Z2 · 4 × 20 sec strides · full easy recovery",status:"upcoming",risk:"low",load:36},
  {id:"thu",day:"THU",date:"Sep 17",workout_date:"2026-09-17",sport:"Swim",title:"Race rhythm",duration:"50 min",goal:"Rehearse smooth race rhythm with controlled breathing.",details:"400 easy · 8 × 100 race rhythm · 200 choice",status:"upcoming",risk:"low",load:42},
  {id:"fri",day:"FRI",date:"Sep 18",workout_date:"2026-09-18",sport:"Recovery",title:"Rest day",duration:"—",goal:"Absorb the week and arrive fresh for Saturday.",details:"Walk and mobility only.",status:"upcoming",risk:"low",load:0},
  {id:"sat",day:"SAT",date:"Sep 19",workout_date:"2026-09-19",sport:"Bike",title:"Race rehearsal brick",duration:"1h 40m",goal:"Confirm pacing and fueling; finish with more available.",details:"Bike 75 min with 2 × 15 min race power · Run 20 min easy",status:"upcoming",risk:"medium",load:86},
  {id:"sun",day:"SUN",date:"Sep 20",workout_date:"2026-09-20",sport:"Run",title:"Easy aerobic",duration:"50 min",goal:"Keep this easy and finish the week feeling better.",details:"50 min Z2. No fast finish.",status:"upcoming",risk:"low",load:44}
]

function seed() { return { athlete:{name:"Alex Russell",race:"IRONMAN 70.3 Waco",race_date:"2026-09-27",phase:"taper",zones:{bike_ftp:278,run_threshold_pace:"7:12/mi",swim_css:"1:38/100yd",threshold_hr:168}},metrics:{fitness:71,fatigue:67,form:4,recovery:62,compliance_30d:91,readiness:78},history:buildHistory(),planned,comments:[{id:"comment-1",workout_id:"history-2",type:"post",body:"Final reps faded. Legs were the limiter, not breathing.",created_at:"2026-09-12T15:30:00Z"}],library:[{id:"lib1",sport:"Bike",title:"Controlled race power",duration:"75 min",purpose:"Race-specific power without residual fatigue",tags:["Taper","70.3"]},{id:"lib2",sport:"Run",title:"Threshold cruise intervals",duration:"55 min",purpose:"Accumulate controlled sub-threshold volume",tags:["Threshold","Repeatable"]},{id:"lib3",sport:"Swim",title:"CSS rhythm + form",duration:"50 min",purpose:"Hold form while accumulating steady CSS work",tags:["CSS","Technique"]}],updated_at:new Date().toISOString()} }

export async function readLocalContext() { try { return JSON.parse(await fs.readFile(dataPath,"utf8")) } catch { const data=seed(); await fs.writeFile(dataPath,JSON.stringify(data,null,2)); return data } }
export async function updateLocalWorkout(id, change) { const data=await readLocalContext(); const workout=data.planned.find(item=>item.id===id); if(!workout) throw new Error("Workout not found"); workout.changed=true; workout.recommendation=change; workout.updated_at=new Date().toISOString(); data.updated_at=workout.updated_at; await fs.writeFile(dataPath,JSON.stringify(data,null,2)); return workout }
export async function addLocalComment(workoutId, body) { const data=await readLocalContext(); const comment={id:`comment-${Date.now()}`,workout_id:workoutId,type:"post",body,created_at:new Date().toISOString()}; data.comments.unshift(comment); await fs.writeFile(dataPath,JSON.stringify(data,null,2)); return comment }
