"use strict";
const {makeEvidenceRecord}=require("../../control/evidence-registry.js");
const {createRoleProgressEvaluator}=require("../../control/role-output-validator.js");
const examples={
 code_scout:{kind:"source_inspection",observation:{path:"src/a.js",sha256:"a".repeat(64)},result:{relevant_files:["src/a.js"],call_path:[],excluded_files:[],unknowns:[],contract_mismatch:null}},
 causal_scout:{kind:"causal_edge",observation:{from:"failure",to:"wrong-state",state:"SUPPORTED",alternatives:["race"]},result:{causal_chain:["failure -> wrong-state"],alternate_hypotheses:["race"]}},
 researcher:{kind:"research_source",observation:{version:"v1",retrieval_status:"VERIFIED"},result:{research_status:"SUPPORTED",answer:"qualified source",evidence_refs:[],rejected_source_refs:[],contradictions:[],bound_version:"v1"}},
 diagnoser:{kind:"hypothesis_test",observation:{hypothesis_id:"H1",status:"REJECTED",falsification_condition:"reproduction passes"},result:{diagnosis_status:"NO_ACTIVE_HYPOTHESIS",hypotheses:[{id:"H1",status:"REJECTED",falsification_condition:"reproduction passes",evidence_refs:[],counter_evidence_refs:[]}],unsupported_claims:[],confirmed_root_cause:null}},
 patch_engineer:{kind:"candidate_check",observation:{candidate_hash:"b".repeat(64),source_revision:"sha1",executed:true,status:"PASS",operations:[{type:"replace",path:"src/a.js",old:"return 0",new:"return 1"}]},result:{operations:[{type:"replace",path:"src/a.js",old:"return 0",new:"return 1"}]}},
 local_reviewer:{kind:"review_obligation",observation:{candidate_hash:"b".repeat(64),source_revision:"sha2",apply_receipt:"receipt1",executed:true,status:"PASS",name:"regression"},result:{verdict:"PASS",decision:"DONE",claims:[]}}
};
function setup(role){
 const e=structuredClone(examples[role]);
 const record=makeEvidenceRecord("LOCAL_RUNTIME",{kind:e.kind,...e.observation},{sourceRef:"independent-check"});
 if(role==="causal_scout")e.result.candidates=[{...e.observation,evidence_refs:[record.evidence_id]}];
 if(role==="researcher")e.result.evidence_refs=[record.evidence_id];
 if(role==="diagnoser")e.result.hypotheses[0].counter_evidence_refs=[record.evidence_id];
 const criteria=[{id:"criterion-1",kind:e.kind,evidence_id:record.evidence_id,source_ref:record.source_ref,observation:e.observation,result:e.result}];
 const evaluator=createRoleProgressEvaluator({role,criteria,evidenceRecords:[record]});
 const marker={criterion_id:"criterion-1",evidence_refs:[record.evidence_id]};
 return {evaluator,criteria,record,e,marker};
}
module.exports={setup,examples};
