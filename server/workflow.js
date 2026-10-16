"use strict";
const crypto=require("node:crypto");
const path=require("node:path");
const {contentHash,WorkflowStepId,StepPhase}=require("../orchestrator/durable-contracts.js");
const {buildDownstreamInputBundle}=require("../orchestrator/role-result.js");
const {assertPromotable}=require("./asset-promotion.js");
const {initialInvestigationEvidence,createReadOnlyToolRuntime,assertToolResultIntegrity,evidenceProjection,readText,testInventory,blockedReadPath}=require("./control/read-only-tool-runtime.js");
const {runRoleWithReadOnlyTools,mergeEvidenceIds}=require("./control/tool-loop.js");
const {parseAndValidateRoleOutput,createRoleProgressEvaluator}=require("./control/role-output-validator.js");
const {getRoleRuntimeBudget}=require("./control/role-runtime-budgets.js");
const {registerEvidenceList,evidenceIds,registrySummary}=require("./control/evidence-registry.js");
const {runResearcherContinuation}=require("./control/researcher-continuation.js");
const {continueDiagnoserWorkItem}=require("./control/diagnoser-work-item-adapter.js");
const {continueRoleWorkItem,ROLES:CONTINUABLE_ROLES}=require("./control/role-work-item-adapter.js");
const {validateEvidenceRecords,mergeBaseEvidenceWithRecords}=require("./control/role-work-item-evidence.js");
const {isRoleWorkItemPending,makeRoleWorkItemContinuePending}=require("./control/role-work-item/pending.js");
const {continueCodeScoutWorkItem}=require("./control/role-work-item/adapters/code-scout-work-item-adapter.js");
const {continueCausalScoutWorkItem}=require("./control/role-work-item/adapters/causal-scout-work-item-adapter.js");
const {continueResearcherWorkItem}=require("./control/role-work-item/adapters/researcher-work-item-adapter.js");
const {continuePatchEngineerWorkItem}=require("./control/role-work-item/adapters/patch-engineer-work-item-adapter.js");
const {continueLocalReviewerWorkItem}=require("./control/role-work-item/adapters/local-reviewer-work-item-adapter.js");
const ROLE_WORK_ITEM_ADAPTERS=Object.freeze({code_scout:continueCodeScoutWorkItem,causal_scout:continueCausalScoutWorkItem,researcher:continueResearcherWorkItem,patch_engineer:continuePatchEngineerWorkItem,local_reviewer:continueLocalReviewerWorkItem});
const {createDurableToolEffectHooks,toolResultPath,TOOL_CONTRACT_VERSION}=require("./control/durable-tool-effects.js");
const {ROLE_CONTRACT_VERSION}=require("./control/role-contracts.js");
const {makeDurableAnalysisInput,loadDurableAnalysisInput}=require("./control/durable-workflow-input.js");
const {makeDurableWorkflowStage,loadDurableWorkflowStage,localStageBinding,reusableLocalStage}=require("./control/durable-workflow-stage.js");
const {buildCompletionGateInput,evaluateCompletionGate}=require("./control/completion-gate.js");
const {makePatchPacket,makeReviewPacket,publicReviewPacketSummary,assertPatchRequirements}=require("./control/runtime-packets.js");
const {scrub}=require("./runtime-evidence.js");
const {observeAiCalls,observeToolCalls}=require("./control/run-observation-context.js");
const {repositorySnapshotId}=require("./control/repository-snapshot.js");
const {runInvestigationBenchmarkCase,listCases:listInvestigationBenchmarkCases}=require("./control/investigation-benchmark-suite.js");
const {runModelAbBenchmark,qualifyVariantForRuntime}=require("./control/model-ab-benchmark.js");
const CAUSAL_SCOUT_OUTPUT_POLICY="Causal Scout. Return JSON only. Final output requires a top-level claims array. Every claims[] item requires type and statement. Causal candidates must use type HYPOTHESIS and a concrete falsification_condition; cite only registered evidence_refs when available. A falsification condition must name an observation that contradicts the hypothesis, rather than one that supports it. Keep proposed observations within existing read-only tools and security restrictions; never propose relaxing seccomp or other safety controls. Use type UNKNOWN for unresolved evidence gaps instead of inventing a cause, and retain rejected hypotheses with their counter_evidence_refs. An empty claims array is valid when no supported candidate or material unknown remains. Never emit confirmed_root_cause or patch/apply/deploy operations. Tool-request rounds use the existing tool_requests protocol; the claims requirement applies to final output.";

const MAX_AUTOMATIC_REFIX_ATTEMPTS=2;

