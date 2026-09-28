"use strict";
const path=require("node:path");
const {createAiCoreAdapter}=require("./adapters/ai-core.js");
const {createEvidenceSearchAdapter}=require("./adapters/evidence-search.js");
const {createTgserverAdapter}=require("./adapters/tgserver.js");
const {createExternalReviewAdapter}=require("./adapters/external-review.js");
const {PatchService}=require("./patch-service.js");
const {RuntimeEvidenceStore}=require("./runtime-evidence.js");
const {RunAuthority}=require("./run-authority.js");
const {RepoPolicy}=require("./repo-policy.js");
const {createWorkflow}=require("./workflow.js");
const {createServer}=require("./http.js");
const {sourceGate}=require("./gates.js");
const {createSandboxVerificationLane}=require("./control/sandbox-verification.js");
const {createDapEvidenceLane}=require("./control/dap-evidence-runtime.js");
const {archiveTerminalRuns,gcArchivedTerminalRuns}=require("./control/storage-retention.js");
const {sweepPatchRetention}=require("./control/patch-retention-gc.js");
const {DurableWriterLock}=require("../orchestrator/durable-writer-lock.js");
const {DurableFileIO}=require("../orchestrator/durable-file-io.js");

function envInt(name,fallback,{min=1,max=Number.MAX_SAFE_INTEGER}={}){const raw=process.env[name];if(raw===undefined||raw==="")return fallback;const value=Number(raw);if(!Number.isSafeInteger(value)||value<min||value>max)throw new Error(`${name}_INVALID`);return value;}

