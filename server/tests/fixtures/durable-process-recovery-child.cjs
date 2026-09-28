"use strict";
const path=require("node:path");
const {DurableWriterLock}=require("../../../orchestrator/durable-writer-lock.js");
const {DurableFileIO}=require("../../../orchestrator/durable-file-io.js");
const {RunAuthority}=require("../../run-authority.js");
const {RepoPolicy}=require("../../repo-policy.js");
const {createWorkflow}=require("../../workflow.js");

function emit(type,payload={}){process.stdout.write(`${JSON.stringify({type,...payload})}\n`);}
function fakeAi(){return{call:async(role,payload)=>{
  if(role==="researcher")return{content:JSON.stringify({research_status:"INSUFFICIENT_EVIDENCE",answer:"fixture evidence is insufficient",evidence_refs:[],rejected_source_refs:[],contradictions:[],bound_version:"test/v1"})};
  if(role==="diagnoser"){
    const input=JSON.parse(payload.user);emit("DIAGNOSER_INPUT",{source_role_execution_id:input?.researcher_role_result?.source_role_execution_id||null,source_role_result_id:input?.researcher_role_result?.source_role_result_id||null});
    return{content:JSON.stringify({diagnoses:[{hypothesis:"fixture",status:"unknown"}],public_statement:"fixture diagnosis"})};
  }
  return{content:JSON.stringify({authority:"HINT_ONLY"})};
}};}

async function main(){
  const [mode,runtimeRoot,workspaceRoot,repo,runIdArg]=process.argv.slice(2);
  if(!["initial","recover"].includes(mode)||!runtimeRoot||!workspaceRoot||!repo)throw new Error("FIXTURE_ARGS_INVALID");
  const writerLock=DurableWriterLock.acquire({root:path.join(runtimeRoot,"durable")});
  let holdTimer=null;
  try{
    const durableIo=new DurableFileIO({writerLock});
    const repoPolicy=new RepoPolicy({workspaceRoot});
    const authority=new RunAuthority({runtimeRoot,repoPolicy,durableIo});
    const workEvents=[];
    const workflow=createWorkflow({
      aiCore:fakeAi(),
      authority,
      repoPolicy,
      repositorySnapshot:()=>"git_process_fixture",
      externalReview:{hypothesis:async()=>({provider:"fixture",json:{verdict:"PASS"}})},
      recoveryHooks:{beforeResearcherWorkUnit:async({unit,roleExecutionId,attemptNo})=>{
        const event={unit:unit.work_unit_id,role_execution_id:roleExecutionId,attempt_no:attemptNo};workEvents.push(event);emit("WORK",event);
        if(mode==="initial"&&unit.work_unit_id==="researcher.C"){
          emit("INTERRUPT_POINT",event);
          await new Promise(resolve=>{holdTimer=setTimeout(resolve,10*60*1000);});
        }
      }}
    });
    if(mode==="initial"){
      const accepted=await workflow.startAnalysis({repo,projectId:"P",rawRequest:"real process restart fixture",failure:{message:"fixture failure"},localEvidence:[]});
      emit("STARTED",{run_id:accepted.run_id});
      await new Promise(resolve=>setTimeout(resolve,10*60*1000));
      return;
    }
    if(typeof runIdArg!=="string"||!runIdArg)throw new Error("FIXTURE_RUN_ID_REQUIRED");
    const recovery=await workflow.recoverStartup({awaitCompletion:true});
    const status=workflow.status(runIdArg);
    emit("RECOVERY",{recovery,status,work_events:workEvents});
  }finally{
    if(holdTimer)clearTimeout(holdTimer);
    try{writerLock.close();}catch{}
  }
}
main().catch(error=>{emit("ERROR",{error:String(error?.code||error?.message||error),stack:String(error?.stack||"").slice(0,4000)});process.exitCode=1;});