function parseJson(c){if(typeof c!=="string")return c;return JSON.parse(c.trim().replace(/^```json\s*/i,"").replace(/```$/i,"").trim());}
function roleOutput(call,role){if(call?.validated_output&&typeof call.validated_output==="object")return call.validated_output;return parseAndValidateRoleOutput(role,call?.content,{availableEvidenceIds:call?.tool_loop?.evidence_ids||[]});}
function toolEvidenceRecords(call){
  const out=[],seen=new Set();
  for(const observation of call?.tool_loop?.observations||[])for(const item of observation.results||[]){const result=item?.result;if(result?.status!=="OK")continue;assertToolResultIntegrity(result);if(seen.has(result.evidence_id))continue;seen.add(result.evidence_id);out.push({evidence_id:result.evidence_id,tool:result.tool,data:result.data,integrity:result.integrity});}
  return out;
}
function toolAudit(call){const loop=call?.tool_loop;if(!loop)return null;const tools=[];for(const observation of loop.observations||[])for(const item of observation.results||[]){const tool=item?.request?.tool;if(tool&&!tools.includes(tool))tools.push(tool);}return {rounds:Number(loop.rounds||0),total_calls:Number(loop.total_calls||0),evidence_ids:[...(loop.evidence_ids||[])],base_evidence_ids:[...(loop.base_evidence_ids||[])],tool_evidence_ids:[...(loop.tool_evidence_ids||[])],selected_skill_ids:[...(loop.selected_skill_ids||[])],tools,progress:loop.progress||null};}
function pickDiagnosisStatement(diagnosisJson){if(diagnosisJson?.public_statement)return String(diagnosisJson.public_statement);if(diagnosisJson?.hypothesis)return String(diagnosisJson.hypothesis);if(Array.isArray(diagnosisJson?.hypotheses)&&diagnosisJson.hypotheses[0]){const first=diagnosisJson.hypotheses.find(h=>h?.status==="HYPOTHESIS")||diagnosisJson.hypotheses[0];if(first.statement)return String(first.statement);if(first.hypothesis)return String(first.hypothesis);if(first.id)return null;}if(Array.isArray(diagnosisJson?.diagnoses)&&diagnosisJson.diagnoses[0]?.hypothesis)return String(diagnosisJson.diagnoses[0].hypothesis);return "behavioral mismatch";}
function reviewableHypothesisStatement(diagnosisJson){const status=diagnosisJson?.diagnosis_status,active=Array.isArray(diagnosisJson?.hypotheses)?diagnosisJson.hypotheses.find(h=>h?.status==="HYPOTHESIS"):null;const reject=code=>{const error=new Error(code);error.code=code;throw error;};if(status==="INSUFFICIENT_EVIDENCE"||status==="NO_ACTIVE_HYPOTHESIS"||(status==="HYPOTHESES_RETAINED"&&!active))reject("HYPOTHESIS_REVIEW_NO_ACTIVE_HYPOTHESIS");const statement=active?(typeof active.statement==="string"&&active.statement.trim()?active.statement:typeof active.hypothesis==="string"&&active.hypothesis.trim()?active.hypothesis:null):pickDiagnosisStatement(diagnosisJson);if(active&&(!statement||statement.trim()===String(active.id||"").trim()))reject("HYPOTHESIS_REVIEW_STATEMENT_MISSING");return statement;}
function publicLocalEvidence(localEvidence){return (Array.isArray(localEvidence)?localEvidence:[]).map((item,index)=>({id:String(item?.id||`L${String(index+1).padStart(3,"0")}`),kind:String(item?.kind||"local"),observation:String(item?.observation||item?.summary||"")})).filter(item=>item.observation);}
function dapFailureChecks(failure,deterministicChecks){
  const checks=Array.isArray(deterministicChecks)?deterministicChecks:[];
  if(checks.some(item=>String(item?.status||"").toUpperCase()==="FAIL"))return checks;
  if(!failure||typeof failure!=="object")return checks;
  return [{status:"FAIL",check_type:String(failure.check_type||failure.kind||failure.type||"runtime"),name:String(failure.name||"reported failure"),reason:String(failure.message||failure.summary||failure.reason||""),stderr:String(failure.stderr||""),stdout:String(failure.stdout||"")}];
}
function activeDapHint(evidence){return evidence&&evidence.authority==="HINT_ONLY"&&evidence.local_only===true&&evidence.status!=="NOT_CONFIGURED"?evidence:null;}
function dapHintProtocol(hint){return hint?"DAP_HINT_AUTHORITY=HINT_ONLY. The dap_hint object is local runtime diagnostic data, not registered claim evidence. Never cite dap_hint as FACT, INFERENCE, or REJECTED evidence. Use it only to form/falsify hypotheses or to decide which registered evidence to gather next.":"";}
function reviewStreamEvidence(value,{includeExcerpt=false,maxExcerptChars=1200}={}){
  const text=String(value||"");
  return {bytes:Buffer.byteLength(text,"utf8"),sha256:crypto.createHash("sha256").update(text).digest("hex"),excerpt:includeExcerpt?text.slice(-maxExcerptChars):null};
}
function reviewableVerificationCheck(check){
  const item=check&&typeof check==="object"?check:{};const status=String(item.status||"").toUpperCase(),includeExcerpt=status!=="PASS";
  return {...item,stdout:reviewStreamEvidence(item.stdout,{includeExcerpt}),stderr:reviewStreamEvidence(item.stderr,{includeExcerpt})};
}
function causalEvidencePromptView(records){return records.map(record=>JSON.stringify(record.payload).length>1400?evidenceProjection(record,{maxChars:700}):evidencePromptView([record])[0]);}
function evidencePromptView(records){return (Array.isArray(records)?records:[]).map(record=>{if(!record||typeof record!=="object")return record;const {integrity,...view}=record;return view;});}
function patchPacketSource(repo,selectedPaths){
  const sourceExcerpts=[],preconditionHashes={},prohibitedPaths=[];
  for(const value of Array.isArray(selectedPaths)?selectedPaths:[]){
    const rel=String(value||"");
    let prohibited=false;try{prohibited=blockedReadPath(rel);}catch{prohibited=true;}
    if(prohibited){prohibitedPaths.push(rel);continue;}
    try{const item=readText(repo,rel,{maxChars:8000});sourceExcerpts.push({path:item.path,sha256:item.sha256,size:item.size,excerpt:item.content,truncated:item.truncated});preconditionHashes[item.path]=item.sha256;}
    catch(error){if(!String(error?.message||error).startsWith("READ_FILE_NOT_FOUND:"))throw error;sourceExcerpts.push({path:rel,exists:false,excerpt:""});}
  }
  return{sourceExcerpts,preconditionHashes,prohibitedPaths};
}
function patchPacketEvidenceRefs(analysis){return mergeEvidenceIds(analysis?.evidence_registry?.evidence_ids||[],analysis?.evidence_registry?.tool_evidence_ids||[]);}
function reviewPacketHashes(candidate,receipt){
  const out={};
  for(const pre of candidate?.preconditions||[])out[pre.path]={before:pre.sha256||null,after:null};
  for(const file of receipt?.files||[])out[file.path]={before:out[file.path]?.before||null,after:file.sha256||null};
  return out;
}
function reviewPacketInvariants(result){
  const out=[{name:"patch-invariants",status:result?.invariants?.pass===true?"PASS":"FAIL",failures:[...(result?.invariants?.failures||[])]}];
  for(const [name,gate] of Object.entries(result?.gates||{}))out.push({name,status:String(gate?.status||"UNKNOWN").toUpperCase()});
  return out;
}
function createWorkflow({aiCore,externalReview=null,evidenceSearch=null,runtimeEvidence=null,tgserver=null,patchService=null,authority=null,repoPolicy=null,sandboxVerification=null,dapEvidence=null,serverCommand=null,recoveryHooks=null,repositorySnapshot=repositorySnapshotId}={}){
  if(!aiCore)throw new Error("AI_CORE_ADAPTER_REQUIRED");
  const activeRuns=new Map(),backgroundErrors=new Map(),activeCodegenBenchmarks=new Map(),activeInvestigationBenchmarks=new Map(),activeModelAbBenchmarks=new Map();
  const retryTimers=new Map(),MAX_AUTONOMOUS_RETRIES=2,RETRY_DELAY_MS=30000;
  async function logRuntime(event){if(tgserver)await tgserver.log(event);}
  function snapshotRepo(repoPath){const approved=repoPolicy?repoPolicy.assertRepo(repoPath):repoPath;return repositorySnapshot(approved,{allowMissingGitMarker:Boolean(repoPolicy)});}
  async function logProgress(runId,step,phase){
    const event={step:String(step),phase:String(phase)};
    runtimeEvidence?.write(runId,"workflow_progress",event);
    await logRuntime({run_id:runId,severity:"info",kind:"workflow_progress",...event});
  }
  function makeReadOnlyToolRuntime(repoPath,runId=null){
    if(!repoPolicy||!repoPath)return null;
    return createReadOnlyToolRuntime({repo:repoPath,repoPolicy,tgserver,evidenceSearch,serverCommand,onServerCommandEvent:async event=>{
      if(!runId)throw new Error("SERVER_COMMAND_RUN_ID_REQUIRED");
      const payload={...event};
      runtimeEvidence?.write(runId,"server_command",payload);
      await logRuntime({run_id:runId,severity:payload.status==="FAIL"?"error":"info",kind:"server_command",...payload});
    }});
  }
  async function callReadOnlyRole(role,{system,user},toolRuntime,{baseEvidenceIds=[],registeredEvidence=[],strictEvidenceRefs=true,continuationState=null,durableHooks=null,runId=null}={}){
    const adapter=runId?observeAiCalls({aiCore,runId,runtimeEvidence,onEvent:logRuntime}):aiCore;
    const semantic=recoveryHooks?.semanticToolCriteria?.[role];
    const progressQualification=semantic?createRoleProgressEvaluator({...semantic,role}).toolQualification:null;
    return runRoleWithReadOnlyTools({aiCore:adapter,role,system,user,toolRuntime:runId?observeToolCalls({toolRuntime,runId,runtimeEvidence,onEvent:logRuntime}):toolRuntime,baseEvidenceIds,registeredEvidence,strictEvidenceRefs,continuationState,durableHooks,progressQualification});
  }
  // Opt-in bounded same-item continuation through the EXISTING Diagnoser model.
  // Kept separate from legacy analysis until live E2E acceptance is proven.
  // Six independent role consumers, all using the ONE continuation module.
  // Explicit opt-in until the legacy full workflow passes live semantic acceptance.
  function registeredEvidenceUserPayload({task,step,previousProgress,evidence,validatedRecords}){
    const views=evidencePromptView(validatedRecords);
    return JSON.stringify({task,step,previous_progress:previousProgress,registered_evidence_ids:evidence,registered_evidence:views,evidence:views});
  }
  function assertHorizontalStageComplete(role,stage){
    if(stage.status==="CONTINUE")throw makeRoleWorkItemContinuePending(role);
    if(stage.status!=="COMPLETE")throw new Error(`${String(role).toUpperCase()}_WORK_ITEM_BLOCKED:`+String(stage.reason||"UNKNOWN"));
    return stage.result;
  }
  async function continueRoleTask({runId,role,workItemId,inputBinding,task,baseEvidenceIds=[],
    evidenceRecords=[],semanticCriteria=null,requireSemanticProgress=false,maxStepsPerCall=1,maxTotalSteps=12,signal=null}={}){
    if(!CONTINUABLE_ROLES.includes(role))throw new Error("ROLE_NOT_ALLOWED");
    if(!authority?.durableEnabled?.())throw new Error("ROLE_DURABLE_AUTHORITY_REQUIRED");
    if(typeof task!=="string"||!task.trim())throw new Error("ROLE_TASK_REQUIRED");
    if(!Array.isArray(baseEvidenceIds)||!baseEvidenceIds.every(x=>typeof x==="string"))
      throw new Error("ROLE_EVIDENCE_IDS_INVALID");
    authority.loadDurable(runId);
    const validatedRecords=validateEvidenceRecords(evidenceRecords);
    const evidence=mergeBaseEvidenceWithRecords(baseEvidenceIds,validatedRecords);
    const criteria=semanticCriteria??recoveryHooks?.semanticCriteria?.[workItemId]??null;
    const semanticRequired=requireSemanticProgress||recoveryHooks?.requireSemanticProgress===true;
    if(semanticRequired&&criteria===null)throw new Error("ROLE_PROGRESS_CRITERIA_REQUIRED");
    const evaluator=criteria===null?null:createRoleProgressEvaluator({role,criteria,evidenceRecords:validatedRecords});
    const boundTask=contentHash({role,task,evidence,input_binding:inputBinding,...(aiCore.runtime_route_binding?{core_route_binding:aiCore.runtime_route_binding}:{}),...(evaluator?{semantic_contract:evaluator.binding}:{})});
    function validateIntermediate({progress,previousProgress,ctx}){
      if(evaluator){try{return contentHash(evaluator.qualifyProgress({progress,previousProgress:previousProgress||ctx?.previousProgress||{}}))===contentHash(progress);}catch{return false;}}
      return Boolean(progress&&typeof progress==="object"&&!Array.isArray(progress)&&
        Array.isArray(progress.evidence_refs)&&progress.evidence_refs.every(id=>typeof id==="string"&&evidence.includes(id))&&
        typeof progress.remaining_work==="string"&&progress.remaining_work.trim());
    }
    const continueViaRole=ROLE_WORK_ITEM_ADAPTERS[role]||continueRoleWorkItem;
    return continueViaRole({authority,runId,role,workItemId,inputBinding:boundTask,maxStepsPerCall,maxTotalSteps,signal,
      buildStepPrompt:async({step,previousProgress})=>({
        // Keep fixed task/evidence/criteria ahead of changing step/progress for
        // backend prefix reuse. Cache is never a semantic completion authority.
        system:(evaluator?"CONTINUE requires progress.verified_work [{criterion_id,evidence_refs}] and progress.remaining_work [unmet criterion IDs]. COMPLETE requires result.verified_work for ALL fixed criteria and a canonical role result inferred from evidence. COMPLETE result.verified_work must be an array of {criterion_id,evidence_refs} objects, exactly like progress.verified_work; retain every already verified marker with its associated Evidence references inside result. Do not replace markers with criterion ID strings or put them outside result. ":"")+`Role: ${role}. Continue ONLY the same assigned work item using a bounded JSON response. status=CONTINUE requires progress.evidence_refs and progress.remaining_work. status=COMPLETE requires the original role's full canonical output under result. status=BLOCKED requires reason. Do not invent evidence; preserve role-specific permissions. No tool execution or mutation in this opt-in interface.${role==="diagnoser"?" For each active HYPOTHESIS, include a concrete cause statement and falsification_condition grounded in supplied evidence; do not return only an opaque ID. If unavailable, explicitly report INSUFFICIENT_EVIDENCE instead of fabricating causality.":""}`,
        user:evaluator?JSON.stringify({task,registered_evidence_ids:evidence,registered_evidence:evidencePromptView(validatedRecords),criteria:evaluator.criteria.map(({id,kind,evidence_id,source_ref})=>({id,kind,evidence_id,source_ref})),step,previous_progress:{verified_work:previousProgress.verified_work||[],remaining_work:previousProgress.remaining_work||evaluator.criteria.map(c=>c.id),evidence_refs:previousProgress.evidence_refs||[]}}):registeredEvidenceUserPayload({task,step,previousProgress,evidence,validatedRecords})
      }),
      invokeRole:async(prompt,ctx)=>{
        const output=parseJson((await callDirectRole(role,prompt,runId,{signal})).content);
        if(evaluator&&output.status==="CONTINUE")output.progress=evaluator.qualifyProgress({progress:output.progress,previousProgress:ctx.previousProgress});
        if(evaluator&&output.status==="COMPLETE")output.result=evaluator.restoreCompletionMarkers({result:output.result,previousProgress:ctx.previousProgress});
        return output;
      },
      validateIntermediate,
      validateRoleResult:async({result})=>{
        if(evaluator){
          const assessment=evaluator.assessCompletion({result});
          if(!assessment.valid){
            const failure={schema:"debugai.role-validation/v1",role,stage:"COMPLETE",valid:false,reason:assessment.reason};
            runtimeEvidence?.write(runId,"role_validation",failure);
            await logRuntime({run_id:runId,severity:"warn",kind:"role_validation",...failure});
          }
          return assessment.valid;
        }
        try{parseAndValidateRoleOutput(role,result,{availableEvidenceIds:evidence,strictEvidenceRefs:true});return true;}
        catch{return false;}
      }
    });
  }
  async function continueDiagnoserTask({runId,workItemId,inputBinding,task,
    baseEvidenceIds=[],evidenceRecords=[],semanticCriteria=null,requireSemanticProgress=false,maxStepsPerCall=1,maxTotalSteps=12,signal=null}={}){
    if(semanticCriteria!==null||requireSemanticProgress||recoveryHooks?.requireSemanticProgress===true||recoveryHooks?.semanticCriteria?.[workItemId])return continueRoleTask({runId,role:"diagnoser",workItemId,inputBinding,task,baseEvidenceIds,evidenceRecords,semanticCriteria,requireSemanticProgress,maxStepsPerCall,maxTotalSteps,signal});
    if(!authority?.durableEnabled?.())throw new Error("DIAGNOSER_DURABLE_AUTHORITY_REQUIRED");
    if(typeof task!=="string"||!task.trim())throw new Error("DIAGNOSER_TASK_REQUIRED");
    if(!Array.isArray(baseEvidenceIds)||!baseEvidenceIds.every(x=>typeof x==="string"))
      throw new Error("DIAGNOSER_EVIDENCE_IDS_INVALID");
    authority.loadDurable(runId); // No implicit new run, no approval bypass.
    const validatedRecords=validateEvidenceRecords(evidenceRecords);
    const evidence=mergeBaseEvidenceWithRecords(baseEvidenceIds,validatedRecords);
    const boundInput=contentHash({role:"diagnoser",task,evidence,input_binding:inputBinding,...(aiCore.runtime_route_binding?{core_route_binding:aiCore.runtime_route_binding}:{})});
    return continueDiagnoserWorkItem({authority,runId,workItemId,inputBinding:boundInput,
      maxStepsPerCall,maxTotalSteps,signal,
      buildStepPrompt:async({step,previousProgress})=>({
        system:"Diagnoser. Investigate only the SAME diagnosis task. Each response must be a compact JSON object with status CONTINUE, COMPLETE, or BLOCKED. For CONTINUE return progress with verified evidence_refs and explicit remaining_work. For COMPLETE return result matching the existing Diagnoser canonical role contract. Every active hypothesis must contain a concrete cause statement and falsification condition grounded in evidence; if unavailable return INSUFFICIENT_EVIDENCE rather than an ID-only claim. No unsupported evidence or hidden reasoning. No tools or mutations in this opt-in path.",
        user:registeredEvidenceUserPayload({task,step,previousProgress,evidence,validatedRecords})
      }),
      invokeDiagnoser:async prompt=>{
        const out=await callDirectRole("diagnoser",prompt,runId,{signal});
        return parseJson(out.content);
      },
      validateIntermediate:async({progress})=>{
        return progress&&typeof progress==="object"&&!Array.isArray(progress)&&
          Array.isArray(progress.evidence_refs)&&
          progress.evidence_refs.every(id=>typeof id==="string"&&evidence.includes(id))&&
          typeof progress.remaining_work==="string"&&progress.remaining_work.trim().length>0;
      },
      validateDiagnosis:async({result})=>{
        try{
          parseAndValidateRoleOutput("diagnoser",result,{availableEvidenceIds:evidence,strictEvidenceRefs:true});
          return true;
        }catch{return false;}
      }
    });
  }
  async function callDirectRole(role,{system,user},runId=null,{signal=null}={}){const b=getRoleRuntimeBudget(role);const adapter=runId?observeAiCalls({aiCore,runId,runtimeEvidence,onEvent:logRuntime}):aiCore;return adapter.call(role,{system,user,maxTokens:b.max_tokens,timeoutMsOverride:b.turn_timeout_ms,deadlineAt:Date.now()+b.turn_timeout_ms,...(signal?{signal}:{})});}
  function externalUnavailable(error){
    const code=String(error?.code||error?.message||"");
    return /^(?:LIVE_BLOCKED_FREE_TIER_UNVERIFIED|EXTERNAL_FREE_PROVIDERS_UNAVAILABLE|EXTERNAL_FREE_REQUEST_BUDGET_EXHAUSTED|EXTERNAL_REVIEW_CI_EGRESS_BLOCKED|EXTERNAL_REVIEW_QUOTA_[A-Z_]+|EXTERNAL_REVIEW_(?:SCHEMA|EMPTY|INCOMPLETE)|(?:GROQ|GEMINI)_(?:KEY_MISSING|NETWORK|JSON|ENVELOPE|HTTP_(?:401|403|429|5[0-9]{2})))$/.test(code);
  }
  async function reviewWithLocalFallback(kind,payload,localReview){
    // Omitted hypothesis integration retains the legacy awaiting-review contract.
    if(!externalReview&&kind==="hypothesis")return {external:null,local:null};
    let reason="EXTERNAL_REVIEW_NOT_CONFIGURED";
    if(externalReview){
      try{return {external:await externalReview[kind](payload),local:null};}
      catch(error){if(!externalUnavailable(error))throw error;reason=String(error.code||error.message);}
    }
    const json=await localReview();
    return {external:null,local:{provider:"local_reviewer",review_kind:kind,external_status:"UNAVAILABLE",unavailable_code:reason,json}};
  }
  async function getOfficialEvidence(query){if(!evidenceSearch)return{official:[],evidenceGap:false,evidenceStatus:"NOT_CONFIGURED"};try{return{official:await evidenceSearch.search({query}),evidenceGap:false,evidenceStatus:"FINAL_VALID"};}catch(e){if(e?.code==="EVIDENCE_SEARCH_NOT_FINAL")return{official:[],evidenceGap:true,evidenceStatus:String(e?.meta?.status||"NOT_FINAL")};throw e;}}
  async function prepareAnalysis({runId=null,rawRequest="",failure=null,localEvidence=[],repo=null,projectId=null}={}){
    let authRun=null,resuming=Boolean(runId),inputRecord=null,inputManifestRef=null;
    if(!authority)return{runId:runId||crypto.randomUUID(),authRun:null,resuming,targetRepo:repoPolicy&&repo?repoPolicy.assertRepo(repo):null,input:{rawRequest:String(rawRequest||""),failure,localEvidence},inputRecord:null,inputManifestRef:null};
    if(runId)authRun=authority.load(runId);
    else{
      const masterRequest=String(rawRequest||failure?.message||failure?.summary||"");
      authRun=authority.start({rawRequest:masterRequest,repo,projectId});runId=authRun.run_id;
      authority.transition(authRun,"PARSED");authority.transition(authRun,"CONTEXT_READY");authority.transition(authRun,"VERIFYING");authority.transition(authRun,"FAILED");authority.transition(authRun,"RESOLVING");
    }
    if(!authority.durableEnabled?.())return{runId,authRun,resuming,targetRepo:authRun.project_dir,input:{rawRequest:String(rawRequest||""),failure,localEvidence},inputRecord:null,inputManifestRef:null};
    await authority.initializeDurable(authRun);
    if(!resuming){
      const made=makeDurableAnalysisInput({runId,rawRequest:String(rawRequest||failure?.message||failure?.summary||""),failure,localEvidence});
      await authority.commitDurable({runId,manifestPatch:{job:{status:"RUNNING"},workflow_input_refs:{analysis_input:made.path},workflow_cursor:{step_id:WorkflowStepId.DETERMINISTIC_VERIFY,step_phase:StepPhase.PENDING,step_input_ref:made.path,step_result_ref:null}},runStatePatch:{job_status:"RUNNING"},immutableRecords:[{path:made.path,record:made.record}]});
      inputRecord=made.record;inputManifestRef=made.path;
      return{runId,authRun,resuming,targetRepo:authRun.project_dir,input:{rawRequest:made.payload.raw_request,failure:made.payload.failure,localEvidence:made.payload.local_evidence},inputRecord,inputManifestRef};
    }
    const {state,manifest}=authority.loadDurable(runId),recordPath=manifest.workflow_input_refs?.analysis_input;
    if(state.job_status==="CANCELLED"||manifest.cancellation!==null)throw new Error("RUN_CANCELLED");
    if(["DONE","BLOCKED","FAILED"].includes(state.job_status))throw new Error(`RUN_NOT_RECOVERABLE:${state.job_status}`);
    if(typeof recordPath!=="string"||!recordPath)throw new Error("DURABLE_ANALYSIS_INPUT_REF_MISSING");
    const loaded=loadDurableAnalysisInput({authority,recordPath});inputRecord=loaded.record;inputManifestRef=recordPath;
    if(repo&&path.resolve(String(repo))!==path.resolve(authRun.project_dir))throw new Error("DURABLE_RESUME_REPO_MISMATCH");
    return{runId,authRun,resuming,targetRepo:authRun.project_dir,input:{rawRequest:loaded.payload.raw_request,failure:loaded.payload.failure,localEvidence:loaded.payload.local_evidence},inputRecord,inputManifestRef};
  }
  async function setCursor(runId,stepId,stepPhase,{stepInputRef=null,stepResultRef=null,activeRoleExecutionId=null,jobStatus="RUNNING"}={}){
    if(!authority?.durableEnabled?.())return null;
    return authority.commitDurable({runId,manifestPatch:{job:{status:jobStatus},workflow_cursor:{step_id:stepId,step_phase:stepPhase,step_input_ref:stepInputRef,step_result_ref:stepResultRef,active_role_execution_id:activeRoleExecutionId}},runStatePatch:{job_status:jobStatus}});
  }
  async function saveStage(runId,key,payload,nextStep,{activeRoleExecutionId=null,stepPhase=StepPhase.PENDING,stepInputRef=null}={}){
    const made=makeDurableWorkflowStage({runId,key,payload});
    await authority.commitDurable({runId,manifestPatch:{job:{status:"RUNNING"},workflow_input_refs:{[key]:made.path},workflow_cursor:{step_id:nextStep,step_phase:stepPhase,step_input_ref:stepInputRef||made.path,step_result_ref:null,active_role_execution_id:activeRoleExecutionId}},runStatePatch:{job_status:"RUNNING"},immutableRecords:[{path:made.path,record:made.record}]});
    return made;
  }
  function loadStageRef(runId,key){const {manifest}=authority.loadDurable(runId),ref=manifest.workflow_input_refs?.[key];return typeof ref==="string"&&ref?loadDurableWorkflowStage({authority,recordPath:ref,expectedKey:key}):null;}
  function durableResearchEvidence(roleResult){const out=[];for(const effectId of roleResult?.effect_refs||[]){const result=authority.readDurableRecord(toolResultPath(effectId),{expectedSchema:"debugai.tool-result/v1",allowMissing:true});if(!result)throw new Error(`DURABLE_EFFECT_RESULT_MISSING:${effectId}`);assertToolResultIntegrity(result);out.push({evidence_id:result.evidence_id,tool:result.tool,data:result.data,integrity:result.integrity});}return out;}
  function failClosedRecoveryError(error){return /(?:INCOMPATIBLE|MISMATCH|DIGEST|CORRUPT|SECURITY|FORBIDDEN|CANCELLED|EPOCH_FENCED|GENERATION_CONFLICT|INPUT_REF_MISSING)/i.test(String(error?.code||error?.message||error));}
  async function recordExecutionFailure(runId,error){
    const meta=error?.meta||{},isWorkItemPending=isRoleWorkItemPending(error?.code),prior=authority?.durableEnabled?.()?loadStageRef(runId,"last_execution_failure")?.payload:null,priorRetries=Number.isInteger(prior?.autonomous_retry_attempt)?prior.autonomous_retry_attempt:0;
    const failure={code:String(error?.code||error?.message||"EXECUTION_ERROR").split(":")[0].slice(0,80),role:meta.role||null,model:meta.model||null,invocation_id:meta.invocation_id||null,timeout_class:meta.timeout_class||null,attempts:Number.isInteger(meta.attempts)?meta.attempts:null,retryable:typeof meta.retryable==="boolean"?meta.retryable:null,failed_at:Date.now(),autonomous_retry_attempt:isWorkItemPending?priorRetries:priorRetries+1,telemetry:meta.telemetry?require("./control/tool-loop.js").summarizeAiTelemetry([meta.telemetry]):null};
    runtimeEvidence?.write(runId,"execution_failure",failure);
    Promise.resolve(logRuntime({run_id:runId,severity:"error",kind:"execution_failure",...failure})).catch(()=>console.error("DebugAI failure log delivery failed"));
    if(!authority?.durableEnabled?.())return;
    const closed=!isWorkItemPending&&(meta.retryable===false||failClosedRecoveryError(error)||failure.autonomous_retry_attempt>MAX_AUTONOMOUS_RETRIES),loaded=authority.loadDurable(runId),cursor=loaded.manifest.workflow_cursor,failureStep=meta.role==="code_scout"?WorkflowStepId.CODE_SCOUT:meta.role==="causal_scout"?WorkflowStepId.CAUSAL_SCOUT:cursor.step_id,durable=error?.durable||null,made=makeDurableWorkflowStage({runId,key:"last_execution_failure",payload:failure});
    runtimeEvidence?.write(runId,"workflow_progress",{step:failureStep,phase:closed?StepPhase.BLOCKED:StepPhase.PENDING});
    await authority.commitDurable({runId,manifestPatch:{job:{status:closed?"BLOCKED":"RETRY_WAIT"},workflow_input_refs:{last_execution_failure:made.path},workflow_cursor:{...cursor,step_id:failureStep,...(["code_scout","causal_scout"].includes(meta.role)?{step_input_ref:loaded.manifest.workflow_input_refs?.analysis_input||cursor.step_input_ref,step_result_ref:null}:{}),step_phase:closed?StepPhase.BLOCKED:StepPhase.PENDING,active_role_execution_id:durable?.role_execution_id||cursor.active_role_execution_id}},runStatePatch:{job_status:closed?"BLOCKED":"RETRY_WAIT"},immutableRecords:[{path:made.path,record:made.record}]});
    if(!closed&&!retryTimers.has(runId)){
      const timer=setTimeout(()=>{
        retryTimers.delete(runId);
        void resumeAnalysis({runId}).catch(retryError=>{
          backgroundErrors.set(runId,String(retryError?.code||retryError?.message||retryError));
        });
      },RETRY_DELAY_MS);
      retryTimers.set(runId,timer);
      timer.unref?.();
    }
  }
  async function executeAnalysis(prepared){
    const {runId,resuming,targetRepo,input,inputRecord,inputManifestRef}=prepared,{rawRequest,failure,localEvidence}=input;
    const toolRuntime=makeReadOnlyToolRuntime(targetRepo,runId),durable=Boolean(authority?.durableEnabled?.());
    const binding=durable?localStageBinding({repo:targetRepo,repoSnapshotId:snapshotRepo(targetRepo),inputDigest:inputRecord.payload_digest,runtimeContextTokens:aiCore.runtime_context_tokens??null,runtimeRouteBinding:aiCore.runtime_route_binding??null}):null;
    let contextStage=durable?loadStageRef(runId,"research_context"):null,context,scouts=null;
    if(contextStage&&!reusableLocalStage(contextStage,binding))contextStage=null;
    if(contextStage){
      context=contextStage.payload;const currentSnapshot=snapshotRepo(targetRepo);if(currentSnapshot!==context.repo_snapshot_id)throw new Error("DURABLE_REPO_SNAPSHOT_MISMATCH");
    }else{
      if(durable)await setCursor(runId,WorkflowStepId.DETERMINISTIC_VERIFY,StepPhase.RUNNING,{stepInputRef:inputManifestRef});await logProgress(runId,WorkflowStepId.DETERMINISTIC_VERIFY,StepPhase.RUNNING);
      const reproductionStage=durable?loadStageRef(runId,"deterministic_reproduction"):null;
      const reuseReproduction=reusableLocalStage(reproductionStage,binding);
      const deterministicVerification=reuseReproduction?reproductionStage.payload.result:sandboxVerification&&targetRepo?await sandboxVerification.collect(targetRepo):{status:"NOT_CONFIGURED",checks:[]};
      if(reuseReproduction)runtimeEvidence?.write(runId,"stage_reuse",{stage:"deterministic_reproduction",saved_at:reproductionStage.payload.saved_at,execution:"PREVIOUS_RUN_ATTEMPT",new_execution:false});
      // Reuse prior local failing reproduction observations, never passing checks
      // as present verification. Final retests still require fresh execution.
      const reproductionChecks=deterministicVerification.checks||[];
      const sourceOnlyReproduction=reproductionChecks.length>0&&reproductionChecks.some(check=>check.status==="FAIL")&&reproductionChecks.every(check=>check.executed===true&&!check.timed_out&&["PASS","FAIL"].includes(check.status)&&check.sandbox?.backend==="sidecar+landlock+seccomp"&&String(check.sandbox?.network||"").startsWith("CONTAINER_NETWORK_NONE"));
      if(durable&&!reuseReproduction&&binding&&sourceOnlyReproduction)await saveStage(runId,"deterministic_reproduction",{reuse_binding:binding,saved_at:Date.now(),result:deterministicVerification},WorkflowStepId.CODE_SCOUT);
      const deterministicChecks=Array.isArray(deterministicVerification?.checks)?deterministicVerification.checks:[];
      if(deterministicChecks.length)runtimeEvidence?.write(runId,"deterministic_verification",{status:deterministicVerification.status,checks:deterministicChecks});
      let dapHint=null;if(dapEvidence&&targetRepo){const candidate=await dapEvidence.collect({repo:targetRepo,checks:dapFailureChecks(failure,deterministicChecks),task:String(rawRequest||failure?.message||failure?.summary||""),variableNames:Array.isArray(failure?.variable_names)?failure.variable_names:[]});dapHint=activeDapHint(candidate);if(dapHint){runtimeEvidence?.write(runId,"dap_hint",dapHint);await logRuntime({run_id:runId,severity:dapHint.status==="PASS"?"info":"warn",kind:"dap_hint",authority:"HINT_ONLY",local_only:true,status:dapHint.status,reason:dapHint.reason,target:dapHint.target||null});}}
      const initial=targetRepo?initialInvestigationEvidence(targetRepo,{request:rawRequest||failure?.message,failure,checks:deterministicChecks}):{records:[],scope:{mode:"OPEN_INVESTIGATION",coverage:"PARTIAL"}};
      const hintProtocol=dapHintProtocol(dapHint),localRecords=registerEvidenceList("LOCAL_RUNTIME",[...(Array.isArray(localEvidence)?localEvidence:[]),...deterministicChecks.map(reviewableVerificationCheck),...initial.records]),localIds=evidenceIds(localRecords);
      const initialScope={...initial.scope,repository_revision:durable?snapshotRepo(targetRepo):null,known_evidence_ids:localIds};
      runtimeEvidence?.write(runId,"failure",failure);await logRuntime({run_id:runId,severity:"error",kind:"failure",failure});if(deterministicChecks.length)await logRuntime({run_id:runId,severity:deterministicChecks.some(x=>x.status==="FAIL")?"warn":"info",kind:"deterministic_verification",status:deterministicVerification.status,check_count:deterministicChecks.length,failed:deterministicChecks.filter(x=>x.status==="FAIL").length});
      const query=String(failure?.message||failure?.summary||rawRequest||"debug failure");
      await logProgress(runId,"SCOUTS",StepPhase.RUNNING);
      let scoutCommitTail=Promise.resolve();const scoutStates=new Map();
      function commitScout(operation){const next=scoutCommitTail.then(operation);scoutCommitTail=next.catch(()=>{});return next;}
      async function scout(role,system){
        scoutStates.set(role,StepPhase.RUNNING);
        const step=role==="code_scout"?WorkflowStepId.CODE_SCOUT:WorkflowStepId.CAUSAL_SCOUT;
        const compactCausal=role==="causal_scout"&&initialScope.mode==="LOCAL_REPRODUCTION"&&recoveryHooks?.enableHorizontalCausalScout!==true;
        const user=JSON.stringify({task:rawRequest,failure,evidence:compactCausal?causalEvidencePromptView(localRecords):evidencePromptView(localRecords),initial_scope:initialScope,dap_hint:dapHint});
        const scoutBinding=binding?contentHash({binding,role,system,user}):null,saved=durable?loadStageRef(runId,role):null;
        if(reusableLocalStage(saved,scoutBinding)&&saved.payload.reusable===true){
          const out=saved.payload.result;parseAndValidateRoleOutput(role,JSON.stringify(out.validated_output),{availableEvidenceIds:mergeEvidenceIds(localIds,out.tool_loop?.evidence_ids||[]),strictEvidenceRefs:true});toolEvidenceRecords(out);
          scoutStates.set(role,StepPhase.DONE);runtimeEvidence?.write(runId,"stage_reuse",{stage:role,saved_at:saved.payload.saved_at,new_execution:false});return out;
        }
        if(durable)await commitScout(()=>setCursor(runId,step,StepPhase.RUNNING,{stepInputRef:inputManifestRef}));
        await logProgress(runId,step,StepPhase.RUNNING);
        const scoutStartedAt=Date.now();
        try{
          const horizontalScout=(role==="code_scout"?recoveryHooks?.enableHorizontalCodeScout:recoveryHooks?.enableHorizontalCausalScout)===true;
          let out;
          if(horizontalScout&&durable){
            const scoutInput={task:rawRequest,failure,evidence:evidencePromptView(localRecords),initial_scope:initialScope,dap_hint:dapHint};
            const stage=await continueRoleTask({runId,role,workItemId:`analysis.scout.${role}`,
              inputBinding:contentHash({binding,role,system,user:scoutInput}),
              task:JSON.stringify(scoutInput),baseEvidenceIds:localIds,evidenceRecords:localRecords,
              maxStepsPerCall:1,maxTotalSteps:12});
            const result=assertHorizontalStageComplete(role,stage);
            out={content:JSON.stringify(result),validated_output:result,tool_loop:{observations:[],evidence_ids:localIds,progress:null}};
          }else{
            out=await callReadOnlyRole(role,{system:[system,hintProtocol,"Use initial scoped source and reproduction evidence first. Request additional search only to resolve an explicit missing fact or obtain counter-evidence. PARTIAL source scope is not exhaustive coverage; retain UNKNOWNs and falsification checks."].filter(Boolean).join("\n"),user},toolRuntime,{baseEvidenceIds:localIds,registeredEvidence:compactCausal?localRecords:[],runId});
          }
          const output=roleOutput(out,role);toolEvidenceRecords(out);
          const reusable=(out.tool_loop?.observations||[]).every(observation=>(observation.results||[]).every(item=>["source.read","source.search","symbol.lookup","dependency.map","test.inventory"].includes(item.request?.tool)&&item.result?.status==="OK"));
          const peerRole=role==="code_scout"?"causal_scout":"code_scout",peerStep=peerRole==="code_scout"?WorkflowStepId.CODE_SCOUT:WorkflowStepId.CAUSAL_SCOUT;
          scoutStates.set(role,StepPhase.DONE);let peerRunning=false;
          if(durable)await commitScout(()=>{peerRunning=scoutStates.get(peerRole)===StepPhase.RUNNING;return saveStage(runId,role,{reuse_binding:scoutBinding,saved_at:Date.now(),reusable,result:{validated_output:output,tool_loop:out.tool_loop||null}},peerRunning?peerStep:step,{stepPhase:peerRunning?StepPhase.RUNNING:StepPhase.DONE,stepInputRef:peerRunning?inputManifestRef:null});});
          await logProgress(runId,peerRunning?peerStep:step,peerRunning?StepPhase.RUNNING:StepPhase.DONE);return out;
        }catch(error){scoutStates.set(role,StepPhase.BLOCKED);const invocation=invocationStatus(runId).find(item=>item.role===role&&item.started_at>=scoutStartedAt);error.meta={...error.meta,role,model:error.meta?.model||invocation?.model||null,invocation_id:error.meta?.invocation_id||invocation?.invocation_id||null};throw error;}
      }
      // Preserve parallel Scout orchestration and the adapter's global single
      // dispatch slot. Serialize only existing durable commits; settle both
      // Scouts before recording failure so successful work is not lost and no
      // late callback can restore RUNNING after a terminal retry decision.
      const localFirst=initialScope.mode==="LOCAL_REPRODUCTION";
      const settled=await Promise.allSettled([scout("code_scout","Code Scout. Return one compact JSON object under 400 tokens. Use at most 3 items per array and concise strings. No prose outside JSON."),scout("causal_scout",CAUSAL_SCOUT_OUTPUT_POLICY),localFirst?Promise.resolve([]):tgserver?tgserver.search(query):Promise.resolve([]),localFirst?Promise.resolve({official:[],evidenceGap:false,evidenceStatus:"NOT_REQUESTED_LOCAL_REPRODUCTION"}):getOfficialEvidence(query)]);
      const rejected=settled.find(item=>item.status==="rejected");if(rejected)throw rejected.reason;
      const combined=[[settled[0].value,settled[1].value],settled[2].value,settled[3].value];
      scouts=combined[0];await logProgress(runId,"SCOUTS",StepPhase.DONE);const knownKnowledge=combined[1],evidenceResult=combined[2];
      const scoutJson=[roleOutput(scouts[0],"code_scout"),roleOutput(scouts[1],"causal_scout")],scoutToolEvidence=[...toolEvidenceRecords(scouts[0]),...toolEvidenceRecords(scouts[1])],official=evidenceResult.official,evidenceGap=evidenceResult.evidenceGap,evidenceStatus=evidenceResult.evidenceStatus,knowledgeRecords=registerEvidenceList("INTERNAL_KB",knownKnowledge),officialRecords=registerEvidenceList("OFFICIAL_EXTERNAL",official),researchBase=mergeEvidenceIds(localIds,evidenceIds(knowledgeRecords),evidenceIds(officialRecords),scoutToolEvidence.map(x=>x.evidence_id));
      context={reuse_binding:binding,saved_at:Date.now(),initial_scope:initialScope,repo_snapshot_id:durable?snapshotRepo(targetRepo):null,deterministic_verification:deterministicVerification,deterministic_checks:deterministicChecks,dap_hint:dapHint,local_records:localRecords,local_ids:localIds,query,scout_json:scoutJson,scout_tool_evidence:scoutToolEvidence,scout_tool_audit:{code_scout:toolAudit(scouts[0]),causal_scout:toolAudit(scouts[1])},known_knowledge:knownKnowledge,knowledge_records:knowledgeRecords,official,evidence_gap:evidenceGap,evidence_status:evidenceStatus,official_records:officialRecords,research_base:researchBase};
      if(durable)contextStage=await saveStage(runId,"research_context",context,WorkflowStepId.RESEARCHER);
    }
    const deterministicVerification=context.deterministic_verification,deterministicChecks=context.deterministic_checks||[],dapHint=context.dap_hint||null,hintProtocol=dapHintProtocol(dapHint),localRecords=context.local_records||[],localIds=context.local_ids||[],scoutJson=context.scout_json||[],scoutToolEvidence=context.scout_tool_evidence||[],knownKnowledge=context.known_knowledge||[],knowledgeRecords=context.knowledge_records||[],official=context.official||[],evidenceGap=Boolean(context.evidence_gap),evidenceStatus=context.evidence_status,officialRecords=context.official_records||[],researchBase=context.research_base||[];
    let research=null,researchJson=null,researchToolEvidence=[],researchContinuation=null;
    if(durable){
      const inputBindingDigest=contentHash({run_id:runId,input_manifest_digest:inputRecord.payload_digest,research_context_digest:contextStage.record.payload_digest,repo_snapshot_id:context.repo_snapshot_id,...(aiCore.runtime_route_binding?{core_route_binding:aiCore.runtime_route_binding}:{})});
      await setCursor(runId,WorkflowStepId.RESEARCHER,StepPhase.RUNNING,{stepInputRef:contextStage.path});await logProgress(runId,WorkflowStepId.RESEARCHER,StepPhase.RUNNING);
      researchContinuation=await runResearcherContinuation({authority,runId,repoSnapshotId:context.repo_snapshot_id,inputManifestRef,inputBindingDigest,executeWorkUnit:async(args)=>{const {unit,restoredResults,roleExecutionId,attemptId}=args;await recoveryHooks?.beforeResearcherWorkUnit?.(args);
        let answer;if(unit.work_unit_id==="researcher.A")answer={payload:{localEvidence:evidencePromptView(localRecords),scouts:scoutJson,scout_tool_evidence:evidencePromptView(scoutToolEvidence)},evidence_refs:mergeEvidenceIds(localIds,scoutToolEvidence.map(x=>x.evidence_id))};
        else if(unit.work_unit_id==="researcher.B")answer={payload:{knownKnowledge:evidencePromptView(knowledgeRecords)},evidence_refs:evidenceIds(knowledgeRecords)};
        else if(unit.work_unit_id==="researcher.C")answer={payload:{official:evidencePromptView(officialRecords),evidence_gap:evidenceGap,evidence_status:evidenceStatus,evidence_gap_scope:"official_evidence_search"},evidence_refs:evidenceIds(officialRecords)};
        else if(unit.work_unit_id==="researcher.D")answer={payload:{A:restoredResults["researcher.A"]?.payload||null,B:restoredResults["researcher.B"]?.payload||null,C:restoredResults["researcher.C"]?.payload||null},evidence_refs:researchBase};
        else if(unit.work_unit_id==="researcher.E"){
          const assembled=restoredResults["researcher.D"]?.payload||{};
          const researchInput={task:rawRequest,failure,dap_hint:dapHint,...(assembled.A||{}),...(assembled.B||{}),...(assembled.C||{})};
          if(recoveryHooks?.enableHorizontalResearcher===true){
            const stage=await continueRoleTask({runId,role:"researcher",workItemId:"researcher.E",
              inputBinding:contentHash({inputBindingDigest,work_unit_id:unit.work_unit_id,input:researchInput}),
              task:JSON.stringify(researchInput),baseEvidenceIds:researchBase,
              evidenceRecords:[...localRecords,...knowledgeRecords,...officialRecords,...scoutToolEvidence],maxStepsPerCall:1,maxTotalSteps:12});
            const payload=assertHorizontalStageComplete("researcher",stage);
            research={content:JSON.stringify(payload),validated_output:payload};
            answer={payload,evidence_refs:researchBase,effect_refs:[],validation_summary:"Existing researcher output contract; same E work item completed"};
          }else{
            const durableHooks=createDurableToolEffectHooks({authority,runId,roleExecutionId,attemptId,workUnitId:unit.work_unit_id,inputBindingDigest,repoSnapshotId:context.repo_snapshot_id});
            research=await callReadOnlyRole("researcher",{system:["Researcher. Select decisive evidence. Return JSON only with exactly these top-level keys: research_status, answer, evidence_refs, rejected_source_refs, contradictions, bound_version. research_status must be SUPPORTED, CONTRADICTORY_EVIDENCE, or INSUFFICIENT_EVIDENCE. Keep answer under 120 characters; use at most 3 short strings per array; target under 100 tokens. Use only registered evidence IDs. If evidence_gap is true, do not treat official evidence as confirmed; local evidence remains available and must be evaluated on its own merits.",hintProtocol].filter(Boolean).join("\n"),user:JSON.stringify(researchInput)},toolRuntime,{baseEvidenceIds:researchBase,durableHooks,runId});
            const payload=roleOutput(research,"researcher"),tools=toolEvidenceRecords(research),effectRefs=[...(research?.tool_loop?.continuation_state?.completed_effect_ids||[])];
            answer={payload,evidence_refs:mergeEvidenceIds(researchBase,tools.map(x=>x.evidence_id)),effect_refs:effectRefs,validation_summary:"Validated by existing researcher role-output contract"};
          }
        }
        else throw new Error(`RESEARCHER_WORK_UNIT_UNKNOWN:${unit.work_unit_id}`);await recoveryHooks?.afterResearcherWorkUnit?.({...args,result:answer});return answer;}});
      researchJson=researchContinuation.payload;researchToolEvidence=durableResearchEvidence(researchContinuation.final_role_result);await logProgress(runId,WorkflowStepId.RESEARCHER,StepPhase.DONE);await setCursor(runId,WorkflowStepId.DIAGNOSER,StepPhase.PENDING,{activeRoleExecutionId:null});
    }else{await logProgress(runId,WorkflowStepId.RESEARCHER,StepPhase.RUNNING);research=await callReadOnlyRole("researcher",{system:["Researcher. Select decisive evidence. Return JSON only with exactly these top-level keys: research_status, answer, evidence_refs, rejected_source_refs, contradictions, bound_version. research_status must be SUPPORTED, CONTRADICTORY_EVIDENCE, or INSUFFICIENT_EVIDENCE. Keep answer under 120 characters; use at most 3 short strings per array; target under 100 tokens. Use only registered evidence IDs. If evidence_gap is true, do not treat official evidence as confirmed; local evidence remains available and must be evaluated on its own merits.",hintProtocol].filter(Boolean).join("\n"),user:JSON.stringify({task:rawRequest,failure,localEvidence:evidencePromptView(localRecords),dap_hint:dapHint,scouts:scoutJson,scout_tool_evidence:evidencePromptView(scoutToolEvidence),knownKnowledge:evidencePromptView(knowledgeRecords),official:evidencePromptView(officialRecords),evidence_gap:evidenceGap,evidence_status:evidenceStatus,evidence_gap_scope:"official_evidence_search"})},toolRuntime,{baseEvidenceIds:researchBase,runId});researchJson=roleOutput(research,"researcher");researchToolEvidence=toolEvidenceRecords(research);await logProgress(runId,WorkflowStepId.RESEARCHER,StepPhase.DONE);}
    const diagnosisBase=mergeEvidenceIds(researchBase,researchContinuation?.final_role_result?.evidence_refs||[],researchToolEvidence.map(x=>x.evidence_id));let diagnosisStage=durable?loadStageRef(runId,"diagnosis"):null,diagnosisJson,diagnosisToolEvidence,diagnosisAudit;
    if(diagnosisStage){diagnosisJson=diagnosisStage.payload.diagnosis;diagnosisToolEvidence=diagnosisStage.payload.tool_evidence||[];diagnosisAudit=diagnosisStage.payload.tool_audit||null;}
    else{if(durable)await setCursor(runId,WorkflowStepId.DIAGNOSER,StepPhase.RUNNING);await logProgress(runId,WorkflowStepId.DIAGNOSER,StepPhase.RUNNING);const handoff=researchContinuation?buildDownstreamInputBundle({roleResult:researchContinuation.final_role_result,roleContractVersion:ROLE_CONTRACT_VERSION,workflowVersion:1,workflowIteration:0,repoSnapshotId:context.repo_snapshot_id,upstreamResultDigests:[],toolContractVersions:[TOOL_CONTRACT_VERSION],evidencePolicyVersion:"debugai.evidence-registry/v1",budgetPolicyVersion:"debugai.default-budget/v1"}):null;const diagEvidenceRecords=[...localRecords,...knowledgeRecords,...officialRecords,...scoutToolEvidence,...researchToolEvidence];const diagnosis=durable&&recoveryHooks?.enableHorizontalDiagnoser===true
      ?await (async()=>{
        const diagInput={task:rawRequest,failure,localEvidence:evidencePromptView(localRecords),dap_hint:dapHint,scouts:scoutJson,scout_tool_evidence:evidencePromptView(scoutToolEvidence),research:researchJson,researcher_role_result:handoff?{...handoff,payload:undefined}:null,research_tool_evidence:evidencePromptView(researchToolEvidence),knownKnowledge:evidencePromptView(knowledgeRecords),official:evidencePromptView(officialRecords),evidence_gap:evidenceGap,evidence_status:evidenceStatus,evidence_gap_scope:"official_evidence_search"};
        const stage=await continueDiagnoserTask({runId,workItemId:"analysis.diagnosis",
          inputBinding:contentHash({input:diagInput,repo_snapshot:context.repo_snapshot_id}),
          task:JSON.stringify(diagInput),baseEvidenceIds:diagnosisBase,evidenceRecords:diagEvidenceRecords,
          maxStepsPerCall:1,maxTotalSteps:12});
        const result=assertHorizontalStageComplete("diagnoser",stage);
        return {validated_output:result,tool_loop:{observations:[],evidence_ids:diagnosisBase,progress:null}};
      })()
      :await callReadOnlyRole("diagnoser",{system:["Diagnoser. Produce a falsifiable diagnosis as one compact JSON object under 600 tokens, with at most 3 items per array and no prose outside JSON. Each active hypothesis must carry its own concrete, evidence-grounded statement explaining a possible cause, not just an ID and falsification_condition. If no defensible statement is possible, use INSUFFICIENT_EVIDENCE rather than inventing a cause. Evaluate the provided Scouts directly even if Researcher could not select evidence. Preserve uncertainty about official evidence when evidence_gap is true, but do not discard supplied local evidence.",hintProtocol].filter(Boolean).join("\n"),user:JSON.stringify({task:rawRequest,failure,localEvidence:evidencePromptView(localRecords),dap_hint:dapHint,scouts:scoutJson,scout_tool_evidence:evidencePromptView(scoutToolEvidence),research:researchJson,researcher_role_result:handoff?{...handoff,payload:undefined}:null,research_tool_evidence:evidencePromptView(researchToolEvidence),knownKnowledge:evidencePromptView(knowledgeRecords),official:evidencePromptView(officialRecords),evidence_gap:evidenceGap,evidence_status:evidenceStatus,evidence_gap_scope:"official_evidence_search"})},toolRuntime,{baseEvidenceIds:diagnosisBase,runId});diagnosisJson=roleOutput(diagnosis,"diagnoser");diagnosisToolEvidence=toolEvidenceRecords(diagnosis);diagnosisAudit=toolAudit(diagnosis);await logProgress(runId,WorkflowStepId.DIAGNOSER,StepPhase.DONE);if(durable)diagnosisStage=await saveStage(runId,"diagnosis",{diagnosis:diagnosisJson,tool_evidence:diagnosisToolEvidence,tool_audit:diagnosisAudit,research_role_result_id:researchContinuation.final_role_result.role_result_id},WorkflowStepId.EXTERNAL_REVIEW);}
    const hypothesisReviewNotApplicable=["INSUFFICIENT_EVIDENCE","NO_ACTIVE_HYPOTHESIS"].includes(diagnosisJson?.diagnosis_status)||(diagnosisJson?.diagnosis_status==="HYPOTHESES_RETAINED"&&!diagnosisJson?.hypotheses?.some(h=>h?.status==="HYPOTHESIS"));const localPublic=publicLocalEvidence(localEvidence),hypothesis={privacy_class:"PUBLIC",sanitized:true,opaque_evidence:true,statement:hypothesisReviewNotApplicable?null:reviewableHypothesisStatement(diagnosisJson),cause_class:String(diagnosisJson?.cause_kind||"UNKNOWN"),evidence_count:localEvidence.length+deterministicChecks.length+knownKnowledge.length+official.length,local_evidence_count:localPublic.length,local_evidence:localPublic,evidence_gap:evidenceGap,evidence_status:evidenceStatus,evidence_gap_scope:evidenceGap?"official_evidence_search":null};
    let externalStage=durable?loadStageRef(runId,"external_review"):null,external,localHypothesis=null;if(hypothesisReviewNotApplicable){external={provider:"NOT_INVOKED",skipped:true,reason:"NO_ACTIVE_REVIEWABLE_HYPOTHESIS",json:{verdict:"INSUFFICIENT_EVIDENCE"}};localHypothesis=null;if(durable&&!externalStage)externalStage=await saveStage(runId,"external_review",{external,local_hypothesis_review:null},WorkflowStepId.FINAL_ANALYSIS);await logProgress(runId,WorkflowStepId.EXTERNAL_REVIEW,StepPhase.DONE);}else if(externalStage){external=externalStage.payload.external;localHypothesis=externalStage.payload.local_hypothesis_review||null;}else{if(durable)await setCursor(runId,WorkflowStepId.EXTERNAL_REVIEW,StepPhase.RUNNING);await logProgress(runId,WorkflowStepId.EXTERNAL_REVIEW,StepPhase.RUNNING);const review=await reviewWithLocalFallback("hypothesis",{privacy:{privacy_class:"PUBLIC",sanitized:true,opaque_evidence:true},hypothesis},async()=>{const lrEvidence=[...localRecords,...officialRecords,...researchToolEvidence,...diagnosisToolEvidence],lrBase=mergeEvidenceIds(diagnosisBase,diagnosisToolEvidence.map(x=>x.evidence_id));if(durable&&recoveryHooks?.enableHorizontalLocalReviewer===true){const lrInput={hypothesis,diagnosis:diagnosisJson,evidence:evidencePromptView(lrEvidence)};const stage=await continueRoleTask({runId,role:"local_reviewer",workItemId:"analysis.local_review",inputBinding:contentHash({input:lrInput,repo_snapshot:context.repo_snapshot_id}),task:JSON.stringify(lrInput),baseEvidenceIds:lrBase,evidenceRecords:lrEvidence,maxStepsPerCall:1,maxTotalSteps:12});return assertHorizontalStageComplete("local_reviewer",stage);}return roleOutput(await callReadOnlyRole("local_reviewer",{system:"Local Reviewer. Review the diagnosed hypothesis from fresh context using supplied evidence. Return the existing review contract: verdict PASS, FAIL or INSUFFICIENT_EVIDENCE, decision DONE, BLOCKED or INSUFFICIENT_EVIDENCE, and claims array. Preserve evidence gaps. JSON only. Never apply.",user:JSON.stringify({hypothesis,diagnosis:diagnosisJson,evidence:evidencePromptView(lrEvidence)})},toolRuntime,{baseEvidenceIds:lrBase,runId}),"local_reviewer");});external=review.external;localHypothesis=review.local;if(durable)externalStage=await saveStage(runId,"external_review",{external,local_hypothesis_review:localHypothesis},WorkflowStepId.FINAL_ANALYSIS);await logProgress(runId,WorkflowStepId.EXTERNAL_REVIEW,StepPhase.DONE);}
    const researcherAudit=research?toolAudit(research):researchContinuation?{durable_reuse:researchContinuation.reused_complete,role_execution_id:researchContinuation.role_execution_id,attempt_no:researchContinuation.attempt_no,executed_work_units:researchContinuation.executed_work_units}:null,tool_audit={code_scout:context.scout_tool_audit?.code_scout||null,causal_scout:context.scout_tool_audit?.causal_scout||null,researcher:researcherAudit,diagnoser:diagnosisAudit};
    const evidence_registry=registrySummary({local:localRecords,knowledge:knowledgeRecords,official:officialRecords});evidence_registry.tool_evidence_ids=mergeEvidenceIds(scoutToolEvidence.map(x=>x.evidence_id),researchToolEvidence.map(x=>x.evidence_id),diagnosisToolEvidence.map(x=>x.evidence_id));evidence_registry.total_with_tools=evidence_registry.total+evidence_registry.tool_evidence_ids.length;
    const result={run_id:runId,resumed:resuming,requirement_input:scrub({raw_request:rawRequest,specification:failure?.requirements??null}),durable_researcher:researchContinuation?{role_execution_id:researchContinuation.role_execution_id,attempt_no:researchContinuation.attempt_no,reused_complete:researchContinuation.reused_complete,executed_work_units:researchContinuation.executed_work_units}:null,deterministic_verification:{status:deterministicVerification.status,checks:deterministicChecks},dap_hint:dapHint,scouts:scoutJson,known_knowledge:knownKnowledge,official_evidence:official,evidence_gap:evidenceGap,evidence_status:evidenceStatus,evidence_registry,research:researchJson,diagnosis:diagnosisJson,tool_audit,external_hypothesis_review:external,local_hypothesis_review:localHypothesis,state:hypothesisReviewNotApplicable?"HYPOTHESIS_NOT_REVIEWABLE":(external||localHypothesis)?.json?.verdict==="PASS"?"HYPOTHESIS_APPROVED":"AWAITING_EXTERNAL_HYPOTHESIS_REVIEW"};
    runtimeEvidence?.write(runId,"analysis",result);await logRuntime({run_id:runId,severity:evidenceGap?"warn":"info",kind:"analysis",state:result.state,diagnosis:result.diagnosis,known_knowledge_count:knownKnowledge.length,official_evidence_count:official.length,evidence_registry_total:evidence_registry.total_with_tools,dap_hint_status:dapHint?.status||"NOT_CONFIGURED",evidence_gap:evidenceGap,evidence_status:evidenceStatus,deterministic_check_count:deterministicChecks.length,tool_calls:Object.values(tool_audit).reduce((n,x)=>n+(x?.total_calls||0),0)});if(durable)await setCursor(runId,WorkflowStepId.FINAL_ANALYSIS,StepPhase.DONE,{stepResultRef:externalStage?.path||diagnosisStage?.path||null,jobStatus:"DONE"});await logProgress(runId,WorkflowStepId.FINAL_ANALYSIS,StepPhase.DONE);return result;
  }
  async function executePrepared(prepared){const existing=activeRuns.get(prepared.runId);if(existing)return existing.promise;const promise=(async()=>{try{const result=await executeAnalysis(prepared);backgroundErrors.delete(prepared.runId);return result;}catch(error){backgroundErrors.set(prepared.runId,String(error?.code||error?.message||error));try{await recordExecutionFailure(prepared.runId,error);}catch(markError){error.recovery_mark_error=String(markError?.code||markError?.message||markError);}throw error;}finally{activeRuns.delete(prepared.runId);}})();activeRuns.set(prepared.runId,{promise,started_at:Date.now()});return promise;}
  async function runAnalysis(input={}){return executePrepared(await prepareAnalysis(input));}
  async function startAnalysis(input={}){const prepared=await prepareAnalysis(input),duplicate=activeRuns.has(prepared.runId);void executePrepared(prepared).catch(()=>{});return{schema:"debugai.run-accepted/v1",run_id:prepared.runId,state:duplicate?"ALREADY_RUNNING":"RUNNING",resumed:prepared.resuming,duplicate_resume_suppressed:duplicate};}
  async function resumeAnalysis({runId,recovery=null}={}){
    if(typeof runId!=="string"||!runId)throw new Error("RUN_ID_REQUIRED");
    if(recovery!==null){
      if(!recovery||typeof recovery!=="object"||Array.isArray(recovery)||
         Object.keys(recovery).sort().join("|")!=="expected_generation|expected_step|failure_code")
        throw new Error("BLOCKED_RECOVERY_CONTRACT_INVALID");
      if(!authority?.durableEnabled?.())throw new Error("BLOCKED_RECOVERY_DURABLE_REQUIRED");
      const loaded=authority.loadDurable(runId),cursor=loaded.manifest.workflow_cursor;
      if(loaded.manifest.cancellation!==null||loaded.state.job_status==="CANCELLED")throw new Error("RUN_CANCELLED");
      if(loaded.state.job_status!=="BLOCKED"||cursor.step_id!==WorkflowStepId.CAUSAL_SCOUT||
         cursor.step_phase!==StepPhase.BLOCKED||recovery.expected_step!=="CAUSAL_SCOUT"||
         !Number.isInteger(recovery.expected_generation)||recovery.expected_generation!==loaded.state.generation)
        throw new Error("BLOCKED_RECOVERY_STATE_MISMATCH");
      const previous=loadStageRef(runId,"last_execution_failure")?.payload;
      if(!previous||previous.code!=="AI_CORE_TIMEOUT"||recovery.failure_code!==previous.code||
         loaded.manifest.policy_refs?.g3_causal_manual_recovery_used===true)
        throw new Error("BLOCKED_RECOVERY_EVIDENCE_DENIED");
      await authority.bumpDurableEpoch({runId,
        manifestPatch:{job:{status:"RUNNING"},workflow_cursor:{step_phase:StepPhase.PENDING},
          policy_refs:{g3_causal_manual_recovery_used:true,g3_causal_manual_recovery_from_generation:loaded.state.generation}},
        runStatePatch:{job_status:"RUNNING"}});
    }
    return startAnalysis({runId});
  }
  async function recoverStartup({awaitCompletion=false}={}){if(!authority?.durableEnabled?.())return{schema:"debugai.startup-recovery/v1",claimed:[],terminal:[],incompatible:[],completed:[]};const scan=authority.inspectDurableRuns(),claimed=[],scheduled=[];for(const item of scan.recoverable){let owned=false;try{await authority.claimRecoverableRun(item.run_id);owned=true;const prepared=await prepareAnalysis({runId:item.run_id});claimed.push(item.run_id);scheduled.push(executePrepared(prepared));}catch(error){if(owned)try{await recordExecutionFailure(item.run_id,error);}catch{}scan.incompatible.push({run_id:item.run_id,error:String(error?.code||error?.message||error)});}}const completed=awaitCompletion?await Promise.allSettled(scheduled):[];if(!awaitCompletion)for(const promise of scheduled)void promise.catch(()=>{});return{schema:"debugai.startup-recovery/v1",claimed,terminal:scan.terminal.map(x=>({run_id:x.run_id,reason:x.reason})),incompatible:scan.incompatible,completed:completed.map((x,index)=>({run_id:claimed[index],status:x.status,error:x.status==="rejected"?String(x.reason?.message||x.reason):null}))};}
  function patchRequirementInput({runId,analysis,context,task}){
    let origin=analysis?.requirement_input||null;
    if(authority?.durableEnabled?.()){
      const ref=authority.loadDurable(runId).manifest.workflow_input_refs?.analysis_input;
      if(ref){const loaded=loadDurableAnalysisInput({authority,recordPath:ref});origin={raw_request:loaded.payload.raw_request,specification:loaded.payload.failure?.requirements??null};}
    }
    const supplied=context&&typeof context==="object"&&!Array.isArray(context)?context.requirements:undefined;
    if(origin?.specification&&supplied!==undefined&&contentHash(scrub(origin.specification))!==contentHash(scrub(supplied)))throw new Error("REQUIREMENT_INPUT_CONFLICT");
    return {verbatim_request:String(origin?.raw_request||task||""),verbatim_task:String(task||""),verbatim_context:context??null,specification:origin?.specification??supplied??null};
  }
  async function verifyCandidateBeforeApproval(runId,candidate){
    let verification;
    try{verification=sandboxVerification?.collectCandidate&&candidate.schema==="patch-candidate/v1"?await sandboxVerification.collectCandidate(candidate):{status:"NOT_CONFIGURED",reason:"CANDIDATE_VERIFICATION_UNAVAILABLE",checks:[]};}
    catch(error){runtimeEvidence?.write(runId,"candidate_verification",{status:"FINAL_INVALID",reason:String(error?.code||error?.message||error),checks:[],patch_candidate_id:candidate.id||null,patch_candidate_hash:candidate.candidate_hash||null,patch_applied:false});throw error;}
    const records=registerEvidenceList("LOCAL_RUNTIME",verification.checks||[]);
    const result={...verification,evidence_ids:evidenceIds(records),patch_candidate_id:candidate.id||null,patch_candidate_hash:candidate.candidate_hash||null,patch_applied:false};
    runtimeEvidence?.write(runId,"candidate_verification",result);
    return result;
  }
  async function patchCandidate({runId,analysis,repo,selectedPaths,context,task}){
    const verdict=analysis?.external_hypothesis_review?.json?.verdict||analysis?.local_hypothesis_review?.json?.verdict||analysis?.external_review?.verdict;
    if(verdict!=="PASS")throw new Error("PATCH_REQUIRES_EXTERNAL_HYPOTHESIS_REVIEW_PASS");
    const targetRepo=repoPolicy?repoPolicy.assertRepo(repo):repo,source=patchPacketSource(targetRepo,selectedPaths),inventory=verificationInventory(targetRepo),refs=patchPacketEvidenceRefs(analysis);
    const patchPacket=makePatchPacket({runId,diagnosisRef:`diagnosis_${contentHash(analysis?.diagnosis||{})}`,repositoryRevision:snapshotRepo(targetRepo),paths:selectedPaths,sourceExcerpts:source.sourceExcerpts,preconditionHashes:source.preconditionHashes,reproductionSummary:{status:String(analysis?.deterministic_verification?.status||"UNKNOWN"),checks:analysis?.deterministic_verification?.checks||[]},testInventory:inventory.checks,invariants:[{name:"candidate-only-patch-engineer",status:"PASS"},{name:"explicit-approval-required",status:"PASS"}],prohibitedPaths:source.prohibitedPaths,evidenceRefs:refs,requirementInput:patchRequirementInput({runId,analysis,context,task})});
    runtimeEvidence?.write(runId,"patch_packet",patchPacket);
    let out;
    if(authority?.durableEnabled?.()&&recoveryHooks?.enableHorizontalPatchEngineer===true){
      const peInput={patch_packet:patchPacket,diagnosis:analysis.diagnosis,context:patchPacket.payload.requirement_contract.input.verbatim_context,task:patchPacket.payload.requirement_contract.input.verbatim_task};
      const stage=await continueRoleTask({runId,role:"patch_engineer",workItemId:"patch.candidate.primary",inputBinding:contentHash({input:peInput,paths:selectedPaths}),task:JSON.stringify(peInput),baseEvidenceIds:refs,maxStepsPerCall:1,maxTotalSteps:12});
      const result=assertHorizontalStageComplete("patch_engineer",stage);
      out={content:JSON.stringify(result),validated_output:result,tool_loop:{observations:[],evidence_ids:refs,progress:null}};
    }else{
      out=await callReadOnlyRole("patch_engineer",{system:"Patch Engineer. Candidate only. Preserve the packet requirement contract; missing fields and semantic verification remain UNKNOWN. Never apply. JSON only.",user:JSON.stringify({patch_packet:patchPacket,diagnosis:analysis.diagnosis,context:patchPacket.payload.requirement_contract.input.verbatim_context,task:patchPacket.payload.requirement_contract.input.verbatim_task})},makeReadOnlyToolRuntime(targetRepo,runId),{baseEvidenceIds:refs,strictEvidenceRefs:true,runId});
    }
    const candidateResult=roleOutput(out,"patch_engineer");
    assertPatchRequirements(patchPacket,{operations:candidateResult.operations||[],repositoryRevision:snapshotRepo(targetRepo),sourceHashes:patchPacketSource(targetRepo,selectedPaths).preconditionHashes,availableEvidenceIds:patchPacketEvidenceRefs(analysis)});
    const patchEngineerRuntime={telemetry:out?.tool_loop?.telemetry||out?.tool_loop?.progress?.runtime_telemetry||null,selected_skill_ids:[...(out?.tool_loop?.selected_skill_ids||out?.control_plane?.selected_skill_ids||[])]};
    const candidate=patchService?patchService.create({repo:targetRepo,selectedPaths,task,result:candidateResult,patchPacket}):{...candidateResult,requirement_binding:patchPacket};
    let candidateVerification=await verifyCandidateBeforeApproval(runId,candidate);
    let finalCandidate=candidate,preapprovalRefix=null;
    if(candidateVerification.status==="FINAL_INVALID"&&candidateVerification.checks?.some(c=>c.status==="FAIL"&&c.executed===true)&&runtimeEvidence?.list&&runtimeEvidence?.write&&patchService?.create&&typeof externalReview?.hypothesis==="function"){
      if(runtimeEvidence.list(runId,{types:["preapproval_refix_attempt"],limit:128}).length===0){
        const failed=registerEvidenceList("LOCAL_RUNTIME",candidateVerification.checks.filter(c=>c.status==="FAIL"&&c.executed===true).map(reviewableVerificationCheck));
        const failedIds=evidenceIds(failed),admitted=mergeEvidenceIds(refs,failedIds);
        runtimeEvidence.write(runId,"preapproval_refix_attempt",{original_candidate_id:candidate.id,original_candidate_hash:candidate.candidate_hash,attempt:1,evidence_ids:failedIds});
        const diag=roleOutput(await callReadOnlyRole("diagnoser",{system:"Diagnose fresh failed candidate checks only. Preserve source and requirements. Every active hypothesis needs a concrete causal statement and falsification condition; retain INSUFFICIENT_EVIDENCE when the checks cannot support a hypothesis. JSON only; never apply.",user:JSON.stringify({patch_packet:patchPacket,failed_checks:evidencePromptView(failed),prior_candidate_id:candidate.id})},makeReadOnlyToolRuntime(targetRepo,runId),{baseEvidenceIds:admitted,strictEvidenceRefs:true,runId}),"diagnoser");
        // Re-diagnosis cannot bypass the existing hypothesis review boundary.
        const hypothesis={privacy_class:"PUBLIC",sanitized:true,opaque_evidence:true,statement:reviewableHypothesisStatement(diag),cause_class:String(diag?.cause_kind||"UNKNOWN"),evidence_count:admitted.length,local_evidence_count:failedIds.length,local_evidence:[],evidence_gap:false,evidence_status:"FINAL_VALID",evidence_gap_scope:null};
        const freshReview=await reviewWithLocalFallback("hypothesis",{privacy:{privacy_class:"PUBLIC",sanitized:true,opaque_evidence:true},hypothesis},async()=>roleOutput(await callReadOnlyRole("local_reviewer",{system:"Review fresh failed preapproval candidate diagnosis; PASS, FAIL or INSUFFICIENT_EVIDENCE. JSON only. Never apply.",user:JSON.stringify({hypothesis,diagnosis:diag,failed_checks:evidencePromptView(failed)})},makeReadOnlyToolRuntime(targetRepo,runId),{baseEvidenceIds:admitted,runId}),"local_reviewer"));
        const reviewVerdict=String((freshReview.external||freshReview.local)?.json?.verdict||"").toUpperCase();
        runtimeEvidence.write(runId,"preapproval_refix_review",{attempt:1,verdict:reviewVerdict||"MISSING",provider:freshReview.external?.provider||freshReview.local?.provider||"NONE"});
        if(reviewVerdict!=="PASS")throw new Error("PREAPPROVAL_REFIX_HYPOTHESIS_NOT_APPROVED");
        const patch=roleOutput(await callReadOnlyRole("patch_engineer",{system:"Repair failed preapproval candidate; one different candidate only, exact same paths, no apply. JSON only.",user:JSON.stringify({patch_packet:patchPacket,diagnosis:diag,failed_checks:evidencePromptView(failed),prior_candidate_id:candidate.id})},makeReadOnlyToolRuntime(targetRepo,runId),{baseEvidenceIds:admitted,strictEvidenceRefs:true,runId}),"patch_engineer");
        assertPatchRequirements(patchPacket,{operations:patch.operations||[],repositoryRevision:snapshotRepo(targetRepo),sourceHashes:patchPacketSource(targetRepo,selectedPaths).preconditionHashes,availableEvidenceIds:admitted});
        const next=patchService.create({repo:targetRepo,selectedPaths,task,result:patch,patchPacket,stage:"debug-preapproval-refix"});
        if(next.candidate_hash===candidate.candidate_hash)throw new Error("PREAPPROVAL_REFIX_NO_CANDIDATE_DELTA");
        const recheck=await verifyCandidateBeforeApproval(runId,next);
        preapprovalRefix={attempt:1,previous_candidate_id:candidate.id,failed_evidence_ids:failedIds,result_status:recheck.status};
        runtimeEvidence.write(runId,"preapproval_refix_result",preapprovalRefix);
        finalCandidate=next;candidateVerification=recheck;
      }
    }
    if(authority){let run=authority.load(runId);run=authority.transition(run,"PATCH_READY");authority.transition(run,"WAITING_APPROVAL");}
    runtimeEvidence?.write(runId,"patch_candidate",{id:finalCandidate.id,diff_hash:finalCandidate.diff_hash,summary:finalCandidate.summary,patch_packet_digest:patchPacket.packet_digest,patch_engineer_runtime:patchEngineerRuntime,preapproval_refix:preapprovalRefix});
    await logRuntime({run_id:runId,severity:"info",kind:"patch_candidate",candidate_id:finalCandidate.id,diff_hash:finalCandidate.diff_hash,patch_packet_digest:patchPacket.packet_digest,summary:finalCandidate.summary,state:"WAITING_APPROVAL"});
    return{run_id:runId,state:"WAITING_APPROVAL",candidate:finalCandidate,patch_packet:{schema:patchPacket.schema,packet_digest:patchPacket.packet_digest},patch_engineer_runtime:patchEngineerRuntime,candidate_verification:candidateVerification,preapproval_refix:preapprovalRefix};
  }

  function automaticRefixAttemptCount(runId){
    if(!runtimeEvidence||typeof runtimeEvidence.list!=="function")return null;
    return runtimeEvidence.list(runId,{types:["refix_attempt"],limit:128}).length;
  }
  async function automaticRefixCandidate({runId,run,out,targetRepo}){
    const prior=automaticRefixAttemptCount(runId);
    if(prior===null||!runtimeEvidence||typeof runtimeEvidence.write!=="function"||!targetRepo){
      if(authority)run=authority.transition(run,"ESCALATION_REQUIRED");
      await logRuntime({run_id:runId,severity:"error",kind:"automatic_refix",state:"REFIX_ESCALATION_REQUIRED",reason:"REFIX_EVIDENCE_OR_REPO_REQUIRED"});
      return{run_id:runId,state:"REFIX_ESCALATION_REQUIRED",reason:"REFIX_EVIDENCE_OR_REPO_REQUIRED",...out};
    }
    if(prior>=MAX_AUTOMATIC_REFIX_ATTEMPTS){
      if(authority)run=authority.transition(run,"ESCALATION_REQUIRED");
      runtimeEvidence.write(runId,"refix_escalation",{reason:"ATTEMPT_BUDGET_EXHAUSTED",attempts:prior,max_attempts:MAX_AUTOMATIC_REFIX_ATTEMPTS});
      await logRuntime({run_id:runId,severity:"warn",kind:"automatic_refix",state:"REFIX_ATTEMPT_BUDGET_EXHAUSTED",attempts:prior,max_attempts:MAX_AUTOMATIC_REFIX_ATTEMPTS});
      return{run_id:runId,state:"REFIX_ATTEMPT_BUDGET_EXHAUSTED",refix_attempts:prior,max_refix_attempts:MAX_AUTOMATIC_REFIX_ATTEMPTS,...out};
    }
    const selectedPaths=[...new Set((out?.candidate?.files||[]).map(String).filter(Boolean))];
    if(selectedPaths.length===0){
      if(authority)run=authority.transition(run,"ESCALATION_REQUIRED");
      runtimeEvidence.write(runId,"refix_escalation",{reason:"NO_SELECTED_PATHS",attempts:prior,max_attempts:MAX_AUTOMATIC_REFIX_ATTEMPTS});
      await logRuntime({run_id:runId,severity:"error",kind:"automatic_refix",state:"REFIX_ESCALATION_REQUIRED",reason:"NO_SELECTED_PATHS"});
      return{run_id:runId,state:"REFIX_ESCALATION_REQUIRED",reason:"NO_SELECTED_PATHS",...out};
    }
    if(authority)run=authority.transition(run,"RESOLVING");
    const attempt=prior+1;
    const retestRecords=registerEvidenceList("LOCAL_RUNTIME",[
      ...(out.checks||[]).map(reviewableVerificationCheck),
      {kind:"invariants",value:out.invariants},
      {kind:"gates",value:out.gates},
      {kind:"failed_candidate",value:{candidate_id:out?.candidate?.id||null,candidate_hash:out?.candidate?.candidate_hash||null,diff_hash:out?.candidate?.diff_hash||null,files:selectedPaths}}
    ]);
    const retestIds=evidenceIds(retestRecords);
    const currentCandidateId=out?.candidate?.id||null;
    const replay=runtimeEvidence.list(runId,{types:["refix_attempt"],limit:128}).some(record=>{
      const priorAttempt=record?.payload;
      return priorAttempt?.previous_candidate_id===currentCandidateId&&Array.isArray(priorAttempt.evidence_ids)&&priorAttempt.evidence_ids.length===retestIds.length&&priorAttempt.evidence_ids.every(id=>retestIds.includes(id));
    });
    if(replay){
      if(authority)run=authority.transition(run,"ESCALATION_REQUIRED");
      runtimeEvidence.write(runId,"refix_escalation",{reason:"NO_NEW_FAILURE_EVIDENCE",attempts:prior,previous_candidate_id:currentCandidateId,evidence_ids:retestIds});
      await logRuntime({run_id:runId,severity:"warn",kind:"automatic_refix",state:"REFIX_NO_NEW_FAILURE_EVIDENCE",attempts:prior});
      return{run_id:runId,state:"REFIX_NO_NEW_FAILURE_EVIDENCE",reason:"NO_NEW_FAILURE_EVIDENCE",refix_attempts:prior,max_refix_attempts:MAX_AUTOMATIC_REFIX_ATTEMPTS,...out};
    }
    runtimeEvidence.write(runId,"refix_attempt",{attempt,max_attempts:MAX_AUTOMATIC_REFIX_ATTEMPTS,previous_candidate_id:currentCandidateId,evidence_ids:retestIds});
    try{
      const previousPatchPacket=out?.candidate?.requirement_binding||null;
      if(previousPatchPacket)assertPatchRequirements(previousPatchPacket,{operations:out.candidate.operations||[]});
      const toolRuntime=makeReadOnlyToolRuntime(targetRepo,runId);
      const diagnosisCall=await callReadOnlyRole("diagnoser",{
        system:"Diagnoser. Re-diagnose only from the fresh failed deterministic retest evidence. Produce a falsifiable diagnosis. Never apply, publish, deploy, or bypass approval. JSON only.",
        user:JSON.stringify({task:"Repair the failed deterministic retest within the existing changed-file scope.",requirements:previousPatchPacket?.payload?.requirement_contract||null,failed_retest:evidencePromptView(retestRecords),selected_paths:selectedPaths,previous_candidate:{id:out?.candidate?.id||null,summary:out?.candidate?.summary||""}})
      },toolRuntime,{baseEvidenceIds:retestIds,strictEvidenceRefs:true,runId});
      const diagnosisJson=roleOutput(diagnosisCall,"diagnoser");
      const diagnosisToolEvidence=toolEvidenceRecords(diagnosisCall);
      const diagnosisToolIds=diagnosisToolEvidence.map(item=>item.evidence_id);
      const allIds=mergeEvidenceIds(retestIds,diagnosisToolIds);
      const hypothesis={privacy_class:"PUBLIC",sanitized:true,opaque_evidence:true,statement:reviewableHypothesisStatement(diagnosisJson),cause_class:String(diagnosisJson?.cause_kind||"UNKNOWN"),evidence_count:allIds.length,local_evidence_count:retestIds.length,local_evidence:[],evidence_gap:false,evidence_status:"FINAL_VALID",evidence_gap_scope:null};
      const review=await reviewWithLocalFallback("hypothesis",{privacy:{privacy_class:"PUBLIC",sanitized:true,opaque_evidence:true},hypothesis},async()=>roleOutput(await callReadOnlyRole("local_reviewer",{system:"Local Reviewer. Review the re-diagnosed hypothesis against fresh failed retest evidence. Return the existing review contract: verdict PASS, FAIL or INSUFFICIENT_EVIDENCE, decision DONE, BLOCKED or INSUFFICIENT_EVIDENCE, and claims array. JSON only. Never apply.",user:JSON.stringify({hypothesis,diagnosis:diagnosisJson,failed_retest:evidencePromptView(retestRecords)})},toolRuntime,{baseEvidenceIds:allIds,runId}),"local_reviewer"));
      const external=review.external,localHypothesis=review.local;
      const externalVerdict=String((external||localHypothesis)?.json?.verdict||"").toUpperCase();
      if(externalVerdict!=="PASS"){
        if(authority)run=authority.transition(run,"ESCALATION_REQUIRED");
        runtimeEvidence.write(runId,"refix_escalation",{reason:"HYPOTHESIS_NOT_APPROVED",attempt,external_verdict:externalVerdict||"MISSING",evidence_ids:allIds});
        await logRuntime({run_id:runId,severity:"warn",kind:"automatic_refix",state:"REFIX_HYPOTHESIS_NOT_APPROVED",attempt,external_verdict:externalVerdict||"MISSING"});
        return{run_id:runId,state:"REFIX_HYPOTHESIS_NOT_APPROVED",refix_attempt:attempt,max_refix_attempts:MAX_AUTOMATIC_REFIX_ATTEMPTS,external_hypothesis_review:external,local_hypothesis_review:localHypothesis,...out};
      }
      const refixRegistry=registrySummary({local:retestRecords});
      refixRegistry.tool_evidence_ids=diagnosisToolIds;
      refixRegistry.total_with_tools=refixRegistry.total+diagnosisToolIds.length;
      const refixAnalysis={run_id:runId,refix_attempt:attempt,deterministic_verification:{status:"FINAL_INVALID",checks:out.checks||[]},evidence_gap:false,evidence_status:"FINAL_VALID",evidence_registry:refixRegistry,diagnosis:diagnosisJson,external_hypothesis_review:external,local_hypothesis_review:localHypothesis,state:"HYPOTHESIS_APPROVED"};
      runtimeEvidence.write(runId,"analysis",refixAnalysis);
      runtimeEvidence.write(runId,"refix_analysis",refixAnalysis);
      const source=patchPacketSource(targetRepo,selectedPaths),inventory=verificationInventory(targetRepo);
      const patchPacket=makePatchPacket({runId,diagnosisRef:"diagnosis_"+contentHash(diagnosisJson||{}),repositoryRevision:snapshotRepo(targetRepo),paths:selectedPaths,sourceExcerpts:source.sourceExcerpts,preconditionHashes:source.preconditionHashes,reproductionSummary:{status:"FAILED_RETEST",checks:out.checks||[]},testInventory:inventory.checks,invariants:[{name:"fresh-retest-evidence",status:"PASS"},{name:"candidate-only-patch-engineer",status:"PASS"},{name:"explicit-approval-required",status:"PASS"},{name:"automatic-refix-bounded",status:"PASS",attempt,max_attempts:MAX_AUTOMATIC_REFIX_ATTEMPTS}],prohibitedPaths:source.prohibitedPaths,evidenceRefs:allIds,previousPatchPacket});
      runtimeEvidence.write(runId,"patch_packet",patchPacket);
      const patchCall=await callReadOnlyRole("patch_engineer",{
        system:"Patch Engineer. Produce one new candidate from the fresh failed-retest evidence. Candidate only. Never apply, publish, or deploy. Stay inside the existing selected paths. Do not create or delete files. JSON only.",
        user:JSON.stringify({patch_packet:patchPacket,diagnosis:diagnosisJson,failed_retest:evidencePromptView(retestRecords),task:"Repair failed deterministic retest within existing selected paths."})
      },toolRuntime,{baseEvidenceIds:allIds,strictEvidenceRefs:true,runId});
      const candidateResult=roleOutput(patchCall,"patch_engineer");
      const operations=Array.isArray(candidateResult?.operations)?candidateResult.operations:[];
      const allowed=new Set(selectedPaths);
      for(const operation of operations){
        const type=String(operation?.type||""),rel=String(operation?.path||"");
        if(!allowed.has(rel))throw new Error("REFIX_SCOPE_DRIFT:"+rel);
        if(type!=="replace"&&type!=="write")throw new Error("REFIX_OPERATION_FORBIDDEN:"+type);
      }
      assertPatchRequirements(patchPacket,{operations,repositoryRevision:snapshotRepo(targetRepo),sourceHashes:patchPacketSource(targetRepo,selectedPaths).preconditionHashes,availableEvidenceIds:allIds});
      const candidate=patchService.create({repo:targetRepo,selectedPaths,task:"Repair failed deterministic retest within existing selected paths.",result:candidateResult,stage:"debug-refix",patchPacket});
      const candidateVerification=await verifyCandidateBeforeApproval(runId,candidate);
      if(authority){run=authority.transition(run,"PATCH_READY");run=authority.transition(run,"WAITING_APPROVAL");}
      runtimeEvidence.write(runId,"patch_candidate",{id:candidate.id,diff_hash:candidate.diff_hash,summary:candidate.summary,patch_packet_digest:patchPacket.packet_digest,refix_attempt:attempt,previous_candidate_id:out?.candidate?.id||null});
      await logRuntime({run_id:runId,severity:"info",kind:"automatic_refix",state:"WAITING_APPROVAL",attempt,candidate_id:candidate.id,previous_candidate_id:out?.candidate?.id||null});
      return{run_id:runId,state:"WAITING_APPROVAL",refix_attempt:attempt,max_refix_attempts:MAX_AUTOMATIC_REFIX_ATTEMPTS,failed_candidate:out?.candidate||null,...out,candidate,candidate_verification:candidateVerification,patch_packet:{schema:patchPacket.schema,packet_digest:patchPacket.packet_digest},external_hypothesis_review:external,local_hypothesis_review:localHypothesis};
    }catch(error){
      const reason=String(error?.code||error?.message||error);
      if(authority&&run?.state==="RESOLVING"){try{run=authority.transition(run,"ESCALATION_REQUIRED");}catch{}}
      runtimeEvidence.write(runId,"refix_failure",{attempt,reason,previous_candidate_id:out?.candidate?.id||null});
      await logRuntime({run_id:runId,severity:"error",kind:"automatic_refix",state:"REFIX_ESCALATION_REQUIRED",attempt,reason});
      return{run_id:runId,state:"REFIX_ESCALATION_REQUIRED",reason,refix_attempt:attempt,max_refix_attempts:MAX_AUTOMATIC_REFIX_ATTEMPTS,...out};
    }
  }

  async function approveAndVerify({runId,candidateId,candidateHash,decision,repo}){
    if(!patchService)throw new Error("PATCH_SERVICE_REQUIRED");
    let run=null;if(authority)run=authority.load(runId);
    if(decision!=="approve"){if(authority)authority.transition(run,"BLOCKED");throw new Error("PATCH_APPROVAL_REQUIRED");}
    const horizontalFinal=authority?.durableEnabled?.()&&recoveryHooks?.enableHorizontalLocalReviewer===true;
    if(horizontalFinal){
      const saved=loadStageRef(runId,"approved_verification");
      if(saved){
        const context=saved.payload;
        if(context.candidate_id!==candidateId||context.candidate_hash!==candidateHash||
          path.resolve(String(repo||context.target_repo))!==path.resolve(String(context.target_repo))||
          snapshotRepo(context.target_repo)!==context.post_apply_repository_revision)
          throw new Error("FINAL_REVIEW_BINDING_MISMATCH");
        const completed=loadStageRef(runId,"approved_review_result");
        if(completed)return completed.payload;
        return finishApprovedVerification({runId,candidateId,candidateHash,decision,run,out:context.out,targetRepo:context.target_repo,postApplyRepositoryRevision:context.post_apply_repository_revision,horizontalFinal});
      }
    }
    // A human approval does not certify a candidate already proven broken in the isolated sandbox.
    const failedPreapproval=runtimeEvidence?.list?.(runId,{types:["candidate_verification"],limit:128})||[];
    if(failedPreapproval.some(entry=>{const check=entry.payload||entry;return check.patch_candidate_id===candidateId&&check.patch_candidate_hash===candidateHash&&check.status==="FINAL_INVALID"&&check.checks?.some(c=>c.executed===true&&c.status==="FAIL");})){
      runtimeEvidence?.write?.(runId,"approval_denied",{reason:"PREAPPROVAL_FAILED_CANDIDATE_APPLY_DENIED",candidate_id:candidateId,candidate_hash:candidateHash});
      throw new Error("PREAPPROVAL_FAILED_CANDIDATE_APPLY_DENIED");
    }
    if(authority)run=authority.transition(run,"APPLYING");
    let out;try{out=patchService.apply({candidateId,candidateHash,decision,repo});}catch(e){if(authority){try{authority.transition(run,"BLOCKED");}catch{}}throw e;}
    if(authority)run=authority.transition(run,"RETESTING");
    const targetRepo=out?.candidate?.repo||repo||null;
    const postApplyRepositoryRevision=targetRepo?snapshotRepo(targetRepo):null;
    runtimeEvidence?.write(runId,"verification",{checks:out.checks,invariants:out.invariants,gates:out.gates,pass:out.pass,post_apply_repository_revision:postApplyRepositoryRevision});
    await logRuntime({run_id:runId,severity:out.pass?"info":"error",kind:"verification",pass:out.pass,checks:out.checks,invariants:out.invariants,gates:out.gates,post_apply_repository_revision:postApplyRepositoryRevision});
    if(!out.pass){if(authority)run=authority.transition(run,"FAILED");return automaticRefixCandidate({runId,run,out,targetRepo});}
    if(horizontalFinal)await saveStage(runId,"approved_verification",{candidate_id:candidateId,candidate_hash:candidateHash,target_repo:targetRepo,post_apply_repository_revision:postApplyRepositoryRevision,out},WorkflowStepId.FINAL_ANALYSIS);
    return finishApprovedVerification({runId,candidateId,candidateHash,decision,run,out,targetRepo,postApplyRepositoryRevision,horizontalFinal});
  }
  async function finishApprovedVerification({runId,candidateId,candidateHash,decision,run,out,targetRepo,postApplyRepositoryRevision,horizontalFinal}){
    const verificationRecords=registerEvidenceList("LOCAL_RUNTIME",[...(out.checks||[]),{kind:"invariants",value:out.invariants},{kind:"gates",value:out.gates}]),verificationIds=evidenceIds(verificationRecords),executedTests=(out.checks||[]).filter(check=>check?.executed===true),receipt=out?.applied?.receipt||null;
    const reviewPacket=makeReviewPacket({candidateRef:candidateId,applyReceiptRef:String(receipt?.transaction_id||receipt?.candidate_id||""),repositoryRevision:postApplyRepositoryRevision,changedPaths:out?.candidate?.files||[],diff:out?.candidate?.diff||"",prePostHashes:reviewPacketHashes(out?.candidate,receipt),executedTests,testResults:out.checks||[],invariants:reviewPacketInvariants(out),evidenceRefs:verificationIds});
    runtimeEvidence?.write(runId,"review_packet",reviewPacket);
    let local_review;
    if(horizontalFinal){
      const reviewInput={review_packet:reviewPacket,verification_evidence:evidencePromptView(verificationRecords)};
      const stage=await continueRoleTask({runId,role:"local_reviewer",workItemId:`final.review.${candidateId}`,
        inputBinding:contentHash({candidateId,candidateHash,review_packet_digest:reviewPacket.packet_digest}),
        task:JSON.stringify(reviewInput),baseEvidenceIds:verificationIds,evidenceRecords:verificationRecords,maxStepsPerCall:1,maxTotalSteps:12});
      local_review=assertHorizontalStageComplete("local_reviewer",stage);
    }else{
      const lr=await callReadOnlyRole("local_reviewer",{system:"Local Reviewer. Review the local Review Packet from fresh context. JSON only.",user:JSON.stringify({review_packet:reviewPacket,verification_evidence:evidencePromptView(verificationRecords)})},makeReadOnlyToolRuntime(targetRepo,runId),{baseEvidenceIds:verificationIds,strictEvidenceRefs:true,runId});
      local_review=roleOutput(lr,"local_reviewer");
    }
    const publicReviewSummary=publicReviewPacketSummary(reviewPacket,{localVerdict:local_review.verdict||"UNKNOWN"});
    const finalReview=await reviewWithLocalFallback("final",{privacy:{privacy_class:"PUBLIC",sanitized:true,opaque_evidence:true},summary:publicReviewSummary},async()=>local_review);
    const final=finalReview.external,localFinal=finalReview.local;
    runtimeEvidence?.write(runId,"final_review_route",finalReview);
    const currentRepositoryRevision=targetRepo?snapshotRepo(targetRepo):null;
    const analysisEvidenceRecord=runtimeEvidence?.list?.(runId,{types:["analysis"],limit:1})?.[0]||null;
    const completion_gate=evaluateCompletionGate(buildCompletionGateInput({runId,runState:run?.state||"RETESTING",candidateId,candidateHash,decision,patchResult:out,postApplyRepositoryRevision,currentRepositoryRevision,localReview:local_review,externalFinal:final,localFinalFallback:localFinal,analysisEvidenceRecord}));
    runtimeEvidence?.write(runId,"completion_gate",completion_gate);
    const finalPass=String((final||localFinal)?.json?.verdict||"").toUpperCase()==="PASS",complete=completion_gate.complete;
    if(authority&&complete)run=authority.transition(run,"COMPLETE");
    else if(authority&&finalPass&&!complete)run=authority.transition(run,"BLOCKED");
    const state=complete?"COMPLETE":finalPass?"BLOCKED_COMPLETION_GATE":"AWAITING_EXTERNAL_FINAL_REVIEW";
    await logRuntime({run_id:runId,severity:complete?"info":"warn",kind:"final_review",state,local_verdict:local_review.verdict||"UNKNOWN",external_verdict:final?.json?.verdict||"UNAVAILABLE",review_provider:localFinal?.provider||final?.provider||null,unavailable_code:localFinal?.unavailable_code||null,completion_gate});
    const result={run_id:runId,state,...out,local_review,review_packet:{schema:reviewPacket.schema,packet_digest:reviewPacket.packet_digest},external_final_review:final,local_final_review:localFinal,completion_gate,post_apply_repository_revision:postApplyRepositoryRevision,current_repository_revision:currentRepositoryRevision};
    if(horizontalFinal){
      await saveStage(runId,"approved_review_result",result,WorkflowStepId.FINAL_ANALYSIS,{stepPhase:StepPhase.DONE});
      await setCursor(runId,WorkflowStepId.FINAL_ANALYSIS,StepPhase.DONE,{jobStatus:complete?"DONE":finalPass?"BLOCKED":"PAUSED"});
    }
    return result;
  }
  function resolveVerificationRepo(repo){if(!repoPolicy)throw new Error("VERIFY_REPO_POLICY_REQUIRED");return repoPolicy.assertRepo(repo);}
  function verificationScope(repo,selectedPaths){const paths=[...new Set((Array.isArray(selectedPaths)?selectedPaths:[]).map(String).filter(Boolean))];const files=paths.map(rel=>{const item=readText(repo,rel,{maxChars:1});return{path:item.path,sha256:item.sha256,size:item.size};});return{mode:files.length?"FILES":"REPOSITORY",files};}
  function verificationInventory(repo){try{return testInventory(repo);}catch(error){if(String(error?.message||error).includes("READ_FILE_NOT_FOUND:package.json"))return{package_json:null,package_manager:null,checks:[]};throw error;}}
  function verificationVerdict(deterministic,localReview,localReviewError){const checks=Array.isArray(deterministic?.checks)?deterministic.checks:[];if(checks.some(check=>check.status==="FAIL"))return"FAIL";if(deterministic?.status!=="FINAL_VALID"||checks.length===0)return"INSUFFICIENT_EVIDENCE";const local=String(localReview?.verdict||localReview?.decision||"").toUpperCase();if(local==="FAIL"||local==="REJECTED"||local==="BLOCKED")return"FAIL";if(localReviewError||!checks.every(check=>check.status==="PASS"))return"UNKNOWN";if(local==="PASS"||local==="APPROVED"||local==="ACCEPTED")return"PASS";return"UNKNOWN";}
  async function verifyReadOnly({repo,selectedPaths=[],changeScope=[],task=""}={}){if(!sandboxVerification)throw new Error("SANDBOX_VERIFICATION_REQUIRED");const targetRepo=resolveVerificationRepo(repo),verificationId=`verify_${crypto.randomUUID()}`;const scopeBefore=verificationScope(targetRepo,selectedPaths),inventory=verificationInventory(targetRepo);const deterministic=await sandboxVerification.collect(targetRepo),scopeAfter=verificationScope(targetRepo,selectedPaths);const changed=scopeBefore.files.filter((file,index)=>scopeAfter.files[index]?.sha256!==file.sha256).map(file=>file.path);const invariants={pass:changed.length===0,failures:changed.map(file=>`SOURCE_MUTATED:${file}`),checked_paths:scopeBefore.files.length,checked_receipts:0,authority:"READ_ONLY_SOURCE_IMMUTABILITY"};const reviewerChecks=deterministic.checks.map(reviewableVerificationCheck);const records=registerEvidenceList("LOCAL_RUNTIME",[...reviewerChecks,{kind:"test_inventory",value:inventory},{kind:"file_change_scope",value:{selected_paths:scopeBefore.files.map(x=>x.path),change_scope:Array.isArray(changeScope)?changeScope.map(String):[],task:String(task||"")}},{kind:"invariants",value:invariants}]),ids=evidenceIds(records);let local_review=null,local_review_error=null;try{const review=await runRoleWithReadOnlyTools({aiCore,role:"local_reviewer",system:"Local Reviewer. Review read-only deterministic verification from fresh context. JSON only. Never claim patch application.",user:JSON.stringify({verification_evidence:records}),toolRuntime:makeReadOnlyToolRuntime(targetRepo,verificationId),baseEvidenceIds:ids,strictEvidenceRefs:true});local_review=roleOutput(review,"local_reviewer");}catch(error){local_review_error=String(error?.code||error?.message||"LOCAL_REVIEW_UNAVAILABLE").split(":")[0];}const verdict=verificationVerdict(deterministic,local_review,local_review_error),result={schema:"debugai.verify-result/v1",verification_id:verificationId,read_only:true,patch_applied:false,repo:targetRepo,scope:{mode:scopeBefore.mode,files:scopeBefore.files,change_scope:Array.isArray(changeScope)?changeScope.map(String):[]},test_inventory:inventory,deterministic_verification:deterministic,invariants,local_review,local_review_error,verdict};runtimeEvidence?.write(verificationId,"read_only_verification",result);await logRuntime({run_id:verificationId,severity:verdict==="PASS"?"info":verdict==="FAIL"?"error":"warn",kind:"read_only_verification",verdict,check_count:deterministic.checks.length,patch_applied:false});return result;}
  function invocationStatus(runId){
    const latest=new Map();for(const record of runtimeEvidence?.list?.(runId,{types:["ai_invocation","tool_invocation"],limit:96})||[]){const value=record.payload;if(value?.invocation_id){const previous=latest.get(value.invocation_id);if(!previous||Number(value.event_sequence||0)>Number(previous.event_sequence||0))latest.set(value.invocation_id,value);}}
    return [...latest.values()].slice(0,8);
  }
  function durableStatus(runId){if(!authority?.durableEnabled?.())return null;try{const {state,manifest}=authority.loadDurable(runId);return{generation:state.generation,execution_epoch:state.execution_epoch,job_status:state.job_status,active_in_process:activeRuns.has(runId),last_execution_error:state.job_status==="DONE"?null:backgroundErrors.get(runId)||loadStageRef(runId,"last_execution_failure")?.payload?.code||null,last_execution_failure:loadStageRef(runId,"last_execution_failure")?.payload||null,role_invocations:invocationStatus(runId),workflow_cursor:manifest.workflow_cursor,role_executions:Object.fromEntries(Object.entries(manifest.role_execution_refs||{}).map(([id,ref])=>[id,{role:ref.role,status:ref.status,attempt_no:ref.attempt_no,latest_checkpoint_ref:ref.latest_checkpoint_ref||null,final_role_result_ref:ref.final_role_result_ref||null}]))};}catch(error){if(String(error?.message||error).includes("DURABLE_RECORD_NOT_FOUND")||String(error?.message||error).includes("ENOENT"))return null;throw error;}}
  function status(runId){if(!authority)throw new Error("RUN_AUTHORITY_REQUIRED");const run=authority.load(runId);return{schema:"debugai.run-status/v1",run_id:run.run_id,state:run.state,project_id:run.project_id,project_dir:run.project_dir,created_at:run.created_at,updated_at:run.updated_at,durable:durableStatus(runId)};}
  function inspect(runId){const run=status(runId),durable=run.durable;if(!runtimeEvidence)return{schema:"debugai.run-inspection/v1",run,durable,artifacts:{}};const records=runtimeEvidence.list(runId,{types:["analysis","workflow_progress","ai_invocation","tool_invocation","execution_failure","stage_reuse","patch_packet","patch_candidate","candidate_verification","verification","server_command","refix_attempt","refix_analysis","refix_failure","refix_escalation","review_packet","completion_gate","codegen_benchmark"],limit:16}),artifacts={};for(const record of records)if(!artifacts[record.type])artifacts[record.type]=record;if([WorkflowStepId.CODE_SCOUT,WorkflowStepId.CAUSAL_SCOUT].includes(durable?.workflow_cursor?.step_id)){const cursor=durable.workflow_cursor,progress=runtimeEvidence.list(runId,{types:["workflow_progress"],limit:16}).find(record=>record.payload?.step===cursor.step_id&&record.payload?.phase===cursor.step_phase);if(progress)artifacts.workflow_progress=progress;}return{schema:"debugai.run-inspection/v1",run,durable,artifacts};}
  function normalizeCodegenBenchmarkInput(input={}){
    if(!authority)throw new Error("RUN_AUTHORITY_REQUIRED");
    if(!patchService)throw new Error("PATCH_SERVICE_REQUIRED");
    if(!runtimeEvidence||typeof runtimeEvidence.write!=="function"||typeof runtimeEvidence.list!=="function")throw new Error("RUNTIME_EVIDENCE_REQUIRED");
    const repo=repoPolicy?repoPolicy.assertRepo(input.repo):path.resolve(String(input.repo||""));
    const level=String(input.level||"").trim(),caseId=String(input.case_id||"").trim();
    if(!["small","medium","hard"].includes(level))throw new Error("CODEGEN_BENCHMARK_LEVEL_INVALID");
    if(!/^[smh][0-9]{2}$/.test(caseId))throw new Error("CODEGEN_BENCHMARK_CASE_INVALID");
    const expectedPrefix=level==="small"?"s":level==="medium"?"m":"h";
    if(!caseId.startsWith(expectedPrefix))throw new Error("CODEGEN_BENCHMARK_CASE_LEVEL_MISMATCH");
    const selectedPaths=Array.isArray(input.selected_paths)?input.selected_paths.map(String):[];
    if(selectedPaths.length!==1||selectedPaths[0]!==`.debugai_codegen_benchmark/${caseId}.py`)throw new Error("CODEGEN_BENCHMARK_PATH_INVALID");
    const task=String(input.task||"").trim();
    if(!task||task.length>5000)throw new Error("CODEGEN_BENCHMARK_TASK_INVALID");
    const diagnosis=input.diagnosis&&typeof input.diagnosis==="object"&&!Array.isArray(input.diagnosis)?input.diagnosis:null;
    if(!diagnosis)throw new Error("CODEGEN_BENCHMARK_DIAGNOSIS_REQUIRED");
    return{repo,level,caseId,selectedPaths,task,diagnosis};
  }
  function codegenBenchmarkStatus(runId){
    if(!runtimeEvidence||typeof runtimeEvidence.list!=="function")throw new Error("RUNTIME_EVIDENCE_REQUIRED");
    const id=String(runId||"");
    if(!id)throw new Error("RUN_ID_REQUIRED");
    const record=runtimeEvidence.list(id,{types:["codegen_benchmark"],limit:1})?.[0]||null;
    if(!record)return{schema:"debugai.codegen-benchmark-status/v1",run_id:id,state:activeCodegenBenchmarks.has(id)?"RUNNING":"UNKNOWN"};
    return{schema:"debugai.codegen-benchmark-status/v1",run_id:id,...record.payload};
  }
  async function startCodegenBenchmark(input={}){
    const cfg=normalizeCodegenBenchmarkInput(input),startedAt=Date.now();
    const run=authority.start({rawRequest:cfg.task,repo:cfg.repo,projectId:"debug-ai-codegen-benchmark"});
    for(const state of ["PARSED","CONTEXT_READY","VERIFYING","FAILED","RESOLVING"])authority.transition(run,state);
    const runId=run.run_id;
    runtimeEvidence.write(runId,"codegen_benchmark",{state:"RUNNING",level:cfg.level,case_id:cfg.caseId,started_at:startedAt,finished_at:null,duration_ms:null,error:null,candidate:null});
    const analysis={deterministic_verification:{status:"FINAL_VALID",checks:[]},evidence_gap:false,evidence_status:"FINAL_VALID",evidence_registry:{evidence_ids:[],tool_evidence_ids:[]},diagnosis:cfg.diagnosis,external_hypothesis_review:{json:{verdict:"PASS"}}};
    const promise=(async()=>{
      try{
        const out=await patchCandidate({runId,analysis,repo:cfg.repo,selectedPaths:cfg.selectedPaths,context:cfg.task,task:cfg.task});
        const finishedAt=Date.now(),payload={state:"DONE",level:cfg.level,case_id:cfg.caseId,started_at:startedAt,finished_at:finishedAt,duration_ms:finishedAt-startedAt,error:null,candidate:out.candidate,patch_engineer_runtime:out.patch_engineer_runtime||null};
        runtimeEvidence.write(runId,"codegen_benchmark",payload);backgroundErrors.delete(runId);return payload;
      }catch(error){
        const finishedAt=Date.now(),code=String(error?.code||error?.message||error).slice(0,240),payload={state:"FAILED",level:cfg.level,case_id:cfg.caseId,started_at:startedAt,finished_at:finishedAt,duration_ms:finishedAt-startedAt,error:code,candidate:null};
        runtimeEvidence.write(runId,"codegen_benchmark",payload);backgroundErrors.set(runId,code);throw error;
      }finally{activeCodegenBenchmarks.delete(runId);}
    })();
    activeCodegenBenchmarks.set(runId,{promise,started_at:startedAt,level:cfg.level,case_id:cfg.caseId});
    void promise.catch(()=>{});
    return{schema:"debugai.codegen-benchmark-accepted/v1",run_id:runId,state:"RUNNING",level:cfg.level,case_id:cfg.caseId};
  }
  function investigationBenchmarkStatus(benchmarkId){
    if(!runtimeEvidence||typeof runtimeEvidence.list!=="function")throw new Error("RUNTIME_EVIDENCE_REQUIRED");
    const id=String(benchmarkId||"");if(!id)throw new Error("INVESTIGATION_BENCHMARK_ID_REQUIRED");
    const record=runtimeEvidence.list(id,{types:["investigation_benchmark"],limit:1})?.[0]||null;
    if(!record)return{schema:"debugai.investigation-benchmark-status/v1",benchmark_id:id,state:activeInvestigationBenchmarks.has(id)?"RUNNING":"UNKNOWN"};
    return{schema:"debugai.investigation-benchmark-status/v1",benchmark_id:id,...record.payload};
  }
  async function startInvestigationBenchmark({case_id:caseId}={}){
    if(!runtimeEvidence||typeof runtimeEvidence.write!=="function"||typeof runtimeEvidence.list!=="function")throw new Error("RUNTIME_EVIDENCE_REQUIRED");
    const known=new Set(listInvestigationBenchmarkCases().map(x=>x.id)),id=String(caseId||"");
    if(!known.has(id))throw new Error("INVESTIGATION_BENCHMARK_CASE_INVALID:"+id);
    const benchmarkId="invbench_"+crypto.randomUUID().replaceAll("-",""),startedAt=Date.now();
    runtimeEvidence.write(benchmarkId,"investigation_benchmark",{state:"RUNNING",case_id:id,started_at:startedAt,finished_at:null,duration_ms:null,error:null,result:null});
    const promise=(async()=>{try{
      const result=await runInvestigationBenchmarkCase({aiCore,caseId:id}),finishedAt=Date.now(),payload={state:"DONE",case_id:id,started_at:startedAt,finished_at:finishedAt,duration_ms:finishedAt-startedAt,error:null,result};
      runtimeEvidence.write(benchmarkId,"investigation_benchmark",payload);return payload;
    }catch(error){
      const finishedAt=Date.now(),code=String(error?.code||error?.message||error).slice(0,240),payload={state:"FAILED",case_id:id,started_at:startedAt,finished_at:finishedAt,duration_ms:finishedAt-startedAt,error:code,error_telemetry:error?.meta?.telemetry||null,error_meta:error?.meta?{timeout_ms:error.meta.timeout_ms??null,attempts:error.meta.attempts??null,timeout_class:error.meta.timeout_class??null,status:error.meta.status??null}:null,result:null};
      runtimeEvidence.write(benchmarkId,"investigation_benchmark",payload);throw error;
    }finally{activeInvestigationBenchmarks.delete(benchmarkId);}})();
    activeInvestigationBenchmarks.set(benchmarkId,{promise,started_at:startedAt,case_id:id});void promise.catch(()=>{});
    return{schema:"debugai.investigation-benchmark-accepted/v1",benchmark_id:benchmarkId,state:"RUNNING",case_id:id};
  }
  const MODEL_AB_ROLES=new Set(["code_scout","causal_scout","researcher","diagnoser","local_reviewer"]);
  const MODEL_AB_AXES=new Set(["temperature","top_p","top_k","max_tokens"]);
  function modelAbBenchmarkStatus(benchmarkId){
    if(!runtimeEvidence||typeof runtimeEvidence.list!=="function")throw new Error("RUNTIME_EVIDENCE_REQUIRED");
    const id=String(benchmarkId||"");if(!id)throw new Error("MODEL_AB_BENCHMARK_ID_REQUIRED");
    const record=runtimeEvidence.list(id,{types:["model_ab_benchmark"],limit:1})?.[0]||null;
    if(!record)return{schema:"debugai.model-ab-benchmark-status/v1",benchmark_id:id,state:activeModelAbBenchmarks.has(id)?"RUNNING":"UNKNOWN"};
    return{schema:"debugai.model-ab-benchmark-status/v1",benchmark_id:id,...record.payload};
  }
  function modelAbQueuedCaller(){
    if(typeof aiCore.callPrepared!=="function")throw new Error("AI_CORE_PREPARED_MEASUREMENT_REQUIRED");
    const caller=async({role,config,system,user})=>{
      const budget=getRoleRuntimeBudget(role);
      const out=await aiCore.callPrepared(role,{system,user,maxTokens:config.max_tokens,temperature:config.temperature,topP:Number.isFinite(config.top_p)?config.top_p:null,topK:Number.isInteger(config.top_k)?config.top_k:null,timeoutMsOverride:budget.turn_timeout_ms,queueTimeoutMs:budget.turn_timeout_ms});
      const usage=out?.raw?.usage||{};
      return{content:out.content,finish_reason:out?.raw?.choices?.[0]?.finish_reason??out?.telemetry?.finish_reason??null,usage:{prompt_tokens:Number.isFinite(usage.prompt_tokens)?usage.prompt_tokens:null,completion_tokens:Number.isFinite(usage.completion_tokens)?usage.completion_tokens:null,total_tokens:Number.isFinite(usage.total_tokens)?usage.total_tokens:null},runtime_telemetry:out.telemetry||null};
    };
    caller.runtime_context_tokens=aiCore.runtime_context_tokens??null;
    if(Number.isSafeInteger(caller.runtime_context_tokens)&&caller.runtime_context_tokens>0)caller.qualify_variant=(role,axis,variant)=>qualifyVariantForRuntime(role,axis,variant,caller.runtime_context_tokens);
    return caller;
  }
  async function startModelAbBenchmark({role,axis,candidate="official",repeats=1}={}){
    if(!runtimeEvidence||typeof runtimeEvidence.write!=="function"||typeof runtimeEvidence.list!=="function")throw new Error("RUNTIME_EVIDENCE_REQUIRED");
    const r=String(role||""),a=String(axis||"");if(!MODEL_AB_ROLES.has(r))throw new Error("MODEL_AB_ROLE_INVALID:"+r);if(!MODEL_AB_AXES.has(a))throw new Error("MODEL_AB_AXIS_INVALID:"+a);
    if(r==="patch_engineer")throw new Error("MODEL_AB_PATCH_ENGINEER_DEFERRED");
    if(a!=="max_tokens"&&candidate!=="official")throw new Error("MODEL_AB_OFFICIAL_CANDIDATE_REQUIRED");
    if(a==="max_tokens"&&(!Number.isInteger(Number(candidate))||Number(candidate)<64))throw new Error("MODEL_AB_MAX_TOKENS_CANDIDATE_INVALID");
    const n=Number(repeats);if(!Number.isInteger(n)||n<1||n>3)throw new Error("MODEL_AB_REPEATS_INVALID");
    if(activeModelAbBenchmarks.size>0)throw new Error("MODEL_AB_BENCHMARK_ALREADY_RUNNING");
    const benchmarkId="modelab_"+crypto.randomUUID().replaceAll("-",""),startedAt=Date.now();
    runtimeEvidence.write(benchmarkId,"model_ab_benchmark",{state:"RUNNING",role:r,axis:a,candidate,started_at:startedAt,finished_at:null,duration_ms:null,error:null,result:null});
    const promise=(async()=>{try{
      const result=await runModelAbBenchmark({role:r,axis:a,candidate,repeats:n,callModel:modelAbQueuedCaller()}),finishedAt=Date.now(),payload={state:"DONE",role:r,axis:a,candidate,started_at:startedAt,finished_at:finishedAt,duration_ms:finishedAt-startedAt,error:null,result};
      runtimeEvidence.write(benchmarkId,"model_ab_benchmark",payload);return payload;
    }catch(error){
      const finishedAt=Date.now(),code=String(error?.code||error?.message||error).slice(0,240),payload={state:"FAILED",role:r,axis:a,candidate,started_at:startedAt,finished_at:finishedAt,duration_ms:finishedAt-startedAt,error:code,result:null};
      runtimeEvidence.write(benchmarkId,"model_ab_benchmark",payload);throw error;
    }finally{activeModelAbBenchmarks.delete(benchmarkId);}})();
    activeModelAbBenchmarks.set(benchmarkId,{promise,started_at:startedAt,role:r,axis:a});void promise.catch(()=>{});
    return{schema:"debugai.model-ab-benchmark-accepted/v1",benchmark_id:benchmarkId,state:"RUNNING",role:r,axis:a,candidate};
  }
  async function promote(asset){assertPromotable(asset);if(!tgserver)throw new Error("TGSERVER_ADAPTER_REQUIRED");return tgserver.promote(asset);}
  async function searchKnowledge(query,opts={}){if(!tgserver)throw new Error("TGSERVER_ADAPTER_REQUIRED");return tgserver.search(query,opts);}
  return{continueRoleTask,continueDiagnoserTask,runAnalysis,startAnalysis,resumeAnalysis,recoverStartup,patchCandidate,startCodegenBenchmark,codegenBenchmarkStatus,startInvestigationBenchmark,investigationBenchmarkStatus,startModelAbBenchmark,modelAbBenchmarkStatus,approveAndVerify,verifyReadOnly,status,inspect,promote,searchKnowledge};
}
module.exports={createWorkflow,parseJson,roleOutput,toolEvidenceRecords,toolAudit,pickDiagnosisStatement,publicLocalEvidence,dapFailureChecks,activeDapHint,dapHintProtocol,reviewStreamEvidence,reviewableVerificationCheck,evidencePromptView,repositorySnapshotId};
