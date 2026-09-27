"use strict";

function createProgressController({maxNoProgressRounds=1}={}){
  if(!Number.isInteger(maxNoProgressRounds)||maxNoProgressRounds<0||maxNoProgressRounds>3)throw new Error("PROGRESS_NO_PROGRESS_LIMIT_INVALID");
  const seenEvidence=new Set();
  let noProgressRounds=0;
  const history=[];
  function observe({evidenceIds=[]}={}){
    const fresh=[];
    for(const value of evidenceIds||[]){
      const id=String(value||"");
      if(!id||seenEvidence.has(id))continue;
      seenEvidence.add(id);fresh.push(id);
    }
    if(fresh.length===0)noProgressRounds++;else noProgressRounds=0;
    const snapshot={new_evidence_delta:fresh.length,new_evidence_ids:fresh,no_progress_rounds:noProgressRounds,total_evidence_ids:seenEvidence.size,stop:noProgressRounds>maxNoProgressRounds,decision:noProgressRounds>maxNoProgressRounds?"HANDOFF_OR_INSUFFICIENT_EVIDENCE":"CONTINUE"};
    history.push(snapshot);
    return snapshot;
  }
  function snapshot(){return {max_no_progress_rounds:maxNoProgressRounds,no_progress_rounds:noProgressRounds,total_evidence_ids:seenEvidence.size,history:history.map(x=>({...x,new_evidence_ids:[...x.new_evidence_ids]}))};}
  return {observe,snapshot};
}

module.exports={createProgressController};