const root=process.cwd(),runtimeRoot=process.env.DEBUG_AI_RUNTIME_ROOT||path.join(root,"runtime");
const gate=sourceGate(root);if(!gate.pass)throw new Error(`SOURCE_GATE_FAILED:${gate.failures.join(",")}`);
const repoPolicy=new RepoPolicy();
const writerLock=DurableWriterLock.acquire({root:path.join(runtimeRoot,"durable")});
const durableIo=new DurableFileIO({writerLock});
const authority=new RunAuthority({runtimeRoot,repoPolicy,durableIo});
const aiCore=createAiCoreAdapter();
if(!process.env.DEBUG_AI_EVIDENCE_SEARCH_URL)throw new Error("EVIDENCE_SEARCH_URL_REQUIRED");
const evidenceSearch=createEvidenceSearchAdapter();
if(!process.env.DEBUG_AI_TGSERVER_URL)throw new Error("TGSERVER_URL_REQUIRED");
if(!process.env.DEBUG_AI_TGSERVER_LOG_PROJECT_ID)throw new Error("TGSERVER_LOG_PROJECT_ID_REQUIRED");
if(!process.env.DEBUG_AI_TGSERVER_KB_PROJECT_ID)throw new Error("TGSERVER_KB_PROJECT_ID_REQUIRED");
const tgserver=createTgserverAdapter();
const runtimeEvidenceRetentionMs=envInt("DEBUG_AI_RUNTIME_EVIDENCE_RETENTION_MS",12*3600e3,{min:5*60e3,max:7*24*3600e3});
const runtimeEvidenceMaxBytes=envInt("DEBUG_AI_RUNTIME_EVIDENCE_MAX_BYTES",32*1024**2,{min:4*1024**2,max:1024**3});
const runtimeEvidenceRotateMs=envInt("DEBUG_AI_RUNTIME_EVIDENCE_ROTATE_MS",15*60e3,{min:60e3,max:24*3600e3});
const archiveSweepMs=envInt("DEBUG_AI_ARCHIVE_SWEEP_MS",30*60e3,{min:5*60e3,max:24*3600e3});
const archiveInitialDelayMs=envInt("DEBUG_AI_ARCHIVE_INITIAL_DELAY_MS",60e3,{min:10e3,max:60*60e3});
const archiveMaxRuns=envInt("DEBUG_AI_ARCHIVE_MAX_RUNS",4,{min:1,max:64});
const runtimeEvidence=new RuntimeEvidenceStore(runtimeRoot,{retentionMs:runtimeEvidenceRetentionMs,maxBytes:runtimeEvidenceMaxBytes});
const sandboxVerification=createSandboxVerificationLane();
const dapEvidence=createDapEvidenceLane();
if(!process.env.GROQ_API_KEY&&!process.env.GEMINI_API_KEY)throw new Error("EXTERNAL_REVIEW_PROVIDER_REQUIRED");
const externalReview=createExternalReviewAdapter();
const patchService=new PatchService({runtimeRoot,repoPolicy});
const workflow=createWorkflow({aiCore,externalReview,evidenceSearch,runtimeEvidence,tgserver,patchService,authority,repoPolicy,sandboxVerification,dapEvidence});
const host=process.env.DEBUG_AI_HOST||"127.0.0.1",port=Number(process.env.DEBUG_AI_PORT||8787);
const server=createServer({workflow,host,port});
let shuttingDown=false,rotationTimer=null,archiveTimer=null,archiveSweepRunning=false;
function rotateRuntimeEvidence(){try{const result=runtimeEvidence.rotate();if(result.orphans_removed>0)console.warn(`DebugAI runtime cache cleanup: files=${result.files} bytes=${result.bytes} orphans_removed=${result.orphans_removed}`);}catch(error){console.error(`DebugAI runtime cache cleanup failed: ${String(error?.message||error)}`);}}
async function runArchiveSweep(){if(shuttingDown||archiveSweepRunning)return;archiveSweepRunning=true;try{const archive=await archiveTerminalRuns({authority,tgserver,maxRuns:archiveMaxRuns}),gc=gcArchivedTerminalRuns({authority,maxRuns:archiveMaxRuns}),patchGc=sweepPatchRetention({runtimeRoot,maxDeletes:archiveMaxRuns});if(archive.archived.length||archive.errors.length||gc.deleted.length||gc.resumed.length||gc.errors.length||patchGc.backup_deleted.length||patchGc.candidate_deleted.length||patchGc.errors.length)console.warn(`DebugAI retention sweep: archived=${archive.archived.length} already=${archive.already_archived.length} archive_errors=${archive.errors.length} durable_gc_deleted=${gc.deleted.length} durable_gc_resumed=${gc.resumed.length} durable_gc_errors=${gc.errors.length} patch_backup_deleted=${patchGc.backup_deleted.length} patch_candidate_deleted=${patchGc.candidate_deleted.length} patch_gc_errors=${patchGc.errors.length}`);}catch(error){console.error(`DebugAI retention sweep failed: code=${String(error?.code||error?.name||"ERROR")}`);}finally{archiveSweepRunning=false;}}
function scheduleArchiveSweep(delayMs){if(shuttingDown)return;archiveTimer=setTimeout(async()=>{await runArchiveSweep();scheduleArchiveSweep(archiveSweepMs);},delayMs);archiveTimer.unref();}
function shutdown(signal){if(shuttingDown)return;shuttingDown=true;if(rotationTimer)clearInterval(rotationTimer);if(archiveTimer)clearTimeout(archiveTimer);server.close(()=>{try{writerLock.close();}finally{process.exit(0);}});setTimeout(()=>{try{writerLock.close();}finally{process.exit(1);}},5000).unref();if(signal)console.error(`DebugAI shutdown: ${signal}`);}
process.once("SIGTERM",()=>shutdown("SIGTERM"));
process.once("SIGINT",()=>shutdown("SIGINT"));
async function start(){rotateRuntimeEvidence();rotationTimer=setInterval(rotateRuntimeEvidence,runtimeEvidenceRotateMs);rotationTimer.unref();const recovery=await workflow.recoverStartup();if(recovery.claimed.length||recovery.incompatible.length)console.log(`DebugAI startup recovery: claimed=${recovery.claimed.length} incompatible=${recovery.incompatible.length}`);server.listen(port,host,()=>console.log(`DebugAI listening on http://${host}:${port}; runtime-cache retention_ms=${runtimeEvidenceRetentionMs} max_bytes=${runtimeEvidenceMaxBytes} rotate_ms=${runtimeEvidenceRotateMs}; retention_sweep_ms=${archiveSweepMs} retention_max_items=${archiveMaxRuns}`));scheduleArchiveSweep(archiveInitialDelayMs);}
void start().catch(error=>{console.error(`DebugAI startup failed: ${String(error?.message||error)}`);try{writerLock.close();}finally{process.exitCode=1;}});
