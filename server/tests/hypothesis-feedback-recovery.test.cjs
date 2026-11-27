"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {boundedHypothesisFeedback}=require("../workflow.js");
const ids=["EVI_1","EVI_2"];
function diagnosis(statement,refs=["EVI_1"]){return {diagnosis_status:"HYPOTHESES_RETAINED",hypotheses:[{id:"H1",status:"HYPOTHESIS",statement,evidence_refs:refs,counter_evidence_refs:[],falsification_condition:"Observe a counterexample to "+statement}],confirmed_root_cause:null,unsupported_claims:[]};}
function harness({revised=diagnosis("different cause",ids),verdict="PASS",initialVerdict="FAIL",initialReason="Conflicting evidence",failure=null}={}){
 const store=new Map(),calls={diagnose:0,review:0};
 const args={binding:"bound",initialDiagnosis:diagnosis("first cause"),initialReview:{external:{provider:"review",json:{verdict:initialVerdict,reason:initialReason}}},availableEvidenceIds:ids,load:key=>store.get(key),save:async(key,v)=>store.set(key,v),diagnose:async feedback=>{calls.diagnose++;assert.equal(feedback.authority,"REVIEW_FEEDBACK_NOT_EVIDENCE");if(failure)throw failure;return{diagnosis:revised};},review:async()=>{calls.review++;return{external:{provider:"review",json:{verdict}}};}};
 return {args,calls,store};
}
test("one revised independent PASS only, original rejection is not changed, repeat returns same receipt",async()=>{
 const h=harness();const first=await boundedHypothesisFeedback(h.args);
 assert.equal(first.accepted,true);assert.equal(first.state,"REVISED_HYPOTHESIS_APPROVED");assert.equal(h.args.initialReview.external.json.verdict,"FAIL");assert.deepEqual(await boundedHypothesisFeedback(h.args),first);assert.deepEqual(h.calls,{diagnose:1,review:1});
});
test("unchanged diagnosis, rejected revision, and absent concrete feedback are not approvals",async()=>{
 for(const [options,state] of [[{revised:diagnosis("first cause")},"NO_MATERIAL_DIAGNOSIS_CHANGE"],[{verdict:"FAIL"},"REVISED_HYPOTHESIS_NOT_APPROVED"]]){
  const h=harness(options),r=await boundedHypothesisFeedback(h.args);assert.equal(r.accepted,false);assert.equal(r.state,state);if(state.startsWith("NO_MATERIAL"))assert.equal(h.calls.review,0);
 }
 for(const options of [{initialVerdict:"PASS"},{initialReason:""}]){const h=harness(options);assert.equal(await boundedHypothesisFeedback(h.args),null);assert.deepEqual(h.calls,{diagnose:0,review:0});}
});
test("lost or invalid result cannot replay the same inference or fabricate evidence",async()=>{
 const h=harness({failure:new Error("timeout")});await assert.rejects(boundedHypothesisFeedback(h.args),/timeout/);
 const r=await boundedHypothesisFeedback(h.args);assert.equal(r.accepted,false);assert.equal(r.state,"OUTCOME_UNCERTAIN");assert.deepEqual(h.calls,{diagnose:1,review:0});
 const bad=harness({revised:diagnosis("forged",["EVI_FAKE"])});await assert.rejects(boundedHypothesisFeedback(bad.args),/ROLE_CLAIM_BINDING_INVALID/);assert.equal(bad.calls.review,0);
});
