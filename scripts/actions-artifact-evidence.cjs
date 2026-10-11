"use strict";
// On-demand data intake; deliberately does not launch diagnosis or any model/provider.
const fs=require('node:fs');
const {RuntimeEvidenceStore}=require('../server/runtime-evidence.js');
const {createTgserverAdapter}=require('../server/adapters/tgserver.js');
const {createGhArtifactReader}=require('../server/control/actions-artifact-github.js');
const {ingestActionsArtifact}=require('../server/control/actions-artifact-evidence.js');
function trustedRegistry(){
 const file='/home/admin1/.config/debugai-gitops/delegations/policies/dlg_master_debugai_v1.json';
 for(const directory of ['/home/admin1/.config/debugai-gitops/delegations','/home/admin1/.config/debugai-gitops/delegations/policies']){const st=fs.lstatSync(directory);if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==process.geteuid()||(st.mode&0o777)!==0o700)throw new Error('ARTIFACT_REGISTRY_UNTRUSTED');}
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const stat=fs.fstatSync(fd);if(!stat.isFile()||stat.nlink!==1||stat.uid!==process.geteuid()||(stat.mode&0o777)!==0o600||stat.size>128*1024)throw new Error('ARTIFACT_REGISTRY_UNTRUSTED');const entry=JSON.parse(fs.readFileSync(fd,'utf8'));return{schema:'gace.workspace-master-internal-registry/v1',master_principal:entry.master_principal,project:entry.project,repositories:[entry]};}finally{fs.closeSync(fd);}
}
async function main(){
 if(process.argv.length!==3)throw new Error('USAGE: node scripts/actions-artifact-evidence.cjs <request.json>');
 const requestStat=fs.statSync(process.argv[2]);if(!requestStat.isFile()||requestStat.size>8192)throw new Error('ARTIFACT_REQUEST_INVALID');
 const request=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
 if(Object.keys(request).some(k=>!['repository','runId','artifactId','headSha','attempt','evidenceRunId'].includes(k)))throw new Error('ARTIFACT_REQUEST_INVALID');
 if(!process.env.DEBUG_AI_RUNTIME_ROOT)throw new Error('DEBUG_AI_RUNTIME_ROOT_REQUIRED');
 const store=new RuntimeEvidenceStore(process.env.DEBUG_AI_RUNTIME_ROOT,{retentionMs:Number(process.env.DEBUG_AI_RUNTIME_EVIDENCE_RETENTION_MS||12*3600e3),maxBytes:Number(process.env.DEBUG_AI_RUNTIME_EVIDENCE_MAX_BYTES||32*1024**2)});
 store.rotate();const tgserver=createTgserverAdapter();
 try{const result=await ingestActionsArtifact({...request,registry:trustedRegistry(),reader:createGhArtifactReader(),runtimeEvidence:store,tgserver});const flush=await tgserver.flushLogs(5000);process.stdout.write(JSON.stringify({...result,zero_delivery:{flushed:flush,...tgserver.getLogStats()}},null,2)+'\n');if(!flush||tgserver.getLogStats().failed||tgserver.getLogStats().dropped)process.exitCode=2;}finally{await tgserver.shutdownLogSink(1000);}
}
if(require.main===module)main().catch(error=>{process.stderr.write(String(error.code||'ARTIFACT_INTAKE_FAILED')+'\n');process.exitCode=1;});
module.exports={trustedRegistry};
