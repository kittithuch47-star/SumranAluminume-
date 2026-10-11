// Vercel Node.js function. Requires firebase-admin in package.json.
const admin = require('firebase-admin');
const MAX = 7 * 1024 * 1024; // Base64 payload including overhead; photo max ~5MB
if (!admin.apps.length) {
  const credential = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}');
  admin.initializeApp({ credential: admin.credential.cert(credential) });
}
const firestore = admin.firestore();
const BASE = 'artifacts/sumran-aluminum-billing/companies/sumran-aluminum-shop';
const kinds = new Set(['before','during','after','other']);
function send(res,status,obj){res.status(status).json(obj);}
async function gas(payload){
  const url=process.env.GOOGLE_APPS_SCRIPT_URL;
  const secret=process.env.DRIVE_BRIDGE_SECRET;
  if(!url||!secret)throw Error('Missing server Drive configuration');
  const response=await fetch(url,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({...payload,secret}),redirect:'follow',signal:AbortSignal.timeout(25000)});
  const raw=await response.text();let result;try{result=JSON.parse(raw);}catch{throw Error('Apps Script returned invalid response; check deployment access');}
  if(!response.ok||!result.ok)throw Error(result.error||'Drive operation failed');
  return result;
}
module.exports=async(req,res)=>{
  if(req.method!=='POST')return send(res,405,{error:'POST only'});
  res.setHeader('Cache-Control','no-store');
  try{
    const token=(req.headers.authorization||'').match(/^Bearer (.+)$/i)?.[1];
    if(!token)return send(res,401,{error:'Missing Firebase ID token'});
    const user=await admin.auth().verifyIdToken(token,true);
    if(!user.email_verified||user.firebase?.sign_in_provider!=='google.com')return send(res,403,{error:'Google Sign-In required'});
    const member=await firestore.doc(`${BASE}/members/${user.uid}`).get();
    if(!member.exists||member.get('active')!==true||!['owner','staff'].includes(member.get('role')))return send(res,403,{error:'Not an active shop member'});
    const {action,jobId,kind,fileId,contentType,data,name}=req.body||{};
    if(!/^[a-zA-Z0-9_-]{1,140}$/.test(jobId||''))return send(res,400,{error:'Invalid jobId'});
    const ref=firestore.doc(`${BASE}/warehouseJobPlans/${jobId}`);
    const plan=await ref.get();if(!plan.exists)return send(res,404,{error:'Job not found'});
    if(action==='upload'){
      if(!['photo','signature'].includes(kind))return send(res,400,{error:'Invalid kind'});
      if(typeof data!=='string'||data.length>MAX||data.length<20||!/^[A-Za-z0-9+/]+={0,2}$/.test(data))return send(res,413,{error:'Invalid or oversized image'});
      if(!['image/jpeg','image/png','image/webp'].includes(contentType))return send(res,400,{error:'Unsupported image type'});
      if(kind==='signature'&&contentType!=='image/png')return send(res,400,{error:'Signature must be PNG'});
      const bytes=Buffer.from(data,'base64');if(bytes.length>5*1024*1024)return send(res,413,{error:'Max 5MB per image'});
      const magic=contentType==='image/png'?bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')):contentType==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';
      if(!magic)return send(res,400,{error:'Image data does not match MIME type'});
      const result=await gas({action:'upload',jobId,kind,contentType,data,name:String(name||'').slice(0,120)});
      return send(res,200,{ok:true,fileId:result.fileId});
    }
    if(!/^[a-zA-Z0-9_-]{10,160}$/.test(fileId||''))return send(res,400,{error:'Invalid file ID'});
    const evidence=plan.get('evidence')||{};
    const owned=[...(evidence.photos||[]),...(evidence.signature?[evidence.signature]:[])].some(x=>x.provider==='drive'&&x.fileId===fileId);
    if(!owned)return send(res,403,{error:'File is not linked to this job'});
    if(action==='read'){
      const result=await gas({action:'read',jobId,fileId});return send(res,200,{ok:true,contentType:result.contentType,data:result.data});
    }
    if(action==='delete'){
      // Only call after removing metadata, so this endpoint intentionally does not delete linked evidence.
      return send(res,409,{error:'Delete is disabled to preserve audit evidence; remove metadata through authorized workflow first'});
    }
    return send(res,400,{error:'Unknown action'});
  }catch(e){console.error('Drive evidence:',e.message);return send(res,500,{error:'Drive request failed: '+e.message});}
};
