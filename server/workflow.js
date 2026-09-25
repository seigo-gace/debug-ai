"use strict";
const crypto=require("node:crypto");
const {assertPromotable}=require("./asset-promotion.js");
const EXTERNAL_EVIDENCE_CATEGORIES=new Set(["DEPENDENCY","API","VERSION","KNOWN_BUG","CVE","SPECIFICATION_CONFLICT","SPEC_CONFLICT"]);
function parseJson(c){if(typeof c!=="string")return c;return JSON.parse(c.trim().replace(/^```json\s*/i,"").replace(/```$/i,"").trim());}
function localEvidenceSufficient(localEvidence=[]){return localEvidence.some(x=>x&&typeof x==="object"&&(x.sufficient_for_attribution===true||x.root_cause_confirmed===true||String(x.status||"").toUpperCase()==="CONFIRMED_CAUSE"));}
function shouldSearchExternalEvidence({failure,localEvidence=[]}={}){if(failure?.evidence_gap===true||failure?.external_evidence_required===true)return true;if(localEvidenceSufficient(localEvidence))return false;const category=String(failure?.category||failure?.cause_class||failure?.kind||"").trim().toUpperCase().replace(/[ -]+/g,"_");return EXTERNAL_EVIDENCE_CATEGORIES.has(category);}
function telemetry(adapter,stream,eventType,runId,payload,severity="info"){if(!adapter||typeof adapter.emit!=="function")return;Promise.resolve(adapter.emit({stream,eventType,runId,payload,severity})).catch(()=>{});}
function createWorkflow({aiCore,externalReview=null,evidenceSearch=null,runtimeEvidence=null,tgAssets=null,patchService=null,authority=null}={}){
  if(!aiCore)throw new Error("AI_CORE_ADAPTER_REQUIRED");
  async function runAnalysis({runId=null,rawRequest="",failure,localEvidence=[],repo=null,projectId=null}={}){
    let authRun=null;
    if(authority){authRun=authority.start({rawRequest,repo,projectId});runId=authRun.run_id;authority.transition(authRun,"PARSED");authority.transition(authRun,"CONTEXT_READY");authority.transition(authRun,"VERIFYING");authority.transition(authRun,"FAILED");authority.transition(authRun,"RESOLVING");}
    runId=runId||crypto.randomUUID();
    runtimeEvidence?.write(runId,"failure",failure);telemetry(tgAssets,"EVIDENCE","FAILURE_OBSERVED",runId,{failure,local_evidence_count:localEvidence.length},"info");
    const scouts=await Promise.all([
      aiCore.call("code_scout",{system:"Code Scout. JSON only.",user:JSON.stringify({failure,evidence:localEvidence})}),
      aiCore.call("causal_scout",{system:"Causal Scout. JSON only.",user:JSON.stringify({failure,evidence:localEvidence})})
    ]);
    const searchRequired=shouldSearchExternalEvidence({failure,localEvidence});
    const searchResult=searchRequired&&evidenceSearch?await evidenceSearch.search({query:String(failure?.message||failure?.summary||"debug failure"),context:JSON.stringify({category:failure?.category||failure?.cause_class||failure?.kind||null}),requestId:`${runId}-evidence`}):{performed:false,status:searchRequired?"UNAVAILABLE":"NOT_REQUIRED",evidence:[],evidence_registry:null,evidence_bindings:null};
    const official=Array.isArray(searchResult.evidence)?searchResult.evidence:[];
    telemetry(tgAssets,"EVIDENCE","EVIDENCE_COLLECTION_COMPLETE",runId,{local_evidence_count:localEvidence.length,external_search_required:searchRequired,external_search_status:searchResult.status,official_evidence_count:official.length,evidence_registry_hash:searchResult.evidence_registry?.registry_hash||null,evidence_bindings_hash:searchResult.evidence_bindings?.bindings_hash||null},"info");
    const research=await aiCore.call("researcher",{system:"Researcher. Select decisive evidence. JSON only.",user:JSON.stringify({failure,localEvidence,scouts:scouts.map(x=>parseJson(x.content)),official})});
    const diagnosis=await aiCore.call("diagnoser",{system:"Diagnoser. Produce falsifiable diagnosis. JSON only.",user:JSON.stringify({failure,research:parseJson(research.content)})});
    const hypothesis={privacy_class:"PUBLIC",sanitized:true,opaque_evidence:true,statement:String(parseJson(diagnosis.content)?.public_statement||"behavioral mismatch"),cause_class:String(parseJson(diagnosis.content)?.cause_kind||"UNKNOWN"),evidence_count:localEvidence.length+official.length};
    let external=null;if(externalReview)external=await externalReview.hypothesis({privacy:{privacy_class:"PUBLIC",sanitized:true,opaque_evidence:true},hypothesis});
    const result={run_id:runId,scouts:scouts.map(x=>parseJson(x.content)),official_evidence:official,evidence_search:{performed:searchResult.performed===true,required:searchRequired,status:searchResult.status,evidence_registry:searchResult.evidence_registry||null,evidence_bindings:searchResult.evidence_bindings||null},research:parseJson(research.content),diagnosis:parseJson(diagnosis.content),external_hypothesis_review:external,state:external?.json?.verdict==="PASS"?"HYPOTHESIS_APPROVED":"AWAITING_EXTERNAL_HYPOTHESIS_REVIEW"};
    runtimeEvidence?.write(runId,"analysis",result);telemetry(tgAssets,"TRACE","ANALYSIS_COMPLETE",runId,{state:result.state,evidence_count:hypothesis.evidence_count,external_review_verdict:external?.json?.verdict||null},"debug");return result;
  }
  async function patchCandidate({runId,analysis,repo,selectedPaths,context,task}){
    const verdict=analysis?.external_hypothesis_review?.json?.verdict||analysis?.external_review?.verdict;
    if(verdict!=="PASS")throw new Error("PATCH_REQUIRES_EXTERNAL_HYPOTHESIS_REVIEW_PASS");
    const out=await aiCore.call("patch_engineer",{system:"Patch Engineer. Candidate only. Never apply. JSON only.",user:JSON.stringify({diagnosis:analysis.diagnosis,context,task})});
    const candidateResult=parseJson(out.content);const candidate=patchService?patchService.create({repo,selectedPaths,task,result:candidateResult}):candidateResult;
    if(authority){let run=authority.load(runId);run=authority.transition(run,"PATCH_READY");authority.transition(run,"WAITING_APPROVAL");}
    runtimeEvidence?.write(runId,"patch_candidate",{id:candidate.id,diff_hash:candidate.diff_hash,summary:candidate.summary});telemetry(tgAssets,"TRACE","PATCH_CANDIDATE",runId,{candidate_id:candidate.id,diff_hash:candidate.diff_hash,summary:candidate.summary},"debug");return {run_id:runId,state:"WAITING_MASTER_APPROVAL",candidate};
  }
  async function approveAndVerify({runId,candidateId,candidateHash,decision,repo}){
    if(!patchService)throw new Error("PATCH_SERVICE_REQUIRED");
    let run=null;if(authority)run=authority.load(runId);
    if(decision!=="approve"){if(authority)authority.transition(run,"BLOCKED");telemetry(tgAssets,"RESULT","PATCH_NOT_APPROVED",runId,{candidate_id:candidateId},"warn");throw new Error("PATCH_APPROVAL_REQUIRED");}
    if(authority)run=authority.transition(run,"APPLYING");telemetry(tgAssets,"TRACE","PATCH_APPROVED",runId,{candidate_id:candidateId},"info");
    let out;try{out=patchService.apply({candidateId,candidateHash,decision,repo});}catch(e){if(authority){try{authority.transition(run,"BLOCKED");}catch{}}telemetry(tgAssets,"RESULT","PATCH_APPLY_FAILED",runId,{candidate_id:candidateId,error_code:e?.code||e?.name||"PATCH_APPLY_FAILED"},"error");throw e;}
    if(authority)run=authority.transition(run,"RETESTING");
    runtimeEvidence?.write(runId,"verification",{checks:out.checks,invariants:out.invariants,gates:out.gates,pass:out.pass});telemetry(tgAssets,"RESULT","DETERMINISTIC_VERIFICATION",runId,{pass:out.pass,checks:out.checks,invariants:out.invariants,gates:out.gates},out.pass?"info":"error");
    if(!out.pass){if(authority)authority.transition(run,"FAILED");return {run_id:runId,state:"FAILED_RETEST",...out};}
    const lr=await aiCore.call("local_reviewer",{system:"Local Reviewer. Review deterministic results. JSON only.",user:JSON.stringify({checks:out.checks,invariants:out.invariants,gates:out.gates})});
    const local_review=parseJson(lr.content);let final=null;if(externalReview)final=await externalReview.final({privacy:{privacy_class:"PUBLIC",sanitized:true,opaque_evidence:true},summary:{check_count:out.checks.length,invariants_pass:out.invariants.pass,local_verdict:local_review.verdict||"UNKNOWN"}});
    const complete=final?.json?.verdict==="PASS";
    if(authority&&complete)authority.transition(run,"COMPLETE");telemetry(tgAssets,"RESULT","FINAL_REVIEW",runId,{state:complete?"COMPLETE":"AWAITING_EXTERNAL_FINAL_REVIEW",local_verdict:local_review.verdict||"UNKNOWN",external_verdict:final?.json?.verdict||null},complete?"info":"warn");
    return {run_id:runId,state:complete?"COMPLETE":"AWAITING_EXTERNAL_FINAL_REVIEW",...out,local_review,external_final_review:final};
  }
  async function promote(asset){assertPromotable(asset);if(!tgAssets)throw new Error("TGSERVER_ASSET_ADAPTER_REQUIRED");return tgAssets.promote(asset);}
  return {runAnalysis,patchCandidate,approveAndVerify,promote};
}
module.exports={EXTERNAL_EVIDENCE_CATEGORIES,localEvidenceSufficient,shouldSearchExternalEvidence,createWorkflow};
