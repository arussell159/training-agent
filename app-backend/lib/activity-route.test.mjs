import {test} from 'node:test';
import assert from 'node:assert/strict';
import {activityRoute} from './activity-route.mjs';
test('GPS supports separate Intervals latitude/longitude arrays and skips missing coordinates',()=>{
 assert.deepEqual(activityRoute([{type:'latlng',data:[null,30,31],data2:[null,-97,-98]}]),[[30,-97],[31,-98]]);
 assert.deepEqual(activityRoute([{type:'latlng',data:[[30,-97],[null,-97]]}]),[[30,-97]]);
 assert.deepEqual(activityRoute([]),[]);
});
