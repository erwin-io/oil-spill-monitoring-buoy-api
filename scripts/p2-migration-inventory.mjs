// Read-only. No production or emulator Firestore mutations are performed.
import {firebase} from '../src/firebase.js';
import {planReprovision} from '../src/migration-plan.js';
const {db}=firebase();
const records=[];let last=null;
do{
 let query=db.collection('devices').orderBy('__name__').limit(200);
 if(last)query=query.startAfter(last);
 const page=await query.get();
 for(const d of page.docs){
  const [measurements,alerts,outbox]=await Promise.all([
   d.ref.collection('measurements').count().get(),
   db.collection('alerts').where('deviceId','==',d.id).count().get(),
   db.collection('notificationOutbox').where('deviceId','==',d.id).count().get(),
  ]);
  records.push({deviceId:d.id,ownerUid:d.data().ownerUid??null,hasOwner:!!d.data().ownerUid,
   measurements:measurements.data().count,alerts:alerts.data().count,notificationOutbox:outbox.data().count});
 }
 if(page.size<200)break;
 last=page.docs.at(-1);
}while(last);
const report=planReprovision(records);
process.stdout.write(JSON.stringify({generatedAt:new Date().toISOString(),...report},null,2)+'\n');
// Deliberately no set/update/delete, credential retrieval, or cutover action.
