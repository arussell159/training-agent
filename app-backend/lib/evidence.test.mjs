import test from "node:test"
import assert from "node:assert/strict"
import { assertRecommendationEvidence, import8020BookPortions, validateEvidenceBundle } from "./evidence.mjs"
import { validateWorkoutRecommendation } from "./daily-review.mjs"

const passages = [{ source_id:"s1", passage_id:"p1", title:"Verified", url:"https://example.com", claims:["intensity_control"] }]
const athleteFacts = [{ id:"workout:42:duration", date:"2026-09-14", value:60, unit:"min" }]
const validEvidence = {
  published:[{ source_id:"s1", passage_id:"p1", claim:"intensity_control" }],
  athlete_data:[{ fact_id:"workout:42:duration", date:"2026-09-14" }],
  reasoning:"The verified session and principle support a conservative action.",
  coaching_judgment:"The exact implementation is individualized rather than prescribed by the source.",
  calculations:[],
}

test("fabricated citations are rejected", () => {
  assert.throws(() => assertRecommendationEvidence([{ action:"Keep effort controlled", evidence:{ ...validEvidence, published:[{ source_id:"made-up", passage_id:"fake", claim:"Anything" }] } }], { passages, athleteFacts }), /unretrieved citation/)
})

test("unsupported numerical adjustments are rejected", () => {
  const result = validateEvidenceBundle(validEvidence, { passages, athleteFacts, actionText:"Add 10 seconds rest" })
  assert.equal(result.valid, false)
  assert.match(result.errors.join(" "), /no verified calculation/)
})

test("incorrect athlete dates are rejected", () => {
  const result = validateEvidenceBundle({ ...validEvidence, athlete_data:[{ fact_id:"workout:42:duration", date:"2026-09-13" }] }, { passages, athleteFacts })
  assert.equal(result.valid, false)
  assert.match(result.errors.join(" "), /incorrect athlete date/)
})

test("personal coaching judgment may proceed without a decorative citation", () => {
  const result = validateEvidenceBundle({
    ...validEvidence,
    published:[],
    reasoning:"This athlete's dated feedback and workout record justify a personal adjustment.",
    coaching_judgment:"This is the coach's individualized judgment, not a published prescription.",
  }, { passages, athleteFacts, actionText:"Keep the session controlled" })
  assert.equal(result.valid, true)
})

test("book import requires readable, precisely located material", () => {
  assert.throws(() => import8020BookPortions({ title:"80/20 Triathlon", authors:["Matt Fitzgerald","David Warden"], portions:[{ locator:"highlight", text:"A short product highlight." }] }), /not readable|chapter, page, or Kindle/)
  const imported = import8020BookPortions({ title:"80/20 Triathlon", authors:["Matt Fitzgerald","David Warden"], portions:[{ locator:"Chapter 2, page 31", text:"This is a readable supplied passage long enough to be indexed as a discrete portion of the user's copy.", claims:["easy_intensity"] }] })
  assert.equal(imported.passages.length, 1)
  assert.match(imported.scope_note, /Only 1 supplied portion/)
})

test("swim work encoded as time is rejected before presentation", () => {
  const item = { workout_id:"42", patch:{ structure:JSON.stringify({ visualizationDistanceUnit:"yard", structure:[{ steps:[{ name:"100 strong", intensityClass:"active", length:{ value:100, unit:"second" } }] }] }) } }
  const result = validateWorkoutRecommendation(item, { id:"42", sport:"Swim" })
  assert.equal(result.valid, false)
  assert.match(result.errors.join(" "), /incorrectly encoded as seconds/)
})
