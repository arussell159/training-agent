// Compare committed implementation data with actual observed reference DOM.
// This is a field-catalog check, not visual/pixel or algorithm certification.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { raceEventTypeGroups, raceAtpEventTypes, runningRaceDistances } from "../app-backend/lib/race-event-details-model.mjs";
const input=path.resolve(process.argv[2] || "artifacts/trainingpeaks-parity/reference-event-conditional-catalogs.json");
const actual=JSON.parse(await fs.readFile(input,"utf8"));
const observedTypes=new Set(actual.map(row=>row.type));
const implemented=raceEventTypeGroups.flatMap(group=>group.options.map(([value])=>value));
assert.deepEqual([...observedTypes].sort(),[...implemented].sort(),"Every selectable reference type needs actual conditional-field evidence");
const normalize=options=>options.map(({value,label})=>[value==="NONE_SELECTED"?"":value,label]);
for(const row of actual) {
  const atp=row.fields.find(field=>field.name==="raceTypeDuration");
  assert.ok(atp,`${row.type}: observed ATP field`);
  assert.deepEqual(raceAtpEventTypes(row.type),normalize(atp.options),`${row.type}: exact ordered ATP options`);
  const distance=row.fields.find(field=>field.name==="distance");
  assert.equal(Boolean(distance),row.type.startsWith("Running"),`${row.type}: distance field visibility`);
  if(distance)assert.deepEqual(runningRaceDistances,normalize(distance.options));
}
console.log(JSON.stringify({types:actual.length,orderedAtpCatalogsMatched:true,runningDistanceMatched:true,referenceParityClaim:false,reference:input}));
