"use strict";
const fs=require("node:fs");
const path=require("node:path");
const C=require("../orchestrator/contracts.js");
const {compileInstruction}=require("../orchestrator/block-core.js");
const {Store}=require("../orchestrator/store.js");
const {StateMachine}=require("../orchestrator/state-machine.js");
const {CommitProtocol,makeCommitId}=require("../orchestrator/commit-protocol.js");
const {makeRunStateV2,validateRunStateV2,validateExecutionManifest}=require("../orchestrator/durable-contracts.js");
const {makeInitialManifest,evolveManifest}=require("../orchestrator/execution-manifest.js");
const {assertRepositoryRevisionGate}=require("./control/repository-revision-gate.js");
const {repositorySnapshotId}=require("./control/repository-snapshot.js");

const RECOVERABLE_JOB_STATUSES=new Set(["QUEUED","RUNNING","RETRY_WAIT","PAUSED"]);
const TERMINAL_JOB_STATUSES=new Set(["DONE","CANCELLED","BLOCKED","FAILED"]);
const GC_PLAN_SCHEMA="debugai.durable-gc-plan/v1";
function gcPlanPath(runId){const id=String(runId||"");if(!/^[A-Za-z0-9._-]{1,200}$/.test(id))throw new Error("RUN_ID_INVALID");return`gc-plan/${id}.json`;}
function normalizeRepositorySnapshotId(value){if(value===null||value===undefined)return null;const text=String(value).trim();if(!text||text.length>200)throw new Error("DURABLE_REPOSITORY_SNAPSHOT_ID_INVALID");return text;}
function tryRepositorySnapshotId(projectDir,options={}){
  try{return repositorySnapshotId(path.resolve(String(projectDir||"")),options);}catch{return null;}
}

