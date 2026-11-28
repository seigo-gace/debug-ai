"use strict";
const crypto=require("node:crypto");
const MAX_TOKEN=16384,MAX_KEYS=65536;
function createAccessVerifier({team, audience, ownerEmail,fetchImpl=fetch,now=Date.now}={}){
  if(!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(team||"")||!/^[a-f0-9]{64}$/.test(audience||"")||typeof ownerEmail!=="string"||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail))throw new Error("CHAT_ACCESS_CONFIG_INVALID");
  const owner=ownerEmail.toLowerCase();let keys=new Map(),until=0,pending=null,lastAttempt=-Infinity;
  async function refresh(){
    if(pending)return pending;
    if(now()-lastAttempt<10000)return;
    lastAttempt=now();
    pending=(async()=>{
      const res=await fetchImpl(team+"/cdn-cgi/access/certs",{redirect:"error",signal:AbortSignal.timeout(5000),headers:{Accept:"application/json"}});
      if(!res.ok||!res.body)throw new Error("CHAT_ACCESS_KEYS_UNAVAILABLE");
      const parts=[];let bytes=0;for await(const chunk of res.body){bytes+=chunk.length;if(bytes>MAX_KEYS)throw new Error("CHAT_ACCESS_KEYS_INVALID");parts.push(Buffer.from(chunk));}
      const doc=JSON.parse(Buffer.concat(parts).toString("utf8")),next=new Map();
      if(!Array.isArray(doc.keys)||doc.keys.length>32)throw new Error("CHAT_ACCESS_KEYS_INVALID");
      for(const jwk of doc.keys){if(jwk.kty!=="RSA"||typeof jwk.kid!=="string"||(jwk.alg&&jwk.alg!=="RS256")||next.has(jwk.kid))continue;next.set(jwk.kid,crypto.createPublicKey({key:jwk,format:"jwk"}));}
      if(!next.size)throw new Error("CHAT_ACCESS_KEYS_INVALID");
      keys=next;until=now()+300000;
    })();
    try{await pending;}finally{pending=null;}
  }
  return async function verify(req){
    try{
      const token=req.headers["cf-access-jwt-assertion"];
      if(typeof token!=="string"||token.length>MAX_TOKEN||!/^[-_A-Za-z0-9]+\.[-_A-Za-z0-9]+\.[-_A-Za-z0-9]+$/.test(token))return false;
      const [h,p,s]=token.split("."),header=JSON.parse(Buffer.from(h,"base64url")),claims=JSON.parse(Buffer.from(p,"base64url")),n=Math.floor(now()/1000);
      if(header.alg!=="RS256"||typeof header.kid!=="string"||header.kid.length>256||claims.iss!==team||!Array.isArray(claims.aud)||!claims.aud.includes(audience)||!Number.isSafeInteger(claims.exp)||claims.exp<=n||(claims.nbf!==undefined&&(!Number.isSafeInteger(claims.nbf)||claims.nbf>n))||typeof claims.email!=="string"||claims.email.toLowerCase()!==owner||typeof claims.sub!=="string"||!claims.sub||claims.type==="service")return false;
      if(now()>=until||!keys.has(header.kid))await refresh();
      if(now()>=until)return false;
      const key=keys.get(header.kid);return !!key&&crypto.verify("RSA-SHA256",Buffer.from(h+"."+p),key,Buffer.from(s,"base64url"));
    }catch{return false;}
  };
}
module.exports={createAccessVerifier};
