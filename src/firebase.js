import { initializeApp, getApps, applicationDefault, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getMessaging } from 'firebase-admin/messaging';
export function firebase(){
 if(!getApps().length){
  const {FIREBASE_PROJECT_ID:p,FIREBASE_CLIENT_EMAIL:e,FIREBASE_PRIVATE_KEY:k}=process.env;
  const credential=e&&k?cert({projectId:p,clientEmail:e,privateKey:k.replace(/\\n/g,'\n')}):applicationDefault();
  initializeApp({credential,projectId:p||undefined});
 }
 return {db:getFirestore(),auth:getAuth(),messaging:getMessaging()};
}
