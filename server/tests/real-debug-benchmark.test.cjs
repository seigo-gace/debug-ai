"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const b=require("../control/real-debug-benchmark.js"),s=require("../../scripts/real-debug-suite.cjs");
test("real suite requires actual sandbox assertions and completion receipt",()=>{
 const c=s.select("L1-01"),check={check_type:"UNIT",executed:true,status:"PASS",exit_code:0,timed_out:false,sandbox:{backend:"sidecar+landlock+seccomp"},stdout:s.marker(c.public_checks)};
 assert.equal(b.measuredTest({checks:[check]},c.public_checks),true);
 for(const delta of [{stdout:""},{executed:false},{timed_out:true},{sandbox:{backend:"fake"}},{exit_code:1}])assert.equal(b.measuredTest({checks:[{...check,...delta}]},c.public_checks),false);
 assert.equal(b.measuredTest({checks:[{...check,status:"FAIL",exit_code:1,stderr:"AssertionError"}]},c.public_checks,{red:true}),true);
 assert.equal(b.measuredTest({checks:[{...check,status:"FAIL",exit_code:1,stderr:"MODULE_NOT_FOUND"}]},c.public_checks,{red:true}),false);
});
test("fixed corpus and isolated public request cannot disclose private oracle",()=>{
 assert.equal(b.selectCases().length,50);assert.deepEqual(b.selectCases(["L5-01","L1-01"]),["L1-01","L5-01"]);assert.throws(()=>b.selectCases(["L1-01","L1-01"]));
 const c=s.select("L1-01"),r=b.requestFor(c,"/workspace/debug-ai/.verification/fixture"),p=s.payload(c);
 assert.equal(JSON.stringify(r).includes(c.oracle.cause),false);
 assert.equal(JSON.stringify(p).includes(c.oracle.reference_files["src/index.cjs"]),false);
 assert.equal(JSON.stringify(p).includes(s.marker(c.holdout_checks)),false);
});
test("independent grade material only accepts existing source replacement",()=>{
 const c=s.select("L1-01"),g=b.gradePayload(c,[{type:"replace",path:"src/index.cjs",content_utf8:"module.exports=(v,n)=>v>=n;"}]);
 assert.match(g["reproduce.cjs"],/DEBUGAI_ORACLE_COMPLETE/);assert.ok(g["reproduce.cjs"].includes(s.marker(c.holdout_checks)));
 assert.throws(()=>b.gradePayload(c,[{type:"replace",path:"reproduce.cjs",content_utf8:""}]));
 assert.throws(()=>b.gradePayload(c,[{type:"create",path:"src/new.cjs",content_utf8:""}]));
});
test("fixture readback rejects tampering and symlink",t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"debug-fixture-")),repo=path.join(root,"case");t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const p=s.payload(s.select("L1-01"));s.writeNew(repo,p);assert.equal(b.exactFixture(repo,p),true);fs.writeFileSync(path.join(repo,"src/index.cjs"),"bad");assert.throws(()=>b.exactFixture(repo,p));fs.writeFileSync(path.join(repo,"src/index.cjs"),p["src/index.cjs"]);fs.symlinkSync("/outside",path.join(repo,"alias"));assert.throws(()=>b.exactFixture(repo,p),/SYMLINK/);
});
test("blocked and not-run cases cannot inflate functional repair precision",()=>{
 const x=b.makeSummary([{id:"L1-01",level:1,state:"DONE",repair_pass:true,review_pass:false,diagnosis:{},cause_accuracy:"UNREVIEWED"},{id:"L2-01",level:2,state:"BLOCKED",repair_pass:false}],50);assert.equal(x.total,50);assert.equal(x.completed,2);assert.equal(x.repair_pass,1);assert.equal(x.blocked,1);assert.equal(x.review_pass,0);assert.equal(x.unreviewed_diagnoses,1);
});

test("repeated identical blocked cases pause the suite without changing repair scoring",()=>{
 const blocked={state:"BLOCKED",error_code:"HYPOTHESIS_REVIEW_NOT_PASS",repair_pass:false};
 assert.equal(b.repeatedBlockedCode([blocked,blocked]),null);
 assert.equal(b.repeatedBlockedCode([blocked,blocked,blocked]),blocked.error_code);
 assert.equal(b.repeatedBlockedCode([blocked,{...blocked,error_code:"AI_CORE_TIMEOUT"},blocked]),null);
 assert.equal(b.repeatedBlockedCode([blocked,blocked,{state:"FAILED",error_code:blocked.error_code}]),null);
 assert.equal(b.repeatedBlockedCode([blocked,blocked,{state:"DONE",repair_pass:true}]),null);
});

test("interrupted benchmark child is held only for its exact saved owner and may be explicitly resumed",async()=>{
 const bid="realdebug_"+"a".repeat(32),runId="run_fixture",caseId="L1-01";
 const checkpoint={schema:b.SCHEMA,benchmark_id:bid,state:"RUNNING",case_ids:[caseId,"L1-02"],current:{run_id:runId,case_id:caseId,phase:"ANALYSIS"},results:[]};
 const item={run_id:runId,state:{job_status:"RUNNING",project_id:"debugai-real-debug-"+caseId,project_dir:"/workspace/debug-ai/.verification/real-debug/"+bid+"/"+caseId},manifest:{policy_refs:{}}};
 let cp=checkpoint;const changes=[];
 const runtimeEvidence={list:(id)=>id===bid?[{payload:cp}]:[],write:(id,type,payload)=>{assert.equal(id,bid);assert.equal(type,"real_debug_benchmark");cp=payload;}};
 const authority={bumpDurableEpoch:async args=>{changes.push(args);item.state.job_status=args.runStatePatch.job_status;item.manifest.policy_refs=args.manifestPatch.policy_refs;}};
 assert.equal(b.benchmarkRunOwner({...item,run_id:"other"},runtimeEvidence),null);
 assert.equal(b.benchmarkRunOwner({...item,state:{...item.state,project_dir:"/workspace/other"}},runtimeEvidence),null);
 const held=await b.holdInterruptedBenchmarkRun({item,authority,runtimeEvidence,now:()=>123});
 assert.equal(held.run_id,runId);assert.equal(cp.state,"PAUSED");assert.equal(cp.current.run_id,runId);assert.equal(cp.results.length,0);
 assert.equal(changes.length,1);assert.equal(b.isHeldBenchmarkRun(item,runtimeEvidence),true);
 await b.holdInterruptedBenchmarkRun({item,authority,runtimeEvidence,now:()=>124});
 assert.equal(changes.length,1,"restart must not advance a held run again");
});
