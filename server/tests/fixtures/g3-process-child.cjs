"use strict";
const path=require("node:path"),fs=require("node:fs");
const {DurableWriterLock}=require("../../../orchestrator/durable-writer-lock.js");
const {DurableFileIO}=require("../../../orchestrator/durable-file-io.js");
const {RunAuthority}=require("../../run-authority.js");
const {createWorkflow}=require("../../workflow.js");
const {setup,examples}=require("./g3-semantic-cases.cjs");
(async()=>{
 const [root,mode]=process.argv.slice(2),lock=DurableWriterLock.acquire({root:path.join(root,"durable")});
 try{
  const a=new RunAuthority({runtimeRoot:root,durableIo:new DurableFileIO({writerLock:lock})});
  let runId;if(mode==="initial"){const run=a.start({rawRequest:"G3 restart acceptance"});await a.initializeDurable(run);runId=run.run_id;fs.writeFileSync(path.join(root,"run-id"),runId);}else runId=fs.readFileSync(path.join(root,"run-id"),"utf8");
  let calls=0;
  const wf=createWorkflow({authority:a,aiCore:{call:async(role)=>{
   calls++;const {marker,e}=setup(role);
   if(mode==="replay")throw Error("REPLAY_INFERENCE_FORBIDDEN");
   return{content:JSON.stringify(mode==="initial"?{status:"CONTINUE",progress:{verified_work:[marker],remaining_work:[]}}:{status:"COMPLETE",result:{...e.result,verified_work:[marker]}})};
  }}});
  const stages=[];
  for(const role of Object.keys(examples)){
   const {criteria,record}=setup(role);
   const stage=await wf.continueRoleTask({runId,role,workItemId:"original",inputBinding:"source-revision",task:"same fixed task",semanticCriteria:criteria,evidenceRecords:[record]});
   stages.push({role,status:stage.status,revision:stage.revision,qualified:stage.progress.qualification.total_qualified_progress_ids});
  }
  process.stdout.write(JSON.stringify({runId,calls,stages})+"\n");
 }finally{lock.close();}
})().catch(e=>{process.stderr.write(String(e.stack)+"\n");process.exitCode=1;});
