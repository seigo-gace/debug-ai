"use strict";
const {performance}=require("node:perf_hooks");
const {fetch:undiciFetch,Agent}=require("undici");
const {ROLES}=require("../roles.js");
const {compileInvocation}=require("./invocation-compiler.js");

const SCHEMA="debugai.diagnoser-skill-effect-benchmark/v1";
const ROLE="diagnoser";
// Real thinking-enabled reproduction exhausted 600 and 800 tokens; 1024 completed at 911.
// This is the fixed benchmark allowance, not a production profile change.
const MAX_TOKENS=1024;
const OUTPUT_POLICY="Return JSON only with exactly these top-level keys: diagnosis_status, hypotheses, confirmed_root_cause, unsupported_claims. diagnosis_status must be HYPOTHESES_RETAINED, NO_ACTIVE_HYPOTHESIS, or INSUFFICIENT_EVIDENCE. hypotheses must be an ordered array of objects with exactly id, evidence_refs, falsification_condition, counter_evidence_refs, status. status must be HYPOTHESIS, REJECTED, or UNKNOWN. confirmed_root_cause must be null unless supplied evidence proves the full causal chain. Use only supplied evidence_id values. Return verifiable artifacts only; never expose raw chain-of-thought.";

const CASES=Object.freeze([
  Object.freeze({
    id:"competing_falsifiable_hypotheses",
    skills:Object.freeze(["hypothesis-falsification","cross-refutation","evidence-sufficiency-assessment"]),
    expected:Object.freeze({diagnosis_status:"HYPOTHESES_RETAINED",hypotheses:Object.freeze([
      Object.freeze({id:"H_DOWNSTREAM_STALL",evidence_refs:Object.freeze(["E_TIMEOUT"]),falsification_condition:"downstream_response_before_deadline",counter_evidence_refs:Object.freeze(["E_QUEUE_HEALTHY"]),status:"HYPOTHESIS"}),
      Object.freeze({id:"H_NETWORK_PATH",evidence_refs:Object.freeze(["E_TIMEOUT"]),falsification_condition:"network_path_healthy_during_request",counter_evidence_refs:Object.freeze([]),status:"HYPOTHESIS"}),
    ]),confirmed_root_cause:null,unsupported_claims:Object.freeze([])}),
    input:Object.freeze({failure:"request deadline exceeded",evidence:Object.freeze([
      Object.freeze({evidence_id:"E_TIMEOUT",claim:"request started and no downstream response arrived before deadline"}),
      Object.freeze({evidence_id:"E_QUEUE_HEALTHY",claim:"local work queue remained healthy during the request"}),
    ]),history:Object.freeze([])}),
  }),
  Object.freeze({
    id:"cross_refutation",
    skills:Object.freeze(["hypothesis-falsification","cross-refutation","evidence-sufficiency-assessment"]),
    expected:Object.freeze({diagnosis_status:"HYPOTHESES_RETAINED",hypotheses:Object.freeze([
      Object.freeze({id:"H_CACHE_BUG",evidence_refs:Object.freeze(["E_CACHE_HIT"]),falsification_condition:"stale_value_persists_when_cache_bypassed",counter_evidence_refs:Object.freeze(["E_BYPASS_STALE"]),status:"REJECTED"}),
      Object.freeze({id:"H_UPSTREAM_STALE",evidence_refs:Object.freeze(["E_BYPASS_STALE"]),falsification_condition:"upstream_response_fresh",counter_evidence_refs:Object.freeze([]),status:"HYPOTHESIS"}),
    ]),confirmed_root_cause:null,unsupported_claims:Object.freeze([])}),
    input:Object.freeze({failure:"stale value returned",evidence:Object.freeze([
      Object.freeze({evidence_id:"E_CACHE_HIT",claim:"a cache hit correlated with one stale response"}),
      Object.freeze({evidence_id:"E_BYPASS_STALE",claim:"the same stale value persisted when the cache was bypassed"}),
    ]),history:Object.freeze([])}),
  }),
  Object.freeze({
    id:"rejected_hypothesis_avoidance",
    skills:Object.freeze(["hypothesis-falsification","evidence-sufficiency-assessment","rejected-hypothesis-avoidance"]),
    expected:Object.freeze({diagnosis_status:"NO_ACTIVE_HYPOTHESIS",hypotheses:Object.freeze([
      Object.freeze({id:"H_SERIALIZER",evidence_refs:Object.freeze([]),falsification_condition:"serializer_path_observed_in_failing_run",counter_evidence_refs:Object.freeze(["E_TRACE_NO_SERIALIZER"]),status:"REJECTED"}),
    ]),confirmed_root_cause:null,unsupported_claims:Object.freeze([])}),
    input:Object.freeze({failure:"response payload is stale",evidence:Object.freeze([Object.freeze({evidence_id:"E_TRACE_NO_SERIALIZER",claim:"failing runtime trace never entered the serializer path"})]),history:Object.freeze([Object.freeze({hypothesis_id:"H_SERIALIZER",status:"REJECTED",rejection_evidence_refs:Object.freeze(["E_TRACE_NO_SERIALIZER"]),new_evidence:false})])}),
  }),
  Object.freeze({
    id:"correlation_insufficient",
    skills:Object.freeze(["hypothesis-falsification","cross-refutation","evidence-sufficiency-assessment"]),
    expected:Object.freeze({diagnosis_status:"INSUFFICIENT_EVIDENCE",hypotheses:Object.freeze([
      Object.freeze({id:"H_DATABASE_LATENCY",evidence_refs:Object.freeze(["E_LATENCY_CORRELATION"]),falsification_condition:"timeout_occurs_without_database_latency",counter_evidence_refs:Object.freeze([]),status:"UNKNOWN"}),
    ]),confirmed_root_cause:null,unsupported_claims:Object.freeze(["database_latency_caused_timeout"])}),
    input:Object.freeze({failure:"request timeout",evidence:Object.freeze([
      Object.freeze({evidence_id:"E_LATENCY_CORRELATION",claim:"database latency and request timeout increased during the same interval"}),
      Object.freeze({evidence_id:"E_CAUSAL_EDGE_MISSING",claim:"no trace links database completion time to the request deadline"}),
    ]),history:Object.freeze([])}),
  }),
]);

