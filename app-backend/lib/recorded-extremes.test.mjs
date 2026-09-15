import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recordedExtremes} from './recorded-extremes.mjs';
test('recorded extrema keep real zero power, exclude stopped pace and missing heart rate',()=>{
 assert.deepEqual(recordedExtremes([{type:'heartrate',data:[null,0,101,168]},{type:'velocity_smooth',data:[null,0,2,5]},{type:'watts',data:[0,120,260]}]),{min_hr:101,max_hr:168,min_speed:2,max_speed:5,min_power:0,max_power:260});
 assert.deepEqual(recordedExtremes([]),{});
});
