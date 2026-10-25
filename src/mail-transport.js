import nodemailer from 'nodemailer';

// A single provider selection for authentication, invitation and explicit test
// mail. Firebase Authentication, one-time action codes and account ACLs stay
// entirely within Firebase. SMTP is delivery only.
const email=/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const provided=value=>typeof value==='string'&&!!value.trim()&&
  !/^(REPLACE_WITH|YOUR_|CHANGE_ME|TODO|EXAMPLE)/i.test(value.trim());
const addressFrom=value=>{
  if(!provided(value)||/[\r\n]/.test(value))return null;
  const match=/^(?:"?[^<>\r\n"]{1,100}"?\s*)?<([^<>]+)>$/.exec(value.trim());
  const address=(match?.[1]??value.trim()).toLowerCase();
  return email.test(address)?address:null;
};
export function emailProvider(env=process.env){
  const selected=(env.P2_EMAIL_PROVIDER||'resend').trim().toLowerCase();
  return ['smtp','resend'].includes(selected)?selected:null;
}
export function smtpSettings(env=process.env){
  const host=env.SMTP_HOST?.trim();
  const port=Number(env.SMTP_PORT);
  const secure=env.SMTP_SECURE;
  const user=env.SMTP_USER?.trim().toLowerCase();
  const password=env.SMTP_PASSWORD?.replace(/\s/g,'');
  const from=env.SMTP_FROM?.trim();
  if(!provided(host)||!/^[a-zA-Z0-9.-]{3,255}$/.test(host)||
    ![465,587].includes(port)||!['true','false'].includes(secure)||
    (port===465)!==(secure==='true')||!provided(user)||!email.test(user)||
    !provided(password)||password.length<12||!addressFrom(from)||
    addressFrom(from)!==user)return null;
  // Gmail app passwords are 16 characters, though other SMTP providers can
  // use longer credentials. Do not persist or log these settings.
  return {
    host,port,secure:secure==='true',
    requireTLS:port===587,
    auth:{user,pass:password},
    from,
    connectionTimeout:15000,greetingTimeout:10000,socketTimeout:20000,
    tls:{minVersion:'TLSv1.2',rejectUnauthorized:true,servername:host}
  };
}
export function mailConfigReady(env=process.env){
  const provider=emailProvider(env);
  if(provider==='smtp')return !!smtpSettings(env);
  if(provider==='resend')return provided(env.P2_EMAIL_API_KEY)&&!!addressFrom(env.P2_EMAIL_FROM);
  return false;
}
export function mailReadiness(env=process.env){
  return mailConfigReady(env)?emailProvider(env):'firebase';
}
function sender(env){
  return emailProvider(env)==='smtp'?env.SMTP_FROM:env.P2_EMAIL_FROM;
}
// Provider response detail and one-time Firebase URLs are never logged.
// Failed SMTP delivery is fail-closed; no automatic fallback or duplicate send.
export async function sendTransactionalEmail({to,subject,text},opts={}){
  const env=opts.env||process.env;
  if(!mailConfigReady(env)||!email.test(to||'')||!/^[^\r\n]{1,160}$/.test(subject||'')||
     typeof text!=='string'||text.length>16000) return false;
  const from=sender(env);
  if(emailProvider(env)==='smtp'){
    const config=smtpSettings(env);
    const factory=opts.createTransport||nodemailer.createTransport;
    const transport=factory({
      host:config.host,port:config.port,secure:config.secure,
      requireTLS:config.requireTLS,auth:config.auth,
      tls:config.tls,connectionTimeout:config.connectionTimeout,
      greetingTimeout:config.greetingTimeout,socketTimeout:config.socketTimeout,
      pool:false,
    });
    try{
      const result=await transport.sendMail({
        from,to,subject,text,
        disableFileAccess:true,disableUrlAccess:true,
      });
      return Array.isArray(result?.accepted)&&result.accepted.some(x=>x.toLowerCase()===to.toLowerCase())&&
        (!Array.isArray(result.rejected)||result.rejected.every(x=>x.toLowerCase()!==to.toLowerCase()));
    }catch{return false}
    finally{transport.close?.()}
  }
  const fetchImpl=opts.fetch||fetch;
  try{
    const response=await fetchImpl('https://api.resend.com/emails',{
      method:'POST',headers:{Authorization:'Bearer '+env.P2_EMAIL_API_KEY,'Content-Type':'application/json'},
      body:JSON.stringify({from,to:[to],subject,text}),signal:AbortSignal.timeout(15000),
    });
    if(!response.ok)return false;
    const body=await response.json();
    return typeof body.id==='string'&&body.id.length>0;
  }catch{return false}
}
export async function verifySmtpConnection(opts={}){
  const env=opts.env||process.env;
  const settings=smtpSettings(env);
  if(!settings)return false;
  const factory=opts.createTransport||nodemailer.createTransport;
  const transport=factory({
    host:settings.host,port:settings.port,secure:settings.secure,
    requireTLS:settings.requireTLS,auth:settings.auth,tls:settings.tls,
    connectionTimeout:settings.connectionTimeout,
    greetingTimeout:settings.greetingTimeout,socketTimeout:settings.socketTimeout,
    pool:false
  });
  try{return await transport.verify()===true}
  catch{return false}
  finally{transport.close?.()}
}
