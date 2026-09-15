import {test} from 'node:test';
import assert from 'node:assert/strict';
import {formatDuration} from '../../ui/src/lib/duration.ts';
test('durations consistently display padded hours and minutes',()=>{
 assert.equal(formatDuration(0),'00h 00m');
 assert.equal(formatDuration(59.9),'01h 00m');
 assert.equal(formatDuration(108.01),'01h 48m');
 assert.equal(formatDuration(25),'00h 25m');
 assert.equal(formatDuration(NaN),'—');
});
