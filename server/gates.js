"use strict";
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const FORBIDDEN_PROD=[/AI_DEV_OLLAMA_URL/i,/127\.0\.0\.1:11434/,/telegram.*(?:redis|meilisearch)|(?:redis|meilisearch).*telegram/i];
function walk(root,out=[]){for(const e of fs.readdirSync(root,{withFileTypes:true})){if(['.git','node_modules','runtime','legacy'].includes(e.name))continue;const p=path.join(root,e.name);if(e.isDirectory())walk(p,out);else out.push(p);}return out;}
function sourceGate(root){const failures=[];for(const f of walk(root)){const rel=path.relative(root,f).replaceAll('\\','/');if(!/\.(?:js|mjs|cjs|json|ya?ml|md)$/.test(rel))continue;if(rel==='server/gates.js')continue;let s;try{s=fs.readFileSync(f,'utf8')}catch{continue}if(rel.startsWith('server/')||rel.startsWith('orchestrator/'))for(const re of FORBIDDEN_PROD)if(re.test(s))failures.push(`${rel}:${re}`);}return {pass:failures.length===0,failures};}
function escapeRe(v){return String(v).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
function serviceBlock(s,name){
  const lines=String(s).split(/\r?\n/),startRe=new RegExp(`^  ${escapeRe(name)}:\\s*$`);let start=-1;
  for(let i=0;i<lines.length;i++){if(startRe.test(lines[i])){start=i;break;}}
  if(start<0)return '';
  const out=[lines[start]];
  for(let i=start+1;i<lines.length;i++){
    const line=lines[i];if(/^\S/.test(line)||/^  [A-Za-z0-9_.-]+:\s*$/.test(line))break;out.push(line);
  }
  return out.join('\n');
}
function composeGate(file){
  const s=fs.readFileSync(file,'utf8'),failures=[],debug=serviceBlock(s,'debug-ai'),sandbox=serviceBlock(s,'sandbox-runner');
  if(!debug)failures.push('DEBUG_AI_SERVICE_MISSING');
  if(!/network_mode:\s*host/i.test(debug))failures.push('HOST_NETWORK_REQUIRED_FOR_LOOPBACK_AI_CORE');
  if(!/DEBUG_AI_HOST:\s*127\.0\.0\.1/m.test(debug))failures.push('DEBUG_AI_LOOPBACK_BIND_REQUIRED');
  if(!/target:\s*debug-ai/m.test(debug))failures.push('DEBUG_AI_BUILD_TARGET_REQUIRED');
  if(!/debug_ai_sandbox_jobs:\/sandbox-jobs:rw/m.test(debug))failures.push('DEBUG_AI_SANDBOX_JOB_VOLUME_REQUIRED');
  if(/^\s+(?:ports|expose):/mi.test(s))failures.push('PORT_PUBLISH_FORBIDDEN_WITH_HOST_NETWORK');
  if(/privileged:\s*true/i.test(s))failures.push('PRIVILEGED_FORBIDDEN');
  if(!/cap_drop:\s*\n\s+- ALL/m.test(debug))failures.push('DEBUG_AI_CAP_DROP_ALL_REQUIRED');
  if(!/no-new-privileges:true/.test(debug))failures.push('DEBUG_AI_NO_NEW_PRIVILEGES_REQUIRED');

  if(!sandbox)failures.push('SANDBOX_SERVICE_MISSING');
  if(sandbox){
    if(!/target:\s*sandbox-runner/m.test(sandbox))failures.push('SANDBOX_BUILD_TARGET_REQUIRED');
    if(!/network_mode:\s*none/m.test(sandbox))failures.push('SANDBOX_NETWORK_NONE_REQUIRED');
    if(!/read_only:\s*true/m.test(sandbox))failures.push('SANDBOX_READ_ONLY_ROOT_REQUIRED');
    if(!/debug_ai_sandbox_jobs:\/sandbox-jobs:rw/m.test(sandbox))failures.push('SANDBOX_JOB_VOLUME_REQUIRED');
    if(!/tmpfs:\s*\n\s+- \/tmp:rw,nosuid,nodev,size=64m,mode=1777/m.test(sandbox))failures.push('SANDBOX_TMPFS_REQUIRED');
    if(!/cap_drop:\s*\n\s+- ALL/m.test(sandbox))failures.push('SANDBOX_CAP_DROP_ALL_REQUIRED');
    if(!/no-new-privileges:true/.test(sandbox))failures.push('SANDBOX_NO_NEW_PRIVILEGES_REQUIRED');
    if(!/pids_limit:\s*128/m.test(sandbox))failures.push('SANDBOX_PIDS_LIMIT_REQUIRED');
    if(!/mem_limit:\s*512m/m.test(sandbox))failures.push('SANDBOX_MEMORY_LIMIT_REQUIRED');
    if(!/cpus:\s*1(?:\.0)?/m.test(sandbox))failures.push('SANDBOX_CPU_LIMIT_REQUIRED');
    if(/\/workspace|\/run\/secrets|docker\.sock/i.test(sandbox))failures.push('SANDBOX_FORBIDDEN_MOUNT');
    if(/AI_CORE_API_KEY|GROQ_API_KEY|GEMINI_API_KEY|EVIDENCE_SEARCH_SECRET/i.test(sandbox))failures.push('SANDBOX_SECRET_ENV_FORBIDDEN');
  }
  if(!/^\s{2}debug_ai_sandbox_jobs:\s*$/m.test(s))failures.push('SANDBOX_VOLUME_DECLARATION_REQUIRED');
  return {pass:failures.length===0,failures};
}
function manifest(root){return walk(root).filter(f=>!f.includes('/runtime/')).sort().map(f=>({path:path.relative(root,f).replaceAll('\\','/'),sha256:crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'),size:fs.statSync(f).size}));}
module.exports={sourceGate,serviceBlock,composeGate,manifest};