class RunAuthority{
  constructor({runtimeRoot,repoPolicy=null,durableIo=null}={}){if(!runtimeRoot)throw new Error("RUNTIME_ROOT_REQUIRED");this.store=new Store(path.join(runtimeRoot,"authority"));this.machine=new StateMachine({store:this.store});this.repoPolicy=repoPolicy;this.commitProtocol=durableIo?new CommitProtocol({io:durableIo}):null;}
  start({rawRequest,repo,projectId}={}){
    const projectDir=this.repoPolicy?this.repoPolicy.assertRepo(repo):path.resolve(String(repo||process.cwd()));
    const plan=compileInstruction(String(rawRequest||"")),request=plan.request;
    this.store.saveRequest(request);
    const run=C.makeRunState({request_hash:request.request_hash,project_dir:projectDir,project_id:String(projectId||path.basename(projectDir))});
    this.store.saveRunState(run);
    this.store.saveBlocks(run.run_id,plan.blocks,request);
    return run;
  }
  load(runId){const run=this.store.loadRunState(String(runId||""));if(!run)throw new Error("RUN_NOT_FOUND");return run;}
  transition(runOrId,next){const run=typeof runOrId==="string"?this.load(runOrId):runOrId;return this.machine.transition(run,next);}
  durableEnabled(){return this.commitProtocol!==null;}
  _requireDurable(){if(!this.commitProtocol)throw new Error("DURABLE_AUTHORITY_NOT_CONFIGURED");return this.commitProtocol;}
  reserveDurableCommitId(){this._requireDurable();return makeCommitId();}
  readDurableRecord(recordPath,{expectedSchema=null,allowMissing=false}={}){return this._requireDurable().readRecord(recordPath,{expectedSchema,allowMissing});}
  listDurableRunRecords(runId,{maxEntries=100000}={}){const protocol=this._requireDurable(),id=String(runId||"");if(!id)throw new Error("RUN_ID_REQUIRED");const out=[];for(const file of protocol.io.listFiles("durable",{allowMissing:true,maxEntries})){const record=protocol.io.readRecord(file.relative);if(record&&typeof record==="object"&&record.run_id===id)out.push({path:file.relative,record,byte_length:file.byte_length,mtime_ms:file.mtime_ms});}return out.sort((a,b)=>a.path.localeCompare(b.path));}
  removeDurableRecord(recordPath){return this._requireDurable().io.removeFile(recordPath);}
  writeGcPlan(plan){if(!plan||plan.schema!==GC_PLAN_SCHEMA||typeof plan.run_id!=="string")throw new Error("DURABLE_GC_PLAN_INVALID");return this._requireDurable().io.writeImmutableRecord(gcPlanPath(plan.run_id),plan);}
  listGcPlans({maxEntries=10000}={}){const io=this._requireDurable().io;return io.listFiles("gc-plan",{allowMissing:true,maxEntries}).map(file=>io.readRecord(file.relative,{expectedSchema:GC_PLAN_SCHEMA})).sort((a,b)=>a.run_id.localeCompare(b.run_id));}
  removeGcPlan(runId){return this._requireDurable().io.removeFile(gcPlanPath(runId));}
  removeLegacyRunIndex(runId){const id=String(runId||"");if(!/^[A-Za-z0-9_-]{1,200}$/.test(id))throw new Error("RUN_ID_INVALID");const file=path.join(this.store.dirs.run,`${id}.json`);let stat;try{stat=fs.lstatSync(file);}catch(error){if(error?.code==="ENOENT")return false;throw error;}if(!stat.isFile()||stat.isSymbolicLink())throw new Error("LEGACY_RUN_INDEX_UNSAFE");fs.unlinkSync(file);return true;}
  async initializeDurable(runOrId,{repositorySnapshotId=null,requireRepositoryBinding=false}={}){
    const protocol=this._requireDurable();const run=typeof runOrId==="string"?this.load(runOrId):runOrId;if(!run||typeof run!=="object"||typeof run.run_id!=="string")throw new Error("RUN_REQUIRED");
    const approvedProjectDir=this.repoPolicy?this.repoPolicy.assertRepo(run.project_dir):run.project_dir;const explicitSnapshot=normalizeRepositorySnapshotId(repositorySnapshotId),currentSnapshot=explicitSnapshot||tryRepositorySnapshotId(approvedProjectDir,{allowMissingGitMarker:Boolean(this.repoPolicy)});if(requireRepositoryBinding&&!currentSnapshot)throw new Error("DURABLE_REPOSITORY_SNAPSHOT_CURRENT_REQUIRED");
    const existing=protocol.loadRunState(run.run_id,{allowMissing:true});
    if(existing!==null){
      validateRunStateV2(existing);const manifest=protocol.loadManifest(existing.execution_ref.manifest_id);validateExecutionManifest(manifest);
      const expectedSnapshot=normalizeRepositorySnapshotId(manifest.snapshot_refs?.repository_snapshot_id||null);
      if(expectedSnapshot!==null&&currentSnapshot!==null)assertRepositoryRevisionGate({expected_snapshot_id:expectedSnapshot,current_snapshot_id:currentSnapshot});
      else if(requireRepositoryBinding)assertRepositoryRevisionGate({expected_snapshot_id:expectedSnapshot,current_snapshot_id:currentSnapshot});
      return{created:false,state:existing,manifest};
    }
    const initial=makeRunStateV2({request_hash:run.request_hash,project_dir:run.project_dir,project_id:run.project_id,generation:0,execution_epoch:0});initial.run_id=run.run_id;validateRunStateV2(initial);
    const manifest=makeInitialManifest({run_id:run.run_id,request_digest:run.request_hash,snapshot_refs:currentSnapshot?{repository_snapshot_id:currentSnapshot}:{},policy_refs:{legacy_state_machine:"orchestrator/state-machine.js"}});
    const committed=await protocol.commit({runId:run.run_id,expected:{generation:0,execution_epoch:0},manifest,createIfMissing:true,initialState:initial});return{created:true,state:committed.state,manifest};
  }
  loadDurable(runId){const protocol=this._requireDurable();const state=protocol.loadRunState(String(runId||""));validateRunStateV2(state);const manifest=protocol.loadManifest(state.execution_ref.manifest_id);validateExecutionManifest(manifest);return{state,manifest};}
  async commitDurable({runId,manifestPatch={},runStatePatch={},immutableRecords=[],commitId=null}={}){const protocol=this._requireDurable();const {state,manifest}=this.loadDurable(runId);const nextManifest=evolveManifest(manifest,manifestPatch);const committed=await protocol.commit({runId:state.run_id,expected:{generation:state.generation,execution_epoch:state.execution_epoch},manifest:nextManifest,runStatePatch,immutableRecords,commitId});return{state:committed.state,manifest:nextManifest,commit:committed};}
  listRunIds(){return this.store.listRuns();}
  inspectDurableRuns(){const recoverable=[],terminal=[],incompatible=[];for(const runId of this.listRunIds()){try{const loaded=this.loadDurable(runId),status=loaded.state.job_status;if(loaded.manifest.cancellation!==null||status==="CANCELLED")terminal.push({run_id:runId,reason:"CANCELLED",...loaded});else if(RECOVERABLE_JOB_STATUSES.has(status))recoverable.push({run_id:runId,...loaded});else if(TERMINAL_JOB_STATUSES.has(status))terminal.push({run_id:runId,reason:status,...loaded});else incompatible.push({run_id:runId,error:`JOB_STATUS_INCOMPATIBLE:${status}`});}catch(error){incompatible.push({run_id:runId,error:String(error?.code||error?.message||error)});}}return{recoverable,terminal,incompatible};}
  async bumpDurableEpoch({runId,manifestPatch={},runStatePatch={}}={}){const protocol=this._requireDurable();const {state,manifest}=this.loadDurable(runId);const nextManifest=evolveManifest(manifest,manifestPatch);const committed=await protocol.bumpEpoch({runId:state.run_id,expectedGeneration:state.generation,expectedEpoch:state.execution_epoch,manifest:nextManifest,runStatePatch});return{state:committed.state,manifest:nextManifest,commit:committed};}
  async claimRecoverableRun(runId,{claimedAt=Date.now()}={}){const {state,manifest}=this.loadDurable(runId);if(manifest.cancellation!==null||state.job_status==="CANCELLED")throw new Error("RUN_CANCELLED");if(!RECOVERABLE_JOB_STATUSES.has(state.job_status))throw new Error(`RUN_NOT_RECOVERABLE:${state.job_status}`);return this.bumpDurableEpoch({runId,manifestPatch:{job:{status:"RUNNING"},policy_refs:{startup_recovery_claimed_at:claimedAt,startup_recovery_from_epoch:state.execution_epoch}},runStatePatch:{job_status:"RUNNING"}});}
}
module.exports={RunAuthority,RECOVERABLE_JOB_STATUSES,TERMINAL_JOB_STATUSES,GC_PLAN_SCHEMA,gcPlanPath,normalizeRepositorySnapshotId,tryRepositorySnapshotId};
