"use strict";
const crypto=require("node:crypto");
const {assertPromotable}=require("./asset-promotion.js");
function parseJson(c){if(typeof c!=="string")return c;return JSON.parse(c.trim().replace(/^```json\s*/i,"").replace(/```$/i,"").trim());}
function createWorkflow({aiCore,externalReview=null,evidenceSearch=null,runtimeEvidence=null,tgAssets=null,patchService=null,authority=null}={}){
  if(!aiCore)throw new Error("AI_CORE_ADAPTER_REQUIRED");
  async function runAnalysis({runId=null,rawRequest="",failure,localEvidence=[],repo=null,projectId=null}={}){
    let authRun=null;
    if(authority){authRun=authority.start({rawRequest,repo,projectId});runId=authRun.run_id;authority.transition(authRun,"PARSED");authority.transition(authRun,"CONTEXT_READY");authority.transition(authRun,"VERIFYING");authority.transition(authRun,"FAILED");authority.transition(authRun,"RESOLVING");}
    runId=runId||crypto.randomUUID();
    runtimeEvidence?.write(runId,"failure",failure);
    const scouts=await Promise.all([
      aiCore.call("code_scout",{system:"Code Scout. JSON only.",user:JSON.stringify({failure,evidence:localEvidence})}),
      aiCore.call("causal_scout",{system:"Causal Scout. JSON only.",user:JSON.stringify({failure,evidence:localEvidence})})
    ]);
    const official=evidenceSearch?await evidenceSearch.search({query:String(failure?.message||failure?.summary||"debug failure")}):[];
    const research=await aiCore.call("researcher",{system:"Researcher. Select decisive evidence. JSON only.",user:JSON.stringify({failure,localEvidence,scouts:scouts.map(x=>parseJson(x.content)),official})});
    const diagnosis=await aiCore.call("diagnoser",{system:"Diagnoser. Produce falsifiable diagnosis. JSON only.",user:JSON.stringify({failure,research:parseJson(research.content)})});
    const hypothesis={privacy_class:"PUBLIC",sanitized:true,opaque_evidence:true,statement:String(parseJson(diagnosis.content)?.public_statement||"behavioral mismatch"),cause_class:String(parseJson(diagnosis.content)?.cause_kind||"UNKNOWN"),evidence_count:localEvidence.length+official.length};
    let external=null;if(externalReview)external=await externalReview.hypothesis({privacy:{privacy_class:"PUBLIC",sanitized:true,opaque_evidence:true},hypothesis});
    const result={run_id:runId,scouts:scouts.map(x=>parseJson(x.content)),official_evidence:official,research:parseJson(research.content),diagnosis:parseJson(diagnosis.content),external_hypothesis_review:external,state:external?.json?.verdict==="PASS"?"HYPOTHESIS_APPROVED":"AWAITING_EXTERNAL_HYPOTHESIS_REVIEW"};
    runtimeEvidence?.write(runId,"analysis",result);return result;
  }
  async function patchCandidate({runId,analysis,repo,selectedPaths,context,task}){
    const verdict=analysis?.external_hypothesis_review?.json?.verdict||analysis?.external_review?.verdict;
    if(verdict!=="PASS")throw new Error("PATCH_REQUIRES_EXTERNAL_HYPOTHESIS_REVIEW_PASS");
    const out=await aiCore.call("patch_engineer",{system:"Patch Engineer. Candidate only. Never apply. JSON only.",user:JSON.stringify({diagnosis:analysis.diagnosis,context,task})});
    const candidateResult=parseJson(out.content);const candidate=patchService?patchService.create({repo,selectedPaths,task,result:candidateResult}):candidateResult;
    if(authority){let run=authority.load(runId);run=authority.transition(run,"PATCH_READY");authority.transition(run,"WAITING_APPROVAL");}
    runtimeEvidence?.write(runId,"patch_candidate",{id:candidate.id,diff_hash:candidate.diff_hash,summary:candidate.summary});return {run_id:runId,state:"WAITING_MASTER_APPROVAL",candidate};
  }
  async function approveAndVerify({runId,candidateId,candidateHash,decision,repo}){
    if(!patchService)throw new Error("PATCH_SERVICE_REQUIRED");
    let run=null;if(authority)run=authority.load(runId);
    if(decision!=="approve"){if(authority)authority.transition(run,"BLOCKED");throw new Error("PATCH_APPROVAL_REQUIRED");}
    if(authority)run=authority.transition(run,"APPLYING");
    let out;try{out=patchService.apply({candidateId,candidateHash,decision,repo});}catch(e){if(authority){try{authority.transition(run,"BLOCKED");}catch{}}throw e;}
    if(authority)run=authority.transition(run,"RETESTING");
    runtimeEvidence?.write(runId,"verification",{checks:out.checks,invariants:out.invariants,gates:out.gates,pass:out.pass});
    if(!out.pass){if(authority)authority.transition(run,"FAILED");return {run_id:runId,state:"FAILED_RETEST",...out};}
    const lr=await aiCore.call("local_reviewer",{system:"Local Reviewer. Review deterministic results. JSON only.",user:JSON.stringify({checks:out.checks,invariants:out.invariants,gates:out.gates})});
    const local_review=parseJson(lr.content);let final=null;if(externalReview)final=await externalReview.final({privacy:{privacy_class:"PUBLIC",sanitized:true,opaque_evidence:true},summary:{check_count:out.checks.length,invariants_pass:out.invariants.pass,local_verdict:local_review.verdict||"UNKNOWN"}});
    const complete=final?.json?.verdict==="PASS";
    if(authority&&complete)authority.transition(run,"COMPLETE");
    return {run_id:runId,state:complete?"COMPLETE":"AWAITING_EXTERNAL_FINAL_REVIEW",...out,local_review,external_final_review:final};
  }
  async function promote(asset){assertPromotable(asset);if(!tgAssets)throw new Error("TGSERVER_ASSET_ADAPTER_REQUIRED");return tgAssets.promote(asset);}
  return {runAnalysis,patchCandidate,approveAndVerify,promote};
}
module.exports={createWorkflow};
