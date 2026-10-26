import {test} from 'node:test';
import assert from 'node:assert/strict';
import {indexSignature,missingRequiredIndexes} from '../scripts/firestore-index-signature.mjs';

test('Ignore Firestore-generated __name__ tie breaker when comparing deployed indexes',()=>{
 const expected={collectionGroup:'alerts',queryScope:'COLLECTION',fields:[
  {fieldPath:'deviceId',order:'ASCENDING'},{fieldPath:'createdAt',order:'DESCENDING'}
 ]};
 const deployed={...expected,density:'SPARSE_ALL',fields:[
  ...expected.fields,{fieldPath:'__name__',order:'DESCENDING'}
 ]};
 assert.equal(indexSignature(expected),indexSignature(deployed));
 assert.deepEqual(missingRequiredIndexes([expected],[deployed]),[]);
});

test('Report genuinely missing indexes while ignoring unrelated deployed indexes',()=>{
 const required=[
  {collectionGroup:'alerts',queryScope:'COLLECTION',fields:[{fieldPath:'status',order:'ASCENDING'},{fieldPath:'createdAt',order:'DESCENDING'}]},
  {collectionGroup:'notificationOutbox',queryScope:'COLLECTION',fields:[{fieldPath:'status',order:'ASCENDING'},{fieldPath:'leaseUntil',order:'ASCENDING'}]}
 ];
 const deployed=[{...required[1],fields:[...required[1].fields,{fieldPath:'__name__',order:'ASCENDING'}]}];
 assert.deepEqual(missingRequiredIndexes(required,deployed),[required[0]]);
});
