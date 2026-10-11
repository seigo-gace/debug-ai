"use strict";

function asIdSet(values){
  const out=new Set();
  for(const value of values||[]){
    const id=String(value||"");
    if(id)out.add(id);
  }
  return out;
}

function restoredEvidence(initialState){
  const direct=Array.isArray(initialState?.seen_evidence_ids)?initialState.seen_evidence_ids:[];
  if(direct.length)return direct;
  const fromHistory=[];
  for(const item of initialState?.history||[])for(const id of item?.new_evidence_ids||[])fromHistory.push(id);
  return fromHistory;
}

function createProgressController({maxNoProgressRounds=1,initialState=null,requireQualifiedProgress=false,verifyQualifiedProgress=null,qualificationBinding=null}={}){
  if(requireQualifiedProgress&&typeof verifyQualifiedProgress!=="function")throw new Error("PROGRESS_QUALIFICATION_VERIFIER_REQUIRED");
  if(typeof requireQualifiedProgress!=="boolean")throw new Error("PROGRESS_QUALIFICATION_MODE_INVALID");
  if(initialState?.require_qualified_progress!==undefined&&initialState.require_qualified_progress!==requireQualifiedProgress)throw new Error("PROGRESS_QUALIFICATION_POLICY_MISMATCH");
  if(initialState&&(initialState.qualification_binding??null)!==qualificationBinding)throw new Error("PROGRESS_QUALIFICATION_BINDING_MISMATCH");
  if(!Number.isInteger(maxNoProgressRounds)||maxNoProgressRounds<0||maxNoProgressRounds>3)throw new Error("PROGRESS_NO_PROGRESS_LIMIT_INVALID");
  if(initialState!==null&&(typeof initialState!=="object"||Array.isArray(initialState)))throw new Error("PROGRESS_INITIAL_STATE_INVALID");
  if(initialState?.max_no_progress_rounds!==undefined&&initialState.max_no_progress_rounds!==maxNoProgressRounds)throw new Error("PROGRESS_POLICY_MISMATCH");

  const seenEvidence=asIdSet(restoredEvidence(initialState));
  const completedWork=asIdSet(initialState?.completed_work_ids);
  const completedEffects=asIdSet(initialState?.completed_effect_ids);
  const qualifiedProgress=asIdSet(initialState?.qualified_progress_ids);
  let noProgressRounds=Number.isInteger(initialState?.no_progress_rounds)?initialState.no_progress_rounds:0;
  if(noProgressRounds<0||noProgressRounds>maxNoProgressRounds+1)throw new Error("PROGRESS_INITIAL_NO_PROGRESS_INVALID");
  const history=Array.isArray(initialState?.history)?initialState.history.map(x=>({
    ...x,
    new_evidence_ids:[...(x?.new_evidence_ids||[])],
    new_work_ids:[...(x?.new_work_ids||[])],
    new_effect_ids:[...(x?.new_effect_ids||[])],
  })):[];
  if(history.length>64)throw new Error("PROGRESS_HISTORY_TOO_LARGE");

  function collectFresh(target,values){
    const fresh=[];
    for(const value of values||[]){
      const id=String(value||"");
      if(!id||target.has(id))continue;
      target.add(id);
      fresh.push(id);
    }
    return fresh;
  }

  function observe({evidenceIds=[],completedWorkIds=[],completedEffectIds=[],qualifiedProgressIds=[]}={}){
    const freshEvidence=collectFresh(seenEvidence,evidenceIds);
    const freshWork=collectFresh(completedWork,completedWorkIds);
    const freshEffects=collectFresh(completedEffects,completedEffectIds);
    const candidates=asIdSet(qualifiedProgressIds);
    const verified=[];
    for(const id of candidates){
      // IDs alone are not authority: the caller must provide a trusted,
      // deterministic task-bound verifier. A false result cannot reset stall.
      if(requireQualifiedProgress&&verifyQualifiedProgress({id,roleEvidenceIds:[...seenEvidence],completedWorkIds:[...completedWork],completedEffectIds:[...completedEffects]})!==true)continue;
      verified.push(id);
    }
    const freshQualified=collectFresh(qualifiedProgress,verified);
    // Collect raw evidence as before, but never treat its mere creation as
    // task progress in the explicitly qualified mode. The caller must supply
    // independently verified, task-bound progress identities.
    const progressDelta=requireQualifiedProgress?freshQualified.length:freshEvidence.length+freshWork.length+freshEffects.length;
    if(progressDelta===0)noProgressRounds++;else noProgressRounds=0;
    const stop=noProgressRounds>maxNoProgressRounds;
    const state={
      new_evidence_delta:freshEvidence.length,
      new_evidence_ids:freshEvidence,
      new_work_delta:freshWork.length,
      new_work_ids:freshWork,
      new_effect_delta:freshEffects.length,
      new_qualified_progress_delta:freshQualified.length,
      new_qualified_progress_ids:freshQualified,
      new_effect_ids:freshEffects,
      progress_delta:progressDelta,
      no_progress_rounds:noProgressRounds,
      total_evidence_ids:seenEvidence.size,
      total_work_ids:completedWork.size,
      total_effect_ids:completedEffects.size,
      total_qualified_progress_ids:qualifiedProgress.size,
      stop,
      decision:stop?"HANDOFF_OR_INSUFFICIENT_EVIDENCE":"CONTINUE",
    };
    history.push(state);
    if(history.length>64)history.shift();
    return state;
  }

  function snapshot(){
    return {
      max_no_progress_rounds:maxNoProgressRounds,
      require_qualified_progress:requireQualifiedProgress,
      qualification_binding:qualificationBinding,
      no_progress_rounds:noProgressRounds,
      total_evidence_ids:seenEvidence.size,
      total_work_ids:completedWork.size,
      total_effect_ids:completedEffects.size,
      seen_evidence_ids:[...seenEvidence].sort(),
      completed_work_ids:[...completedWork].sort(),
      completed_effect_ids:[...completedEffects].sort(),
      total_qualified_progress_ids:qualifiedProgress.size,
      qualified_progress_ids:[...qualifiedProgress].sort(),
      history:history.map(x=>({
        ...x,
        new_evidence_ids:[...(x.new_evidence_ids||[])],
        new_work_ids:[...(x.new_work_ids||[])],
        new_effect_ids:[...(x.new_effect_ids||[])],
        new_qualified_progress_ids:[...(x.new_qualified_progress_ids||[])],
      })),
    };
  }

  return {observe,snapshot};
}

module.exports={createProgressController};
