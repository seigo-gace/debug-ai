"use strict";
const crypto=require("node:crypto");
const {assertPromotable}=require("./asset-promotion.js");
const {createReadOnlyToolRuntime}=require("./control/read-only-tool-runtime.js");
const {runRoleWithReadOnlyTools}=require("./control/tool-loop.js");
const {parseAndValidateRoleOutput}=require("./control/role-output-validator.js");

function parseJson(c){if(typeof c!=="string")return c;return JSON.parse(c.trim().replace(/^```json\s*/i,"").replace(/```$/i,"").trim());}
function roleOutput(call,role){
  if(call?.validated_output&&typeof call.validated_output==="object")return call.validated_output;
  return parseAndValidateRoleOutput(role,call?.content,{availableEvidenceIds:call?.tool_loop?.evidence_ids||[]});
}
function toolAudit(call){
  const loop=call?.tool_loop;if(!loop)return null;
  const tools=[];
  for(const observation of loop.observations||[])for(const item of observation.results||[]){const tool=item?.request?.tool;if(tool&&!tools.includes(tool))tools.push(tool);}
  return {rounds:Number(loop.rounds||0),total_calls:Number(loop.total_calls||0),evidence_ids:[...(loop.evidence_ids||[])],selected_skill_ids:[...(loop.selected_skill_ids||[])],tools};
}
function pickDiagnosisStatement(diagnosisJson){
  if(diagnosisJson?.public_statement)return String(diagnosisJson.public_statement);
  if(diagnosisJson?.hypothesis)return String(diagnosisJson.hypothesis);
  if(Array.isArray(diagnosisJson?.diagnoses)&&diagnosisJson.diagnoses[0]?.hypothesis)return String(diagnosisJson.diagnoses[0].hypothesis);
  return "behavioral mismatch";
}
function publicLocalEvidence(localEvidence){
  return (Array.isArray(localEvidence)?localEvidence:[]).map((item,index)=>({id:String(item?.id||`L${String(index+1).padStart(3,"0")}`),kind:String(item?.kind||"local"),observation:String(item?.observation||item?.summary||"")})).filter(item=>item.observation);
}
function createWorkflow({aiCore,externalReview=null,evidenceSearch=null,runtimeEvidence=null,tgserver=null,patchService=null,authority=null,repoPolicy=null}={}){
  if(!aiCore)throw new Error("AI_CORE_ADAPTER_REQUIRED");
  async function logRuntime(event){if(tgserver)await tgserver.log(event);}
  function makeReadOnlyToolRuntime(repoPath){if(!repoPolicy||!repoPath)return null;return createReadOnlyToolRuntime({repo:repoPath,repoPolicy,tgserver,evidenceSearch});}
  async function callReadOnlyRole(role,{system,user},toolRuntime){return runRoleWithReadOnlyTools({aiCore,role,system,user,toolRuntime,maxToolRounds:2,maxToolCalls:4});}
  async function getOfficialEvidence(query){
    if(!evidenceSearch)return{official:[],evidenceGap:false,evidenceStatus:"NOT_CONFIGURED"};
    try{return{official:await evidenceSearch.search({query}),evidenceGap:false,evidenceStatus:"FINAL_VALID"};}
    catch(e){if(e?.code==="EVIDENCE_SEARCH_NOT_FINAL")return{official:[],evidenceGap:true,evidenceStatus:String(e?.meta?.status||"NOT_FINAL")};throw e;}
  }
  async function runAnalysis({runId=null,rawRequest="",failure,localEvidence=[],repo=null,projectId=null}={}){
    let authRun=null;
    if(authority){authRun=authority.start({rawRequest,repo,projectId});runId=authRun.run_id;authority.transition(authRun,"PARSED");authority.transition(authRun,"CONTEXT_READY");authority.transition(authRun,"VERIFYING");authority.transition(authRun,"FAILED");authority.transition(authRun,"RESOLVING");}
    runId=runId||crypto.randomUUID();
    const targetRepo=authRun?.project_dir||(repoPolicy&&repo?repoPolicy.assertRepo(repo):null);
    const toolRuntime=makeReadOnlyToolRuntime(targetRepo);
    runtimeEvidence?.write(runId,"failure",failure);
    await logRuntime({run_id:runId,severity:"error",kind:"failure",failure});
    const query=String(failure?.message||failure?.summary||"debug failure");
    const [scouts,knownKnowledge,evidenceResult]=await Promise.all([
      Promise.all([
        callReadOnlyRole("code_scout",{system:"Code Scout. JSON only.",user:JSON.stringify({failure,evidence:localEvidence})},toolRuntime),
        callReadOnlyRole("causal_scout",{system:"Causal Scout. JSON only.",user:JSON.stringify({failure,evidence:localEvidence})},toolRuntime)
      ]),
      tgserver?tgserver.search(query):Promise.resolve([]),
      getOfficialEvidence(query),
    ]);
    const scoutJson=[roleOutput(scouts[0],"code_scout"),roleOutput(scouts[1],"causal_scout")];
    const official=evidenceResult.official,evidenceGap=evidenceResult.evidenceGap,evidenceStatus=evidenceResult.evidenceStatus;
    const research=await callReadOnlyRole("researcher",{system:"Researcher. Select decisive evidence. JSON only. If evidence_gap is true, do not treat official evidence as confirmed; local evidence remains available and must be evaluated on its own merits.",user:JSON.stringify({failure,localEvidence,scouts:scoutJson,knownKnowledge,official,evidence_gap:evidenceGap,evidence_status:evidenceStatus,evidence_gap_scope:"official_evidence_search"})},toolRuntime);
    const researchJson=roleOutput(research,"researcher");
    const diagnosis=await callReadOnlyRole("diagnoser",{system:"Diagnoser. Produce falsifiable diagnosis. JSON only. Preserve uncertainty about official evidence when evidence_gap is true, but do not discard supplied local evidence.",user:JSON.stringify({failure,localEvidence,research:researchJson,knownKnowledge,official,evidence_gap:evidenceGap,evidence_status:evidenceStatus,evidence_gap_scope:"official_evidence_search"})},toolRuntime);
    const diagnosisJson=roleOutput(diagnosis,"diagnoser");
    const localPublic=publicLocalEvidence(localEvidence);
    const hypothesis={privacy_class:"PUBLIC",sanitized:true,opaque_evidence:true,statement:pickDiagnosisStatement(diagnosisJson),cause_class:String(diagnosisJson?.cause_kind||"UNKNOWN"),evidence_count:localEvidence.length+knownKnowledge.length+official.length,local_evidence_count:localPublic.length,local_evidence:localPublic,evidence_gap:evidenceGap,evidence_status:evidenceStatus,evidence_gap_scope:evidenceGap?"official_evidence_search":null};
    let external=null;if(externalReview)external=await externalReview.hypothesis({privacy:{privacy_class:"PUBLIC",sanitized:true,opaque_evidence:true},hypothesis});
    const tool_audit={code_scout:toolAudit(scouts[0]),causal_scout:toolAudit(scouts[1]),researcher:toolAudit(research),diagnoser:toolAudit(diagnosis)};
    const result={run_id:runId,scouts:scoutJson,known_knowledge:knownKnowledge,official_evidence:official,evidence_gap:evidenceGap,evidence_status:evidenceStatus,research:researchJson,diagnosis:diagnosisJson,tool_audit,external_hypothesis_review:external,state:external?.json?.verdict==="PASS"?"HYPOTHESIS_APPROVED":"AWAITING_EXTERNAL_HYPOTHESIS_REVIEW"};
    runtimeEvidence?.write(runId,"analysis",result);
    await logRuntime({run_id:runId,severity:evidenceGap?"warn":"info",kind:"analysis",state:result.state,diagnosis:result.diagnosis,known_knowledge_count:knownKnowledge.length,official_evidence_count:official.length,evidence_gap:evidenceGap,evidence_status:evidenceStatus,tool_calls:Object.values(tool_audit).reduce((n,x)=>n+(x?.total_calls||0),0)});
    return result;
  }
  async function patchCandidate({runId,analysis,repo,selectedPaths,context,task}){
    const verdict=analysis?.external_hypothesis_review?.json?.verdict||analysis?.external_review?.verdict;
    if(verdict!=="PASS")throw new Error("PATCH_REQUIRES_EXTERNAL_HYPOTHESIS_REVIEW_PASS");
    const out=await aiCore.call("patch_engineer",{system:"Patch Engineer. Candidate only. Never apply. JSON only.",user:JSON.stringify({diagnosis:analysis.diagnosis,context,task})});
    const candidateResult=parseAndValidateRoleOutput("patch_engineer",out.content);const candidate=patchService?patchService.create({repo,selectedPaths,task,result:candidateResult}):candidateResult;
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
    const local_review=parseAndValidateRoleOutput("local_reviewer",lr.content);let final=null;if(externalReview)final=await externalReview.final({privacy:{privacy_class:"PUBLIC",sanitized:true,opaque_evidence:true},summary:{check_count:out.checks.length,invariants_pass:out.invariants.pass,local_verdict:local_review.verdict||"UNKNOWN"}});
    const complete=final?.json?.verdict==="PASS";if(authority&&complete)authority.transition(run,"COMPLETE");
    const state=complete?"COMPLETE":"AWAITING_EXTERNAL_FINAL_REVIEW";
    await logRuntime({run_id:runId,severity:complete?"info":"warn",kind:"final_review",state,local_verdict:local_review.verdict||"UNKNOWN",external_verdict:final?.json?.verdict||"PENDING"});
    return {run_id:runId,state,...out,local_review,external_final_review:final};
  }
  async function promote(asset){assertPromotable(asset);if(!tgserver)throw new Error("TGSERVER_ADAPTER_REQUIRED");return tgserver.promote(asset);}
  async function searchKnowledge(query,opts={}){if(!tgserver)throw new Error("TGSERVER_ADAPTER_REQUIRED");return tgserver.search(query,opts);}
  return {runAnalysis,patchCandidate,approveAndVerify,promote,searchKnowledge};
}
module.exports={createWorkflow,parseJson,roleOutput,toolAudit,pickDiagnosisStatement,publicLocalEvidence};
