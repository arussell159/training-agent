import { createHash } from "node:crypto"
import fs from "node:fs/promises"

const RECOMMENDATION = /\b(recommend|should|plan|target|adjust|change|increase|decrease|reduce|add|remove|replace|rest|pace|power|repetitions?|reps?|seconds?|minutes?|watts?|bpm|race time|goal time)\b/i
const BOOK_TITLE = /80\s*\/\s*20\s+triathlon/i

function hash(value) {
  return createHash("sha256").update(String(value)).digest("hex")
}

function tokens(value) {
  return new Set(String(value || "").toLowerCase().match(/[a-z0-9]+/g) || [])
}

function score(query, passage) {
  const wanted = tokens(query)
  const available = tokens(`${passage.text} ${(passage.claims || []).join(" ")}`)
  let total = 0
  for (const token of wanted) if (available.has(token)) total += token.length > 5 ? 3 : 1
  return total
}

export async function readKnowledgeBase(path) {
  const data = JSON.parse(await fs.readFile(path, "utf8"))
  if (!Array.isArray(data.sources) || !Array.isArray(data.imports)) throw new Error("Invalid evidence registry")
  return data
}

export async function writeKnowledgeBase(path, data) {
  const temporary = `${path}.tmp`
  await fs.writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, "utf8")
  await fs.rename(temporary, path)
}

export function verifiedPassages(knowledge) {
  return [...knowledge.sources, ...knowledge.imports]
    .filter(source => source.retrieval_status === "verified")
    .flatMap(source => (source.passages || []).map(passage => ({
      source_id:source.id,
      passage_id:passage.id,
      title:source.title,
      authors:source.authors,
      published_date:source.published_date,
      url:source.url,
      source_kind:source.source_kind,
      scope_note:source.scope_note,
      ...passage,
    })))
}

export function retrieveEvidence(knowledge, query, { limit = 8 } = {}) {
  return verifiedPassages(knowledge)
    .map(passage => ({ ...passage, retrieval_score:score(query, passage) }))
    .filter(passage => passage.retrieval_score > 0)
    .sort((left, right) => right.retrieval_score - left.retrieval_score || left.source_id.localeCompare(right.source_id))
    .slice(0, limit)
}

export function athleteEvidence(context, workouts = [], localDate) {
  const facts = []
  const add = (id, date, field, value, unit, source = "athlete_record") => {
    if (value === undefined || value === null || value === "" || (typeof value === "number" && !Number.isFinite(value))) return
    facts.push({ id, date, field, value, unit:unit || null, source, classification:"measured" })
  }
  for (const workout of workouts) {
    const id = String(workout.id)
    add(`workout:${id}:date`, workout.workout_date, "workout_date", workout.workout_date, "date", "scheduled_workout")
    add(`workout:${id}:title`, workout.workout_date, "title", workout.title, null, "scheduled_workout")
    add(`workout:${id}:duration`, workout.workout_date, "planned_duration", Number(workout.plannedDurationMinutes ?? workout.planned?.duration_minutes), "min", "scheduled_workout")
    add(`workout:${id}:tss`, workout.workout_date, "planned_tss", Number(workout.planned?.tss ?? workout.load), "TSS", "scheduled_workout")
    add(`workout:${id}:description`, workout.workout_date, "description", workout.details || workout.description, null, "scheduled_workout")
    add(`workout:${id}:structure`, workout.workout_date, "structure", workout.structure, null, "scheduled_workout")
  }
  const wellness = context.wellness || {}
  add(`wellness:${localDate}:hrv`, localDate, "hrv", Number(wellness.hrv), "ms")
  add(`wellness:${localDate}:resting_hr`, localDate, "resting_heart_rate", Number(wellness.resting_hr), "bpm")
  for (const [field, unit] of [["fitness","CTL"],["fatigue","ATL"],["form","TSB"],["recovery","percent"]]) {
    add(`metrics:${localDate}:${field}`, localDate, field, Number(context.metrics?.[field]), unit, "calculated_training_metric")
  }
  for (const item of (context.history || context.workouts || []).filter(item => item.workout_date <= localDate).slice(-90)) {
    const id = String(item.id || item.workout_id || hash(JSON.stringify(item)).slice(0,12))
    add(`history:${id}:duration`, item.workout_date, "completed_duration", Number(item.completed?.duration_minutes ?? item.completed_data?.duration_minutes ?? item.actualDurationMinutes), "min")
    add(`history:${id}:tss`, item.workout_date, "completed_tss", Number(item.completed?.tss ?? item.completed_data?.tss), "TSS")
    add(`history:${id}:rpe`, item.workout_date, "rpe", Number(item.completed?.rpe ?? item.rpe), "/10")
    add(`history:${id}:compliance`, item.workout_date, "compliance", Number(item.compliance), "percent", "calculated_training_metric")
    add(`history:${id}:comment`, item.workout_date, "athlete_feedback", item.post_comment || item.athleteComments, null)
  }
  return facts
}

export function validateCalculation(calculation) {
  if (!calculation || typeof calculation !== "object") return false
  const numbers = (calculation.inputs || []).map(input => Number(input.value))
  if (!numbers.length || numbers.some(value => !Number.isFinite(value))) return false
  let result
  if (calculation.operation === "difference") result = numbers[0] - numbers[1]
  else if (calculation.operation === "sum") result = numbers.reduce((sum, value) => sum + value, 0)
  else if (calculation.operation === "product") result = numbers.reduce((product, value) => product * value, 1)
  else if (calculation.operation === "percent_of") result = numbers[0] * numbers[1] / 100
  else if (calculation.operation === "percent_change") result = (numbers[1] - numbers[0]) / numbers[0] * 100
  else return false
  return Math.abs(Number(calculation.result) - result) <= Math.max(0.01, Math.abs(result) * 0.001)
}

