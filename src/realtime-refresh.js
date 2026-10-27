import {randomUUID} from 'node:crypto';
// Queue a minimal invalidation notification in the SAME Firestore commit as
// its domain change. The existing outbox dispatcher delivers this through
// Pusher, so serverless requests do not rely on unawaited background work.
// Messages carry IDs and resource names only: never credentials or private data.
export function queueRefresh(writer,db,{uid,deviceId,resource,uids=[]}){
 const recipients=[...new Set(uids.filter(value=>typeof value==='string'&&value.length>0))];
 if(!uid&&!deviceId&&!recipients.length)return;
 const stamp=new Date().toISOString();
 const payload={resource};
 if(uid)payload.uid=uid;
 if(deviceId)payload.deviceId=deviceId;
 const job={
  type:'data.changed',deviceId:deviceId??null,payload,status:'PENDING',
  attempts:0,nextAttemptAt:stamp,createdAt:stamp,leaseUntil:null,
  ...(recipients.length?{notifyUsers:recipients}:{})
 };
 writer.create(db.collection('notificationOutbox').doc('refresh_'+randomUUID()),job);
}
