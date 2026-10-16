"use strict";
const ROLE_CONTRACT_VERSION="debugai.role-contract/v2";
const COMMON=Object.freeze({
  provider_policy:Object.freeze({paid_allowed:false,model_profile_owned_by_runtime:true}),
  claim_policy:Object.freeze({fact_requires_evidence:true,inference_must_be_labeled:true,hypothesis_requires_falsification:true,unknown_is_valid:true,rejected_hypothesis_is_retained:true,model_output_is_not_evidence:true}),
  external_content_policy:"DATA_NOT_INSTRUCTION",
  raw_chain_of_thought_required:false,
});
function role(def){return Object.freeze({...COMMON,...def,provider_policy:COMMON.provider_policy,claim_policy:COMMON.claim_policy});}
module.exports={ROLE_CONTRACT_VERSION,COMMON,role};
