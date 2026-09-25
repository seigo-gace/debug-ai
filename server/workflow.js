"use strict";
const crypto=require("node:crypto");
const {assertPromotable}=require("./asset-promotion.js");
function parseJson(c){if(typeof c!=="string")return c;return JSON.parse(c.trim().replace(/^```json\s*/i,"").replace(/```$/i,"").trim());}
function createWorkflow({aiCore,externalReview=null,evidenceSearch=null,runtimeEvidence=null,tgserver=null,patchService=null,authority=null}={}){
  if(!aiCore)throw new Error("AI_CORE_ADAPTER_REQUIRED");
  async function logRuntime(event){if(tgserver)await tgserver.log(event);}
  async function runAnalysis({runId=null,rawRequest="",failure,localEvidence=[],repo=null,projectId=null}={}){
    let authRun=null;
    if(authority){authRun=authority.start({rawRequest,repo,projectId});runId=authRun.run_id;authority.transition(authRun,"PARSED");authority.transition(authRun,"CONTEXT_READY");authority.transition(authRun,"VERIFYING");authority.transition(authRun,"FAILED");authority.transition(authRun,"RESOLVING");}
    runId=runId||crypto.randomUUID();
    runtimeEvidence?.write(runId,"failure",failure);
    await logRuntime({run_id:runId,severity:"error",kind:"failure",failure});
    const query=String(failure?.message||failure?.summary||"debug failure");
    const [scouts,knownKnowledge,official]=await Promise.all([
      Promise.all([
        aiCore.call("code_scout",{system:"Code Scout. JSON only.",user:JSON.stringify({failure,evidence:localEvidence})}),
        aiCore.call("causal_scout",{system:"Causal Scout. JSON only.",user:JSON.stringify({failure,evidence:localEvidence})})
      ]),
      tgserver?tgserver.search(query):Promise.resolve([]),
      evidenceSearch?evidenceSearch.search({query}):Promise.resolve([]),
    ]);
    const research=await aiCore.call("researcher",{system:"Researcher. Select decisive evidence. JSON only.",user:JSON.stringify({failure,localEvidence,scouts:scouts.map(x=>parseJson(x.content)),knownKnowledge,official})});
    const diagnosis=await aiCore.call("diagnoser",{system:"Diagnoser. Produce falsifiable diagnosis. JSON only.",user:JSON.stringify({failure,research:parseJson(research.content),knownKnowledge})});
    const diagnosisJson=parseJson(diagnosis.content);
    const hypothesis={privacy_class:"PUBLIC",sanitized:true,opaque_evidence:true,statement:String(diagnosisJson?.public_statement||"behavioral mismatch"),cause_class:String(diagnosisJson?.cause_kind||"UNKNOWN"),evidence_count:localEvidence.length+knownKnowledge.length+official.length};
    let external=null;if(externalReview)external=await externalReview.hypothesis({privacy:{privacy_class:"PUBLIC",sanitized:true,opaque_evidence:true},hypothesis});
    const result={run_id:runId,scouts:scouts.map(x=>parseJson(x.content)),known_knowledge:knownKnowledge,official_evidence:official,research:parseJson(research.content),diagnosis:diagnosisJson,external_hypothesis_review:external,state:external?.json?.verdict==="PASS"?"HYPOTHESIS_APPROVED":"AWAITING_EXTERNAL_HYPOTHESIS_REVIEW"};
    runtimeEvidence?.write(runId,"analysis",result);
    await logRuntime({run_id:runId,severity:"info",kind:"analysis",state:result.state,diagnosis:result.diagnosis,known_knowledge_count:knownKnowledge.length,official_evidence_count:official.length});
    return result;
  }
  async function patchCandidate({runId,analysis,repo,selectedPaths,context,task}){
    const verdict=analysis?.external_hypothesis_review?.json?.verdict||analysis?.external_review?.verdict;
    if(verdict!=="PASS")throw new Error("PATCH_REQUIRES_EXTERNAL_HYPOTHESIS_REVIEW_PASS");
    const out=await aiCore.call("patch_engineer",{system:"Patch Engineer. Candidate only. Never apply. JSON only.",user:JSON.stringify({diagnosis:analysis.diagnosis,context,task})});
    const candidateResult=parseJson(out.content);const candidate=patchService?patchService.create({repo,selectedPaths,task,result:candidateResult}):candidateResult;
    if(authority){let run=authority.load(runId);run=authority.transition(run,"PATCH_READY");authority.transition(run,"WAITING_APPROVAL");}
    runtimeEvidence?.write(runId,"patch_candidate",{id:candidate.id,diff_hash:candidate.diff_hash,summary:candidate.summary});
    await logRuntime({run_id:runId,severity:"info",kind:"patch_candidate",candidate_id:candidate.id,diff_hash:candidate.diff_hash,summary:candidate.summary,state:"WAITING_MASTER_APPROVAL"});
    return {run_id:runId,state:"WAITING_MASTER_APPROVAL",candidate};
  }
  async function approveAndVerify({runId,candidateId,candidateHash,decision,repo}){
    if(!patchService)throw new Error("PATCH_SERVICE_REQUIRED");
    let run=null;if(authority)run=authority.load(runId);
    if(decision!=="approve"){if(authority)authority.transition(run,"BLOCKED");throw new Error("PATCH_APPROVAL_REQUIRED");}
    if(authority)run=authority.transition(run,"APPLYING");
    let out;try{out=patchService.apply({candidateId,candidateHash,decision,repo});}catch(e){if(authority){try{authority.transition(run,"BLOCKED");}catch{}}throw e;}
    if(authority)run=authority.transition(run,"RETESTING");
    runtimeEvidence?.write(runId,"verification",{checks:out.checks,invariants:out.invariants,gates:out.gates,pass:out.pass});
    await logRuntime({run_id:runId,severity:out.pass?"info":"error",kind:"verification",pass:out.pass,checks:out.checks,invariants:out.invariants,gates:out.gates});
    if(!out.pass){if(authority)authority.transition(run,"FAILED");return {run_id:runId,state:"FAILED_RETEST",...out};}
    const lr=await aiCore.call("local_reviewer",{system:"Local Reviewer. Review deterministic results. JSON only.",user:JSON.stringify({checks:out.checks,invariants:out.invariants,gates:out.gates})});
    const local_review=parseJson(lr.content);let final=null;if(externalReview)final=await externalReview.final({privacy:{privacy_class:"PUBLIC",sanitized:true,opaque_evidence:true},summary:{check_count:out.checks.length,invariants_pass:out.invariants.pass,local_verdict:local_review.verdict||"UNKNOWN"}});
    const complete=final?.json?.verdict==="PASS";
    if(authority&&complete)authority.transition(run,"COMPLETE");
    const state=complete?"COMPLETE":"AWAITING_EXTERNAL_FINAL_REVIEW";
    await logRuntime({run_id:runId,severity:complete?"info":"warn",kind:"final_review",state,local_verdict:local_review.verdict||"UNKNOWN",external_verdict:final?.json?.verdict||"PENDING"});
    return {run_id:runId,state,...out,local_review,external_final_review:final};
  }
  async function promote(asset){assertPromotable(asset);if(!tgserver)throw new Error("TGSERVER_ADAPTER_REQUIRED");return tgserver.promote(asset);}
  async function searchKnowledge(query,opts={}){if(!tgserver)throw new Error("TGSERVER_ADAPTER_REQUIRED");return tgserver.search(query,opts);}
  return {runAnalysis,patchCandidate,approveAndVerify,promote,searchKnowledge};
}
module.exports={createWorkflow};
