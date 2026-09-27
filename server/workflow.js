"use strict";
const crypto=require("node:crypto");
const {assertPromotable}=require("./asset-promotion.js");
const {createReadOnlyToolRuntime,assertToolResultIntegrity}=require("./control/read-only-tool-runtime.js");
const {runRoleWithReadOnlyTools,mergeEvidenceIds}=require("./control/tool-loop.js");
const {parseAndValidateRoleOutput}=require("./control/role-output-validator.js");
const {getRoleRuntimeBudget}=require("./control/role-runtime-budgets.js");
const {registerEvidenceList,evidenceIds,registrySummary}=require("./control/evidence-registry.js");

function parseJson(c){if(typeof c!=="string")return c;return JSON.parse(c.trim().replace(/^```json\s*/i,"").replace(/```$/i,"").trim());}
function roleOutput(call,role){if(call?.validated_output&&typeof call.validated_output==="object")return call.validated_output;return parseAndValidateRoleOutput(role,call?.content,{availableEvidenceIds:call?.tool_loop?.evidence_ids||[]});}
function toolEvidenceRecords(call){
  const out=[],seen=new Set();
  for(const observation of call?.tool_loop?.observations||[])for(const item of observation.results||[]){const result=item?.result;if(result?.status!=="OK")continue;assertToolResultIntegrity(result);if(seen.has(result.evidence_id))continue;seen.add(result.evidence_id);out.push({evidence_id:result.evidence_id,tool:result.tool,data:result.data,integrity:result.integrity});}
  return out;
}
function toolAudit(call){const loop=call?.tool_loop;if(!loop)return null;const tools=[];for(const observation of loop.observations||[])for(const item of observation.results||[]){const tool=item?.request?.tool;if(tool&&!tools.includes(tool))tools.push(tool);}return {rounds:Number(loop.rounds||0),total_calls:Number(loop.total_calls||0),evidence_ids:[...(loop.evidence_ids||[])],base_evidence_ids:[...(loop.base_evidence_ids||[])],tool_evidence_ids:[...(loop.tool_evidence_ids||[])],selected_skill_ids:[...(loop.selected_skill_ids||[])],tools,progress:loop.progress||null};}
function pickDiagnosisStatement(diagnosisJson){if(diagnosisJson?.public_statement)return String(diagnosisJson.public_statement);if(diagnosisJson?.hypothesis)return String(diagnosisJson.hypothesis);if(Array.isArray(diagnosisJson?.diagnoses)&&diagnosisJson.diagnoses[0]?.hypothesis)return String(diagnosisJson.diagnoses[0].hypothesis);return "behavioral mismatch";}
function publicLocalEvidence(localEvidence){return (Array.isArray(localEvidence)?localEvidence:[]).map((item,index)=>({id:String(item?.id||`L${String(index+1).padStart(3,"0")}`),kind:String(item?.kind||"local"),observation:String(item?.observation||item?.summary||"")})).filter(item=>item.observation);}
function dapFailureChecks(failure,deterministicChecks){
  const checks=Array.isArray(deterministicChecks)?deterministicChecks:[];
  if(checks.some(item=>String(item?.status||"").toUpperCase()==="FAIL"))return checks;
  if(!failure||typeof failure!=="object")return checks;
  return [{status:"FAIL",check_type:String(failure.check_type||failure.kind||failure.type||"runtime"),name:String(failure.name||"reported failure"),reason:String(failure.message||failure.summary||failure.reason||""),stderr:String(failure.stderr||""),stdout:String(failure.stdout||"")}];
}
function activeDapHint(evidence){return evidence&&evidence.authority==="HINT_ONLY"&&evidence.local_only===true&&evidence.status!=="NOT_CONFIGURED"?evidence:null;}
function dapHintProtocol(hint){return hint?"DAP_HINT_AUTHORITY=HINT_ONLY. The dap_hint object is local runtime diagnostic data, not registered claim evidence. Never cite dap_hint as FACT, INFERENCE, or REJECTED evidence. Use it only to form/falsify hypotheses or to decide which registered evidence to gather next.":"";}
function createWorkflow({aiCore,externalReview=null,evidenceSearch=null,runtimeEvidence=null,tgserver=null,patchService=null,authority=null,repoPolicy=null,sandboxVerification=null,dapEvidence=null}={}){
  if(!aiCore)throw new Error("AI_CORE_ADAPTER_REQUIRED");
  async function logRuntime(event){if(tgserver)await tgserver.log(event);}
  function makeReadOnlyToolRuntime(repoPath){if(!repoPolicy||!repoPath)return null;return createReadOnlyToolRuntime({repo:repoPath,repoPolicy,tgserver,evidenceSearch});}
  async function callReadOnlyRole(role,{system,user},toolRuntime,{baseEvidenceIds=[],strictEvidenceRefs=true}={}){return runRoleWithReadOnlyTools({aiCore,role,system,user,toolRuntime,baseEvidenceIds,strictEvidenceRefs});}
  async function callDirectRole(role,{system,user}){const b=getRoleRuntimeBudget(role);return aiCore.call(role,{system,user,maxTokens:b.max_tokens,timeoutMsOverride:b.turn_timeout_ms,deadlineAt:Date.now()+b.turn_timeout_ms});}
  async function getOfficialEvidence(query){if(!evidenceSearch)return{official:[],evidenceGap:false,evidenceStatus:"NOT_CONFIGURED"};try{return{official:await evidenceSearch.search({query}),evidenceGap:false,evidenceStatus:"FINAL_VALID"};}catch(e){if(e?.code==="EVIDENCE_SEARCH_NOT_FINAL")return{official:[],evidenceGap:true,evidenceStatus:String(e?.meta?.status||"NOT_FINAL")};throw e;}}
  async function runAnalysis({runId=null,rawRequest="",failure,localEvidence=[],repo=null,projectId=null}={}){
    let authRun=null;
    if(authority){authRun=authority.start({rawRequest,repo,projectId});runId=authRun.run_id;authority.transition(authRun,"PARSED");authority.transition(authRun,"CONTEXT_READY");authority.transition(authRun,"VERIFYING");authority.transition(authRun,"FAILED");authority.transition(authRun,"RESOLVING");}
    runId=runId||crypto.randomUUID();const targetRepo=authRun?.project_dir||(repoPolicy&&repo?repoPolicy.assertRepo(repo):null),toolRuntime=makeReadOnlyToolRuntime(targetRepo);
    const deterministicVerification=sandboxVerification&&targetRepo?await sandboxVerification.collect(targetRepo):{status:"NOT_CONFIGURED",checks:[]};
    const deterministicChecks=Array.isArray(deterministicVerification?.checks)?deterministicVerification.checks:[];
    if(deterministicChecks.length)runtimeEvidence?.write(runId,"deterministic_verification",{status:deterministicVerification.status,checks:deterministicChecks});
    let dapHint=null;
    if(dapEvidence&&targetRepo){
      const candidate=await dapEvidence.collect({repo:targetRepo,checks:dapFailureChecks(failure,deterministicChecks),task:String(rawRequest||failure?.message||failure?.summary||""),variableNames:Array.isArray(failure?.variable_names)?failure.variable_names:[]});
      dapHint=activeDapHint(candidate);
      if(dapHint){
        runtimeEvidence?.write(runId,"dap_hint",dapHint);
        await logRuntime({run_id:runId,severity:dapHint.status==="PASS"?"info":"warn",kind:"dap_hint",authority:"HINT_ONLY",local_only:true,status:dapHint.status,reason:dapHint.reason,target:dapHint.target||null});
      }
    }
    const hintProtocol=dapHintProtocol(dapHint);
    const localRecords=registerEvidenceList("LOCAL_RUNTIME",[...(Array.isArray(localEvidence)?localEvidence:[]),...deterministicChecks]),localIds=evidenceIds(localRecords);
    runtimeEvidence?.write(runId,"failure",failure);await logRuntime({run_id:runId,severity:"error",kind:"failure",failure});
    if(deterministicChecks.length)await logRuntime({run_id:runId,severity:deterministicChecks.some(x=>x.status==="FAIL")?"warn":"info",kind:"deterministic_verification",status:deterministicVerification.status,check_count:deterministicChecks.length,failed:deterministicChecks.filter(x=>x.status==="FAIL").length});
    const query=String(failure?.message||failure?.summary||"debug failure");
    const [scouts,knownKnowledge,evidenceResult]=await Promise.all([
      Promise.all([
        callReadOnlyRole("code_scout",{system:["Code Scout. JSON only.",hintProtocol].filter(Boolean).join("\n"),user:JSON.stringify({failure,evidence:localRecords,dap_hint:dapHint})},toolRuntime,{baseEvidenceIds:localIds}),
        callReadOnlyRole("causal_scout",{system:["Causal Scout. JSON only.",hintProtocol].filter(Boolean).join("\n"),user:JSON.stringify({failure,evidence:localRecords,dap_hint:dapHint})},toolRuntime,{baseEvidenceIds:localIds})
      ]),
      tgserver?tgserver.search(query):Promise.resolve([]),getOfficialEvidence(query)
    ]);
    const scoutJson=[roleOutput(scouts[0],"code_scout"),roleOutput(scouts[1],"causal_scout")],scoutToolEvidence=[...toolEvidenceRecords(scouts[0]),...toolEvidenceRecords(scouts[1])];
    const official=evidenceResult.official,evidenceGap=evidenceResult.evidenceGap,evidenceStatus=evidenceResult.evidenceStatus;
    const knowledgeRecords=registerEvidenceList("INTERNAL_KB",knownKnowledge),officialRecords=registerEvidenceList("OFFICIAL_EXTERNAL",official);
    const researchBase=mergeEvidenceIds(localIds,evidenceIds(knowledgeRecords),evidenceIds(officialRecords),scoutToolEvidence.map(x=>x.evidence_id));
    const research=await callReadOnlyRole("researcher",{system:["Researcher. Select decisive evidence. JSON only. If evidence_gap is true, do not treat official evidence as confirmed; local evidence remains available and must be evaluated on its own merits.",hintProtocol].filter(Boolean).join("\n"),user:JSON.stringify({failure,localEvidence:localRecords,dap_hint:dapHint,scouts:scoutJson,scout_tool_evidence:scoutToolEvidence,knownKnowledge:knowledgeRecords,official:officialRecords,evidence_gap:evidenceGap,evidence_status:evidenceStatus,evidence_gap_scope:"official_evidence_search"})},toolRuntime,{baseEvidenceIds:researchBase});
    const researchJson=roleOutput(research,"researcher"),researchToolEvidence=toolEvidenceRecords(research);
    const diagnosisBase=mergeEvidenceIds(researchBase,researchToolEvidence.map(x=>x.evidence_id));
    const diagnosis=await callReadOnlyRole("diagnoser",{system:["Diagnoser. Produce falsifiable diagnosis. JSON only. Preserve uncertainty about official evidence when evidence_gap is true, but do not discard supplied local evidence.",hintProtocol].filter(Boolean).join("\n"),user:JSON.stringify({failure,localEvidence:localRecords,dap_hint:dapHint,research:researchJson,research_tool_evidence:researchToolEvidence,knownKnowledge:knowledgeRecords,official:officialRecords,evidence_gap:evidenceGap,evidence_status:evidenceStatus,evidence_gap_scope:"official_evidence_search"})},toolRuntime,{baseEvidenceIds:diagnosisBase});
    const diagnosisJson=roleOutput(diagnosis,"diagnoser"),diagnosisToolEvidence=toolEvidenceRecords(diagnosis),localPublic=publicLocalEvidence(localEvidence);
    const hypothesis={privacy_class:"PUBLIC",sanitized:true,opaque_evidence:true,statement:pickDiagnosisStatement(diagnosisJson),cause_class:String(diagnosisJson?.cause_kind||"UNKNOWN"),evidence_count:localEvidence.length+deterministicChecks.length+knownKnowledge.length+official.length,local_evidence_count:localPublic.length,local_evidence:localPublic,evidence_gap:evidenceGap,evidence_status:evidenceStatus,evidence_gap_scope:evidenceGap?"official_evidence_search":null};
    let external=null;if(externalReview)external=await externalReview.hypothesis({privacy:{privacy_class:"PUBLIC",sanitized:true,opaque_evidence:true},hypothesis});
    const tool_audit={code_scout:toolAudit(scouts[0]),causal_scout:toolAudit(scouts[1]),researcher:toolAudit(research),diagnoser:toolAudit(diagnosis)};
    const evidence_registry=registrySummary({local:localRecords,knowledge:knowledgeRecords,official:officialRecords});
    evidence_registry.tool_evidence_ids=mergeEvidenceIds(scoutToolEvidence.map(x=>x.evidence_id),researchToolEvidence.map(x=>x.evidence_id),diagnosisToolEvidence.map(x=>x.evidence_id));
    evidence_registry.total_with_tools=evidence_registry.total+evidence_registry.tool_evidence_ids.length;
    const result={run_id:runId,deterministic_verification:{status:deterministicVerification.status,checks:deterministicChecks},dap_hint:dapHint,scouts:scoutJson,known_knowledge:knownKnowledge,official_evidence:official,evidence_gap:evidenceGap,evidence_status:evidenceStatus,evidence_registry,research:researchJson,diagnosis:diagnosisJson,tool_audit,external_hypothesis_review:external,state:external?.json?.verdict==="PASS"?"HYPOTHESIS_APPROVED":"AWAITING_EXTERNAL_HYPOTHESIS_REVIEW"};
    runtimeEvidence?.write(runId,"analysis",result);await logRuntime({run_id:runId,severity:evidenceGap?"warn":"info",kind:"analysis",state:result.state,diagnosis:result.diagnosis,known_knowledge_count:knownKnowledge.length,official_evidence_count:official.length,evidence_registry_total:evidence_registry.total_with_tools,dap_hint_status:dapHint?.status||"NOT_CONFIGURED",evidence_gap:evidenceGap,evidence_status:evidenceStatus,deterministic_check_count:deterministicChecks.length,tool_calls:Object.values(tool_audit).reduce((n,x)=>n+(x?.total_calls||0),0)});return result;
  }
  async function patchCandidate({runId,analysis,repo,selectedPaths,context,task}){
    const verdict=analysis?.external_hypothesis_review?.json?.verdict||analysis?.external_review?.verdict;if(verdict!=="PASS")throw new Error("PATCH_REQUIRES_EXTERNAL_HYPOTHESIS_REVIEW_PASS");
    const out=await callDirectRole("patch_engineer",{system:"Patch Engineer. Candidate only. Never apply. JSON only.",user:JSON.stringify({diagnosis:analysis.diagnosis,context,task})});
    const candidateResult=parseAndValidateRoleOutput("patch_engineer",out.content);const candidate=patchService?patchService.create({repo,selectedPaths,task,result:candidateResult}):candidateResult;
    if(authority){let run=authority.load(runId);run=authority.transition(run,"PATCH_READY");authority.transition(run,"WAITING_APPROVAL");}
    runtimeEvidence?.write(runId,"patch_candidate",{id:candidate.id,diff_hash:candidate.diff_hash,summary:candidate.summary});await logRuntime({run_id:runId,severity:"info",kind:"patch_candidate",candidate_id:candidate.id,diff_hash:candidate.diff_hash,summary:candidate.summary,state:"WAITING_MASTER_APPROVAL"});return {run_id:runId,state:"WAITING_MASTER_APPROVAL",candidate};
  }
  async function approveAndVerify({runId,candidateId,candidateHash,decision,repo}){
    if(!patchService)throw new Error("PATCH_SERVICE_REQUIRED");let run=null;if(authority)run=authority.load(runId);if(decision!=="approve"){if(authority)authority.transition(run,"BLOCKED");throw new Error("PATCH_APPROVAL_REQUIRED");}if(authority)run=authority.transition(run,"APPLYING");
    let out;try{out=patchService.apply({candidateId,candidateHash,decision,repo});}catch(e){if(authority){try{authority.transition(run,"BLOCKED");}catch{}}throw e;}if(authority)run=authority.transition(run,"RETESTING");
    runtimeEvidence?.write(runId,"verification",{checks:out.checks,invariants:out.invariants,gates:out.gates,pass:out.pass});await logRuntime({run_id:runId,severity:out.pass?"info":"error",kind:"verification",pass:out.pass,checks:out.checks,invariants:out.invariants,gates:out.gates});if(!out.pass){if(authority)authority.transition(run,"FAILED");return {run_id:runId,state:"FAILED_RETEST",...out};}
    const verificationRecords=registerEvidenceList("LOCAL_RUNTIME",[...(out.checks||[]),{kind:"invariants",value:out.invariants},{kind:"gates",value:out.gates}]),verificationIds=evidenceIds(verificationRecords);
    const lr=await runRoleWithReadOnlyTools({aiCore,role:"local_reviewer",system:"Local Reviewer. Review deterministic results from fresh context. JSON only.",user:JSON.stringify({verification_evidence:verificationRecords}),toolRuntime:null,baseEvidenceIds:verificationIds,strictEvidenceRefs:true});
    const local_review=roleOutput(lr,"local_reviewer");let final=null;if(externalReview)final=await externalReview.final({privacy:{privacy_class:"PUBLIC",sanitized:true,opaque_evidence:true},summary:{check_count:out.checks.length,invariants_pass:out.invariants.pass,local_verdict:local_review.verdict||"UNKNOWN"}});
    const complete=final?.json?.verdict==="PASS";if(authority&&complete)authority.transition(run,"COMPLETE");const state=complete?"COMPLETE":"AWAITING_EXTERNAL_FINAL_REVIEW";await logRuntime({run_id:runId,severity:complete?"info":"warn",kind:"final_review",state,local_verdict:local_review.verdict||"UNKNOWN",external_verdict:final?.json?.verdict||"PENDING"});return {run_id:runId,state,...out,local_review,external_final_review:final};
  }
  async function promote(asset){assertPromotable(asset);if(!tgserver)throw new Error("TGSERVER_ADAPTER_REQUIRED");return tgserver.promote(asset);}
  async function searchKnowledge(query,opts={}){if(!tgserver)throw new Error("TGSERVER_ADAPTER_REQUIRED");return tgserver.search(query,opts);}
  return {runAnalysis,patchCandidate,approveAndVerify,promote,searchKnowledge};
}
module.exports={createWorkflow,parseJson,roleOutput,toolEvidenceRecords,toolAudit,pickDiagnosisStatement,publicLocalEvidence,dapFailureChecks,activeDapHint,dapHintProtocol};
