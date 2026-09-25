"use strict";
const path=require("node:path");
const C=require("../orchestrator/contracts.js");
const {Store}=require("../orchestrator/store.js");
const {StateMachine}=require("../orchestrator/state-machine.js");
class RunAuthority{
  constructor({runtimeRoot,repoPolicy=null}={}){
    if(!runtimeRoot)throw new Error("RUNTIME_ROOT_REQUIRED");
    this.store=new Store(path.join(runtimeRoot,"authority"));
    this.machine=new StateMachine({store:this.store});
    this.repoPolicy=repoPolicy;
  }
  start({rawRequest,repo,projectId}={}){
    const projectDir=this.repoPolicy?this.repoPolicy.assertRepo(repo):path.resolve(String(repo||process.cwd()));
    const request=C.makeRequest({raw:String(rawRequest||"")});
    this.store.saveRequest(request);
    const run=C.makeRunState({request_hash:request.request_hash,project_dir:projectDir,project_id:String(projectId||path.basename(projectDir))});
    this.store.saveRunState(run);
    return run;
  }
  load(runId){const run=this.store.loadRunState(String(runId||""));if(!run)throw new Error("RUN_NOT_FOUND");return run;}
  transition(runOrId,next){const run=typeof runOrId==="string"?this.load(runOrId):runOrId;return this.machine.transition(run,next);}
}
module.exports={RunAuthority};
