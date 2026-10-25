import {canRead,httpError} from './domain.js';

// The old ACL is temporary only for unclaimed devices before the separately
// authorized clean re-provisioning cutover. Claimed devices never inherit it.
export async function accessLevel(db,user,id,tx=null){
 const ref=db.collection('devices').doc(id),device=await (tx?tx.get(ref):ref.get());
 if(!device.exists)return 'NONE';
 if(device.data().ownerUid){
  if(device.data().ownerUid===user?.uid)return 'OWNER';
  if(!user?.uid)return 'NONE';
  const viewerRef=ref.collection('viewers').doc(user.uid);
  const viewer=await (tx?tx.get(viewerRef):viewerRef.get());
  return viewer.exists&&viewer.data().status==='ACTIVE'&&viewer.data().invitedBy===device.data().ownerUid?'VIEWER':'NONE';
 }
 if(process.env.P2_STRICT_OWNERSHIP==='true')return 'NONE';
 return canRead(user,id)?user.role==='ADMIN'?'LEGACY_ADMIN':'LEGACY_VIEWER':'NONE';
}
export async function requireAccess(db,user,id,kind='READ',tx=null){
 const level=await accessLevel(db,user,id,tx);
 const permitted=kind==='READ'?level!=='NONE':kind==='OWNER'?level==='OWNER':
  level==='OWNER'||level==='LEGACY_ADMIN'||level==='LEGACY_VIEWER'&&user.role==='OPERATOR';
 if(!permitted)throw httpError('FORBIDDEN',403);
 return level;
}

export async function accessibleDeviceIds(db,user){
 const ids=new Set();
 const owned=await db.collection('devices').where('ownerUid','==',user.uid).get();
 for(const doc of owned.docs)ids.add(doc.id);
 const shared=await db.collection('users').doc(user.uid).collection('sharedDevices').get();
 for(const doc of shared.docs)ids.add(doc.id);
 if(process.env.P2_STRICT_OWNERSHIP!=='true'){
  if(user.role==='ADMIN'){
   let last=null;
   do{
    let q=db.collection('devices').orderBy('__name__').limit(200);
    if(last)q=q.startAfter(last);
    const page=await q.get();
    for(const doc of page.docs)if(!doc.data().ownerUid)ids.add(doc.id);
    if(page.size<200)break;
    last=page.docs.at(-1);
   }while(last);
  }else for(const id of user.allowedDeviceIds??[])ids.add(id);
 }
 const verified=await Promise.all([...ids].map(async id=>await accessLevel(db,user,id)!=='NONE'?id:null));
 return verified.filter(Boolean);
}
