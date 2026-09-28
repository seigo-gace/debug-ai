"use strict";
const path=require("node:path");
const C=require("../orchestrator/contracts.js");
const {Store}=require("../orchestrator/store.js");
const {StateMachine}=require("../orchestrator/state-machine.js");
const {CommitProtocol,makeCommitId}=require("../orchestrator/commit-protocol.js");
const {makeRunStateV2,validateRunStateV2,validateExecutionManifest}=require("../orchestrator/durable-contracts.js");
const {makeInitialManifest,evolveManifest}=require("../orchestrator/execution-manifest.js");

const RECOVERABLE_JOB_STATUSES=new Set(["QUEUED","RUNNING","RETRY_WAIT","PAUSED"]);
const TERMINAL_JOB_STATUSES=new Set(["DONE","CANCELLED","BLOCKED","FAILED"]);

class RunAuthority{
  constructor({runtimeRoot,repoPolicy=null,durableIo=null}={}){if(!runtimeRoot)throw new Error("RUNTIME_ROOT_REQUIRED");this.store=new Store(path.join(runtimeRoot,"authority"));this.machine=new StateMachine({store:this.store});this.repoPolicy=repoPolicy;this.commitProtocol=durableIo?new CommitProtocol({io:durableIo}):null;}
  start({rawRequest,repo,projectId}={}){const projectDir=this.repoPolicy?this.repoPolicy.assertRepo(repo):path.resolve(String(repo||process.cwd()));const request=C.makeRequest({raw:String(rawRequest||"")});this.store.saveRequest(request);const run=C.makeRunState({request_hash:request.request_hash,project_dir:projectDir,project_id:String(projectId||path.basename(projectDir))});this.store.saveRunState(run);return run;}
  load(runId){const run=this.store.loadRunState(String(runId||""));if(!run)throw new Error("RUN_NOT_FOUND");return run;}
  transition(runOrId,next){const run=typeof runOrId==="string"?this.load(runOrId):runOrId;return this.machine.transition(run,next);}
  durableEnabled(){return this.commitProtocol!==null;}
  _requireDurable(){if(!this.commitProtocol)throw new Error("DURABLE_AUTHORITY_NOT_CONFIGURED");return this.commitProtocol;}
  reserveDurableCommitId(){this._requireDurable();return makeCommitId();}
  readDurableRecord(recordPath,{expectedSchema=null,allowMissing=false}={}){return this._requireDurable().readRecord(recordPath,{expectedSchema,allowMissing});}
  async initializeDurable(runOrId){const protocol=this._requireDurable();const run=typeof runOrId==="string"?this.load(runOrId):runOrId;if(!run||typeof run!=="object"||typeof run.run_id!=="string")throw new Error("RUN_REQUIRED");const existing=protocol.loadRunState(run.run_id,{allowMissing:true});if(existing!==null){validateRunStateV2(existing);const manifest=protocol.loadManifest(existing.execution_ref.manifest_id);validateExecutionManifest(manifest);return{created:false,state:existing,manifest};}const initial=makeRunStateV2({request_hash:run.request_hash,project_dir:run.project_dir,project_id:run.project_id,generation:0,execution_epoch:0});initial.run_id=run.run_id;validateRunStateV2(initial);const manifest=makeInitialManifest({run_id:run.run_id,request_digest:run.request_hash,policy_refs:{legacy_state_machine:"orchestrator/state-machine.js"}});const committed=await protocol.commit({runId:run.run_id,expected:{generation:0,execution_epoch:0},manifest,createIfMissing:true,initialState:initial});return{created:true,state:committed.state,manifest};}
  loadDurable(runId){const protocol=this._requireDurable();const state=protocol.loadRunState(String(runId||""));validateRunStateV2(state);const manifest=protocol.loadManifest(state.execution_ref.manifest_id);validateExecutionManifest(manifest);return{state,manifest};}
  async commitDurable({runId,manifestPatch={},runStatePatch={},immutableRecords=[],commitId=null}={}){const protocol=this._requireDurable();const {state,manifest}=this.loadDurable(runId);const nextManifest=evolveManifest(manifest,manifestPatch);const committed=await protocol.commit({runId:state.run_id,expected:{generation:state.generation,execution_epoch:state.execution_epoch},manifest:nextManifest,runStatePatch,immutableRecords,commitId});return{state:committed.state,manifest:nextManifest,commit:committed};}
  listRunIds(){return this.store.listRuns();}
  inspectDurableRuns(){const recoverable=[],terminal=[],incompatible=[];for(const runId of this.listRunIds()){try{const loaded=this.loadDurable(runId),status=loaded.state.job_status;if(loaded.manifest.cancellation!==null||status==="CANCELLED")terminal.push({run_id:runId,reason:"CANCELLED",...loaded});else if(RECOVERABLE_JOB_STATUSES.has(status))recoverable.push({run_id:runId,...loaded});else if(TERMINAL_JOB_STATUSES.has(status))terminal.push({run_id:runId,reason:status,...loaded});else incompatible.push({run_id:runId,error:`JOB_STATUS_INCOMPATIBLE:${status}`});}catch(error){incompatible.push({run_id:runId,error:String(error?.code||error?.message||error)});}}return{recoverable,terminal,incompatible};}
  async bumpDurableEpoch({runId,manifestPatch={},runStatePatch={}}={}){const protocol=this._requireDurable();const {state,manifest}=this.loadDurable(runId);const nextManifest=evolveManifest(manifest,manifestPatch);const committed=await protocol.bumpEpoch({runId:state.run_id,expectedGeneration:state.generation,expectedEpoch:state.execution_epoch,manifest:nextManifest,runStatePatch});return{state:committed.state,manifest:nextManifest,commit:committed};}
  async claimRecoverableRun(runId,{claimedAt=Date.now()}={}){const {state,manifest}=this.loadDurable(runId);if(manifest.cancellation!==null||state.job_status==="CANCELLED")throw new Error("RUN_CANCELLED");if(!RECOVERABLE_JOB_STATUSES.has(state.job_status))throw new Error(`RUN_NOT_RECOVERABLE:${state.job_status}`);return this.bumpDurableEpoch({runId,manifestPatch:{job:{status:"RUNNING"},policy_refs:{startup_recovery_claimed_at:claimedAt,startup_recovery_from_epoch:state.execution_epoch}},runStatePatch:{job_status:"RUNNING"}});}
}
module.exports={RunAuthority,RECOVERABLE_JOB_STATUSES,TERMINAL_JOB_STATUSES};