function parseJson(content){const text=String(content||"").trim().replace(/^```json\s*/i,"").replace(/```$/i,"").trim();return JSON.parse(text);}
function withoutSkillDirectives(system){return String(system).split("\n").filter(line=>!line.startsWith("SKILL_SELECTION=")&&!line.startsWith("SELECTED_SKILLS=")&&!line.includes(" procedure=")).join("\n");}
function buildSystemsForCase(testCase){const compiled=compileInvocation(ROLE,{task:"retain competing falsifiable hypotheses search counter evidence preserve rejected hypotheses assess evidence sufficiency",extraSystem:OUTPUT_POLICY,selectedSkillIds:[...testCase.skills]});return {on:compiled.system,off:withoutSkillDirectives(compiled.system),selected_skill_ids:[...compiled.selected_skill_ids]};}
function sameArray(a,b){return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((x,i)=>x===b[i]);}
function scoreCase(testCase,value){
  const allowed=new Set(testCase.input.evidence.map(x=>x.evidence_id));const actual=Array.isArray(value?.hypotheses)?value.hypotheses:[];const expected=testCase.expected.hypotheses;let score=0;const checks={};
  checks.diagnosis_status=value?.diagnosis_status===testCase.expected.diagnosis_status;if(checks.diagnosis_status)score+=1;
  checks.hypothesis_set=actual.length===expected.length&&actual.every((x,i)=>x?.id===expected[i].id);if(checks.hypothesis_set)score+=1;
  checks.evidence_bindings=actual.length===expected.length&&actual.every((x,i)=>sameArray(x?.evidence_refs,expected[i].evidence_refs)&&x.evidence_refs.every(ref=>allowed.has(ref)));if(checks.evidence_bindings)score+=1;
  checks.falsification=actual.length===expected.length&&actual.every((x,i)=>x?.falsification_condition===expected[i].falsification_condition&&sameArray(x?.counter_evidence_refs,expected[i].counter_evidence_refs)&&x.counter_evidence_refs.every(ref=>allowed.has(ref)));if(checks.falsification)score+=1;
  const unsupported=Array.isArray(value?.unsupported_claims)?value.unsupported_claims.map(String):[];checks.safety=actual.length===expected.length&&actual.every((x,i)=>x?.status===expected[i].status)&&(value?.confirmed_root_cause??null)===testCase.expected.confirmed_root_cause&&sameArray(unsupported,testCase.expected.unsupported_claims);if(checks.safety)score+=1;
  return {score,max_score:5,checks,diagnosis_status:String(value?.diagnosis_status||""),hypotheses:actual,confirmed_root_cause:value?.confirmed_root_cause??null,unsupported_claims:unsupported};
}
function defaultClient({baseUrl=process.env.DEBUG_AI_CORE_URL,apiKey=process.env.AI_CORE_API_KEY,fetchImpl=undiciFetch,timeoutMs=600000}={}){
  if(!baseUrl)throw new Error("AI_CORE_URL_REQUIRED");if(!apiKey)throw new Error("AI_CORE_API_KEY_REQUIRED");const endpoint=new URL("/v1/chat/completions",baseUrl).toString();const dispatcher=new Agent({headersTimeout:timeoutMs+5000,bodyTimeout:timeoutMs+5000});
  return async function callModel({system,user}){const ctl=new AbortController();const timer=setTimeout(()=>ctl.abort(),timeoutMs);try{const r=await fetchImpl(endpoint,{method:"POST",headers:{authorization:`Bearer ${apiKey}`,"content-type":"application/json"},body:JSON.stringify({model:ROLES[ROLE].backend_model,messages:[{role:"system",content:system},{role:"user",content:user}],max_tokens:MAX_TOKENS,temperature:0,stream:false,response_format:{type:"json_object"},chat_template_kwargs:{enable_thinking:ROLES[ROLE].thinking}}),signal:ctl.signal,dispatcher});const text=await r.text();if(!r.ok)throw new Error(`AI_CORE_HTTP_${r.status}:${text.slice(0,300)}`);const envelope=JSON.parse(text),choice=envelope?.choices?.[0],content=choice?.message?.content;if(choice?.finish_reason==="length"){const error=new Error("AI_CORE_OUTPUT_TRUNCATED");error.code="AI_CORE_OUTPUT_TRUNCATED";error.benchmark_metadata=Object.freeze({role:ROLE,max_tokens:MAX_TOKENS,finish_reason:"length",completion_tokens:Number.isFinite(envelope?.usage?.completion_tokens)?envelope.usage.completion_tokens:null,content_chars:typeof content==="string"?content.length:null});throw error;}if(typeof content!=="string"||!content.trim())throw new Error("AI_CORE_EMPTY");return{content};}finally{clearTimeout(timer);}};
}
async function runDiagnoserSkillEffectBenchmark({callModel=defaultClient(),clock=performance}={}){const results=[],totals={on:0,off:0,max:CASES.length*5};const started=clock.now();for(const testCase of CASES){const systems=buildSystemsForCase(testCase);const user=JSON.stringify({benchmark_case:testCase.id,...testCase.input});const pair={case_id:testCase.id,selected_skill_ids:systems.selected_skill_ids};for(const mode of ["off","on"]){const t0=clock.now();const reply=await callModel({mode,system:systems[mode],user,case:testCase});const parsed=parseJson(reply.content);const scored=scoreCase(testCase,parsed);pair[mode]={...scored,elapsed_ms:Math.max(0,Math.round(clock.now()-t0)),output:parsed};totals[mode]+=scored.score;}results.push(pair);}const delta=totals.on-totals.off;return{schema:SCHEMA,authority:"MEASUREMENT_ONLY",completed:true,role:ROLE,model:ROLES[ROLE].backend_model,temperature:0,token_budget:MAX_TOKENS,skill_selection_boundary:"MAX_3_PER_INVOCATION",cases:results,score:{skill_on:totals.on,skill_off:totals.off,max:totals.max,delta,winner:delta>0?"SKILL_ON":delta<0?"SKILL_OFF":"TIE",effect_demonstrated:delta>0},elapsed_ms:Math.max(0,Math.round(clock.now()-started))};}
async function cli(){try{process.stdout.write(`${JSON.stringify(await runDiagnoserSkillEffectBenchmark(),null,2)}\n`);}catch(error){process.stdout.write(`${JSON.stringify({schema:SCHEMA,authority:"MEASUREMENT_ONLY",completed:false,error:String(error?.message||error)},null,2)}\n`);process.exitCode=1;}}
if(require.main===module)void cli();
module.exports={SCHEMA,ROLE,MAX_TOKENS,CASES,OUTPUT_POLICY,parseJson,withoutSkillDirectives,buildSystemsForCase,scoreCase,defaultClient,runDiagnoserSkillEffectBenchmark};
