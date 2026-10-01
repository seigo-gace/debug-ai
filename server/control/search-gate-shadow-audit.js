"use strict";

const ASSESSMENT=Object.freeze({NOT_EVALUABLE:"NOT_EVALUABLE",ZERO_OBSERVED:"ZERO_OBSERVED",DETECTED:"DETECTED"});

function records(value){return Array.isArray(value)?value:[];}
function assertRecord(record){
  if(!record||record.schema!=="debugai.search-gate-shadow-comparison/v1")throw new Error("SEARCH_GATE_SHADOW_RECORD_INVALID");
  if(typeof record.search_kind!=="string"||!record.search_kind)throw new Error("SEARCH_GATE_SHADOW_KIND_REQUIRED");
  if(record.actual_search_executed!==true)throw new Error("SEARCH_GATE_SHADOW_ACTUAL_SEARCH_REQUIRED");
  if(typeof record.candidate_skip!=="boolean")throw new Error("SEARCH_GATE_SHADOW_CANDIDATE_SKIP_REQUIRED");
  if(typeof record.false_skip_evaluable!=="boolean")throw new Error("SEARCH_GATE_SHADOW_EVALUABLE_REQUIRED");
  if(record.false_skip_evaluable===false&&record.false_skip!==null)throw new Error("SEARCH_GATE_SHADOW_UNEVALUABLE_FALSE_SKIP_MUST_BE_NULL");
  if(record.false_skip_evaluable===true&&typeof record.false_skip!=="boolean")throw new Error("SEARCH_GATE_SHADOW_FALSE_SKIP_BOOLEAN_REQUIRED");
  return record;
}
function summarizeSearchGateShadow(value){
  const input=records(value).map(assertRecord),byKind={};let candidateSkips=0,evaluableCandidateSkips=0,falseSkips=0;
  for(const record of input){
    const bucket=byKind[record.search_kind]||(byKind[record.search_kind]={records:0,candidate_skips:0,evaluable_candidate_skips:0,false_skips:0,success:0,not_final:0,error:0});
    bucket.records++;
    if(record.actual_status==="SUCCESS")bucket.success++;else if(record.actual_status==="NOT_FINAL")bucket.not_final++;else bucket.error++;
    if(record.candidate_skip){candidateSkips++;bucket.candidate_skips++;if(record.false_skip_evaluable){evaluableCandidateSkips++;bucket.evaluable_candidate_skips++;if(record.false_skip){falseSkips++;bucket.false_skips++;}}}
  }
  let falseSkipAssessment=ASSESSMENT.NOT_EVALUABLE;
  if(candidateSkips>0&&evaluableCandidateSkips===candidateSkips)falseSkipAssessment=falseSkips===0?ASSESSMENT.ZERO_OBSERVED:ASSESSMENT.DETECTED;
  return Object.freeze({
    schema:"debugai.search-gate-shadow-audit/v1",
    records:input.length,
    candidate_skip_observations:candidateSkips,
    evaluable_candidate_skip_observations:evaluableCandidateSkips,
    false_skip_observations:falseSkips,
    false_skip_assessment:falseSkipAssessment,
    by_kind:Object.freeze(byKind),
    activation_decision:"NOT_AUTHORIZED_BY_SHADOW_AUDIT",
  });
}

module.exports={ASSESSMENT,assertRecord,summarizeSearchGateShadow};
