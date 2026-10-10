'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
class ExternalReviewError extends Error {
  constructor(code,meta={}){super(code);this.name='ExternalReviewError';this.code=code;this.meta=meta;}
}
const SCHEMA='debugai.external-review.rolling-quota/v1';
const QUALIFICATION_SCHEMA='debugai.external-review.free-qualification/v1';
const WINDOWS={minute:60_000,hour:3_600_000,day:86_400_000,month:31*86_400_000};
const CAPS={minute:1,hour:2,day:4,month:20};
const PROVIDERS={
  groq:{url:'https://api.groq.com/openai/v1/chat/completions',model:'openai/gpt-oss-20b'},
  gemini:{url:'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',model:'gemini-3.8-flash'}
};
const fail=(code,meta)=>{throw new ExternalReviewError(code,meta);};
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const integer=x=>Number.isSafeInteger(x)&&x>=0;
const identifier=x=>typeof x==='string'&&/^[A-Za-z0-9_.:@/-]{1,160}$/.test(x);
function qualificationFile(){return process.env.DEBUG_AI_EXTERNAL_REVIEW_FREE_QUALIFICATION_FILE||'/run/debugai/external-review-free-qualification.json';}
// Host-owned evidence only. Neither an application-writable boolean nor a key is billing proof.
function readTrustedQualification(file=qualificationFile()){
  try{
    if(!path.isAbsolute(file)||fs.realpathSync(file)!==path.resolve(file))fail('LIVE_BLOCKED_FREE_TIER_UNVERIFIED');
    for(let p=path.resolve(file);;p=path.dirname(p)){
      const s=fs.lstatSync(p);
      if(s.isSymbolicLink()||s.uid!==0||(s.mode&0o022))fail('LIVE_BLOCKED_FREE_TIER_UNVERIFIED');
      if(p==='/')break;
    }
    const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
    try{
      const s=fs.fstatSync(fd);
      if(!s.isFile()||s.uid!==0||(s.mode&0o022)||s.size>65536)fail('LIVE_BLOCKED_FREE_TIER_UNVERIFIED');
      return JSON.parse(fs.readFileSync(fd,'utf8'));
    }finally{fs.closeSync(fd);}
  }catch{fail('LIVE_BLOCKED_FREE_TIER_UNVERIFIED');}
}
function validateQualification(document,provider,{key,url,model,now}){
  const q=document?.providers?.[provider];
  if(document?.schema!==QUALIFICATION_SCHEMA||!q||q.plan!=='FREE'||q.billing_enabled!==false||q.paid_fallback!==false||q.other_consumers_accounted!==true||q.history_31d_verified!==true||q.verified_by!=='HOST_READ_ONLY_ACCOUNT_AUDIT'||!identifier(q.account_id)||!identifier(q.ledger_id)||!Array.isArray(q.evidence_refs)||q.evidence_refs.length<2||!q.evidence_refs.every(identifier)||q.key_sha256!==hash(key)||q.url!==url||q.model!==model||url!==PROVIDERS[provider].url||model!==PROVIDERS[provider].model||!integer(q.observed_at)||!integer(q.expires_at)||q.observed_at>now||now-q.observed_at>300_000||q.expires_at<=now||q.expires_at-q.observed_at>3_600_000)fail('LIVE_BLOCKED_FREE_TIER_UNVERIFIED',{provider});
  for(const window of Object.keys(WINDOWS))if(!integer(q.request_limits?.[window]))fail('LIVE_BLOCKED_FREE_TIER_UNVERIFIED',{provider});
  for(const field of ['minute','day'])if(!integer(q.token_limits?.[field]))fail('LIVE_BLOCKED_FREE_TIER_UNVERIFIED',{provider});
  if(!integer(q.remaining?.requests)||!integer(q.remaining?.tokens))fail('LIVE_BLOCKED_FREE_TIER_UNVERIFIED',{provider});
  // Budget allocation must be backed by the account audit, including other consumers.
  return q;
}
function configuredCaps(provider){
  const prefix=`DEBUG_AI_${provider.toUpperCase()}`;
  const result={};
  for(const [w,suffix] of Object.entries({minute:'MINUTE',hour:'HOUR',day:'DAILY',month:'MONTH'})){
    const raw=process.env[`${prefix}_${suffix}_REQUEST_LIMIT`];
    const value=raw===undefined||raw===''?CAPS[w]:Number(raw);
    if(!integer(value))fail('EXTERNAL_REVIEW_QUOTA_CONFIG_INVALID',{provider});
    result[w]=Math.min(value,CAPS[w]);
  }
  return result;
}
function defaultQuotaRoot(){return path.join(process.env.DEBUG_AI_RUNTIME_ROOT||'/app/runtime','external-review-quota');}
function createExternalReviewQuotaLedger({root=defaultQuotaRoot(),nowFn=Date.now,allowInitialize=true}={}){
  const filePath=path.join(root,'rolling-provider-requests.json');
  const anchorPath=path.join(root,'ledger-integrity.sha256');
  const lockPath=path.join(root,'dispatch.lock');
  function secureFile(file){
    const s=fs.lstatSync(file);
    if(!s.isFile()||s.isSymbolicLink()||(s.mode&0o077)||s.uid!==process.getuid()||s.nlink!==1||s.size>262144)fail('EXTERNAL_REVIEW_QUOTA_LEDGER_CORRUPT');
    const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
    try{return fs.readFileSync(fd,'utf8');}finally{fs.closeSync(fd);}
  }
  function validateState(s){
    if(s?.schema!==SCHEMA||!integer(s.last_now)||!s.providers||Object.keys(s.providers).some(p=>!PROVIDERS[p]))fail('EXTERNAL_REVIEW_QUOTA_LEDGER_CORRUPT');
    for(const p of Object.values(s.providers)){
      if(!identifier(p.account_id)||!identifier(p.ledger_id)||!Array.isArray(p.events)||p.events.length>20||!(p.blocks===null||(integer(p.blocks?.at)&&identifier(p.blocks?.code))))fail('EXTERNAL_REVIEW_QUOTA_LEDGER_CORRUPT');
      let last=0;
      for(const e of p.events){if(!integer(e.at)||e.at<last||e.at>s.last_now||!integer(e.tokens)||e.tokens<1)fail('EXTERNAL_REVIEW_QUOTA_LEDGER_CORRUPT');last=e.at;}
    }
    return s;
  }
  function readStateSync(){
    try{
      const raw=secureFile(filePath),anchor=secureFile(anchorPath).trim();
      if(hash(raw)!==anchor)fail('EXTERNAL_REVIEW_QUOTA_LEDGER_CORRUPT');
      return validateState(JSON.parse(raw));
    }catch{fail('EXTERNAL_REVIEW_QUOTA_LEDGER_CORRUPT');}
  }
  function fsyncDirectory(){const fd=fs.openSync(root,fs.constants.O_RDONLY);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
  function atomicWrite(file,raw){
    const tmp=path.join(root,`.quota-${crypto.randomUUID()}.tmp`);
    const fd=fs.openSync(tmp,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
    try{fs.writeFileSync(fd,raw);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    fs.renameSync(tmp,file);fsyncDirectory();
  }
  function writeState(s){const raw=JSON.stringify(s)+'\n';atomicWrite(filePath,raw);atomicWrite(anchorPath,hash(raw)+'\n');}
  function withLock(fn){
    let fresh=false,locked=false;
    try{
      if(!allowInitialize&&!fs.existsSync(root))fail('EXTERNAL_REVIEW_QUOTA_LEDGER_CORRUPT');
      try{fs.mkdirSync(root,{mode:0o700});fresh=true;}catch(e){if(e.code!=='EEXIST')throw e;}
      const s=fs.lstatSync(root);
      if(!s.isDirectory()||s.isSymbolicLink()||(s.mode&0o077)||s.uid!==process.getuid()||fs.realpathSync(root)!==path.resolve(root))fail('EXTERNAL_REVIEW_QUOTA_PATH_INVALID');
      try{fs.mkdirSync(lockPath,{mode:0o700});locked=true;fsyncDirectory();}catch{fail('EXTERNAL_REVIEW_QUOTA_LOCKED');}
      // Never erase/import ambiguous daily history or reinitialize an existing missing ledger.
      if(fs.existsSync(path.join(root,'daily-provider-requests.json')))fail('EXTERNAL_REVIEW_QUOTA_LEGACY_RECONCILIATION_REQUIRED');
      if(fresh)writeState({schema:SCHEMA,last_now:0,providers:{}});
      return fn(readStateSync());
    }catch(e){if(e instanceof ExternalReviewError)throw e;fail('EXTERNAL_REVIEW_QUOTA_IO_FAILED');}
    finally{if(locked){try{fs.rmdirSync(lockPath);fsyncDirectory();}catch{fail('EXTERNAL_REVIEW_QUOTA_LOCK_ABNORMAL');}}}
  }
  function reserveDispatch(provider,tokens,q){
    if(!PROVIDERS[provider]||!integer(tokens)||tokens<1)fail('EXTERNAL_REVIEW_QUOTA_CONFIG_INVALID');
    return withLock(state=>{
      const now=nowFn();
      if(!integer(now)||now<state.last_now)fail('EXTERNAL_REVIEW_QUOTA_CLOCK_INVALID');
      const saved=state.providers[provider];
      if(saved&&(saved.account_id!==q.account_id||saved.ledger_id!==q.ledger_id))fail('EXTERNAL_REVIEW_QUOTA_IDENTITY_CHANGED',{provider});
      const p=saved||{account_id:q.account_id,ledger_id:q.ledger_id,events:[],blocks:null};
      if(p.blocks)fail('EXTERNAL_REVIEW_QUOTA_ACCOUNT_BLOCKED',{provider});
      const events=p.events.filter(e=>now-e.at<=WINDOWS.month);
      const caps=configuredCaps(provider);
      for(const [window,ms] of Object.entries(WINDOWS)){
        const count=events.filter(e=>now-e.at<=ms).length;
        if(count>=Math.min(caps[window],q.request_limits[window]))fail(`EXTERNAL_REVIEW_QUOTA_${window.toUpperCase()}_EXHAUSTED`,{provider});
      }
      for(const window of ['minute','day'])if(events.filter(e=>now-e.at<=WINDOWS[window]).reduce((s,e)=>s+e.tokens,0)+tokens>q.token_limits[window])fail('EXTERNAL_REVIEW_QUOTA_TOKENS_EXHAUSTED',{provider});
      const sinceAudit=events.filter(e=>e.at>=q.observed_at);
      if(sinceAudit.length+1>q.remaining.requests||sinceAudit.reduce((s,e)=>s+e.tokens,0)+tokens>q.remaining.tokens)fail('EXTERNAL_REVIEW_QUOTA_REMAINING_EXHAUSTED',{provider});
      p.events=[...events,{at:now,tokens}];state.providers[provider]=p;state.last_now=now;writeState(state);
      return {at:now,tokens};
    });
  }
  function blockProvider(provider,code){return withLock(state=>{
    if(!state.providers[provider])fail('EXTERNAL_REVIEW_QUOTA_LEDGER_CORRUPT');
    state.providers[provider].blocks={at:state.last_now,code};writeState(state);
  });}
  // Explicit offline/Host provisioning only; live adapters still pass allowInitialize=false.
  // withLock initializes only a newly created root and validates existing history unchanged.
  function provisionEmptyLedger(){return withLock(state=>state);}
  return {reserveDispatch,blockProvider,readStateSync,provisionEmptyLedger,filePath};
}
module.exports={ExternalReviewError,createExternalReviewQuotaLedger,readTrustedQualification,validateQualification,defaultQuotaRoot,QUALIFICATION_SCHEMA,PROVIDERS,WINDOWS,CAPS};
