export default {
 openapi:'3.0.3',info:{title:'BlueWatch Oil Spill Monitoring Buoys API',version:'0.1.0',description:'Raw-seawater UV fluorescence telemetry is advisory, not certified oil concentration.'},
 servers:[{url:'/'}],components:{securitySchemes:{firebaseAuth:{type:'http',scheme:'bearer',bearerFormat:'Firebase ID token'},deviceKey:{type:'apiKey',in:'header',name:'X-Device-Key'},deviceId:{type:'apiKey',in:'header',name:'X-Device-ID'}}},
 paths:[
  ['get','/health','Health'],['post','/api/v1/auth/bootstrap','First-login provisioning'],['get','/api/v1/auth/me','My profile'],
  ['get','/api/v1/devices','Fleet list'],['post','/api/v1/devices','Register buoy'],['get','/api/v1/devices/{deviceId}','Buoy detail'],['patch','/api/v1/devices/{deviceId}','Update buoy'],['post','/api/v1/devices/{deviceId}/rotate-key','Rotate buoy secret'],
  ['post','/api/v1/device/measurements','Ingest raw seawater measurement'],['post','/api/v1/device/health','Ingest health'],['get','/api/v1/devices/{deviceId}/measurements','History'],['get','/api/v1/devices/{deviceId}/measurements/latest','Latest'],['get','/api/v1/devices/{deviceId}/health','Health history'],
  ['get','/api/v1/device/config','Buoy desired configuration'],['get','/api/v1/devices/{deviceId}/config','Monitoring user desired configuration'],['put','/api/v1/devices/{deviceId}/config','Update config'],
  ['get','/api/v1/alerts','Alerts'],['get','/api/v1/alerts/{alertId}','Alert detail'],['patch','/api/v1/alerts/{alertId}/acknowledge','Acknowledge'],['post','/api/v1/notifications/register-device','Register FCM token'],['delete','/api/v1/notifications/unregister-device','Unregister FCM token'],['post','/api/v1/realtime/auth','Private Pusher auth']
 ].reduce((a,[method,path,summary])=>{a[path]??={};a[path][method]={summary,responses:{200:{description:'Success'},401:{description:'Unauthorized'},403:{description:'Forbidden'},422:{description:'Invalid input'}}};return a}, {})
};