export function validateEvidenceBundle(bundle, { passages, athleteFacts, actionText = "" }) {
  const errors = []
  const passageMap = new Map(passages.map(item => [`${item.source_id}:${item.passage_id}`, item]))
  const factMap = new Map(athleteFacts.map(item => [item.id, item]))
  if (!bundle || typeof bundle !== "object") return { valid:false, errors:["missing evidence bundle"] }
  if (!Array.isArray(bundle.published)) errors.push("published guidance must be an array")
  for (const citation of bundle.published || []) {
    const passage = passageMap.get(`${citation.source_id}:${citation.passage_id}`)
    if (!passage) errors.push(`unretrieved citation ${citation.source_id}:${citation.passage_id}`)
    else if (!(passage.claims || []).includes(citation.claim)) errors.push(`passage ${citation.passage_id} does not support claim ${citation.claim}`)
  }
  if (!Array.isArray(bundle.athlete_data) || !bundle.athlete_data.length) errors.push("missing athlete data")
  for (const reference of bundle.athlete_data || []) {
    const fact = factMap.get(reference.fact_id)
    if (!fact) errors.push(`unknown athlete fact ${reference.fact_id}`)
    else if (reference.date && reference.date !== fact.date) errors.push(`incorrect athlete date for ${reference.fact_id}`)
  }
  if (!String(bundle.reasoning || "").trim()) errors.push("missing evidence-to-action reasoning")
  if (!String(bundle.coaching_judgment || "").trim()) errors.push("coaching judgment is not identified")
  if (!(bundle.published || []).length && !/coach|judgment|experience|personal|athlete/i.test(`${bundle.coaching_judgment} ${bundle.reasoning}`)) {
    errors.push("source-free recommendation is not clearly identified as coaching judgment")
  }
  for (const calculation of bundle.calculations || []) if (!validateCalculation(calculation)) errors.push(`invalid calculation ${calculation.id || "unnamed"}`)
  if (/\b\d+(?:\.\d+)?\s*(?:sec(?:ond)?s?|min(?:ute)?s?|%|watts?|bpm|\/100|\/mi)\b/i.test(actionText) && !(bundle.calculations || []).length) {
    errors.push("numerical action has no verified calculation")
  }
  return { valid:errors.length === 0, errors }
}

export function assertRecommendationEvidence(recommendations, options) {
  const errors = []
  for (const [index, recommendation] of (recommendations || []).entries()) {
    const result = validateEvidenceBundle(recommendation.evidence, { ...options, actionText:recommendation.action || recommendation.statement || "" })
    errors.push(...result.errors.map(error => `recommendation ${index + 1}: ${error}`))
  }
  if (errors.length) throw new Error(`Recommendation withheld because its evidence could not be verified: ${errors.join("; ")}`)
  return true
}

export function containsUnstructuredRecommendation(answer) {
  return RECOMMENDATION.test(String(answer || ""))
}

export function renderRecommendation(recommendation, passageMap) {
  const links = (recommendation.evidence?.published || []).map(citation => {
    const passage = passageMap.get(`${citation.source_id}:${citation.passage_id}`)
    return passage ? `[${passage.title}](${passage.url})` : null
  }).filter(Boolean)
  const labels = [...new Set(links)].join(" · ")
  const judgment = recommendation.evidence?.coaching_judgment
  return `${recommendation.action || recommendation.statement}\n\nEvidence: ${recommendation.evidence.reasoning}${judgment ? ` Coaching judgment: ${judgment}` : ""}${labels ? ` [Sources: ${labels}]` : ""}`
}

export function import8020BookPortions(input, now = new Date()) {
  if (!input || !BOOK_TITLE.test(input.title || "")) throw new Error("The import title must identify 80/20 Triathlon")
  if (!Array.isArray(input.authors) || !input.authors.includes("Matt Fitzgerald") || !input.authors.includes("David Warden")) throw new Error("Both book authors must be identified")
  if (!Array.isArray(input.portions) || !input.portions.length) throw new Error("No readable book portions were provided")
  const passages = input.portions.map((portion, index) => {
    const text = String(portion.text || "").trim()
    const locator = String(portion.locator || "").trim()
    if (text.length < 40) throw new Error(`Portion ${index + 1} is not readable source material`)
    if (!locator || !/(chapter|page|kindle|location|loc\.?)/i.test(locator)) throw new Error(`Portion ${index + 1} needs a chapter, page, or Kindle-location reference`)
    return { id:`portion-${index + 1}-${hash(`${locator}:${text}`).slice(0,10)}`, locator, text, claims:Array.isArray(portion.claims) ? portion.claims.map(String) : [] , content_hash:hash(text) }
  })
  return {
    id:`8020-triathlon-import-${hash(passages.map(item => item.content_hash).join(":" )).slice(0,12)}`,
    title:String(input.title),
    authors:["Matt Fitzgerald", "David Warden"],
    edition:input.edition ? String(input.edition) : null,
    published_date:input.published_date || null,
    url:null,
    source_kind:"user_provided_book_excerpt",
    retrieval_status:"verified",
    imported_at:now.toISOString(),
    scope_note:`Only ${passages.length} supplied portion(s) are indexed. No other part of the book is available to the coach.`,
    passages,
  }
}
