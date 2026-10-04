import test from 'node:test';
import assert from 'node:assert/strict';
import {parseInspections,parseJSON,normalizeStatus} from '../shared/protocol.js';
test('numeric vision codes match the three requested tower outputs',()=>{
  assert.deepEqual([1,2,3].map(normalizeStatus),['defected','good','repairable']);
  assert.equal(parseJSON('\uFEFF{"cloth_id":" A ","status":2}')[0].cloth_id,'A');
  assert.equal(parseInspections({cloths:[{cloth_id:'1',status:1},{cloth_id:'2',status:'non-defected'}]})[1].status_code,2);
});
test('invalid JSON and unsafe categories never become good results',()=>{
  for(const value of [0,4,null,true,{},'unknown','2.0'])assert.throws(()=>normalizeStatus(value));
  for(const input of [null,[],{cloth_id:'x'}, {cloth_id:'x',status:2,confidence:1.1},{cloth_id:'x',status:2,schema_version:2},{cloth_id:'x',status:2,defects:{}},{cloth_id:'',status:2}])assert.throws(()=>parseInspections(input));
  assert.throws(()=>parseJSON('{bad json}'));
  assert.throws(()=>parseInspections({cloths:[{cloth_id:'valid',status:2},{cloth_id:'invalid',status:99}]}));
  assert.throws(()=>parseJSON(' '.repeat(262145)));
  assert.throws(()=>parseInspections({schema_version:2,cloths:[{cloth_id:'x',status:2}]}));
});
