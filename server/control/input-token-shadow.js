"use strict";
// Passive admission diagnostic. It does not alter prompts, reserve actual GPU
// memory, or authorize a production blocking decision.
function assessInputReservation({inputTokens=null,contextTokens=null,outputTokens=null}={}){
  const valid=x=>Number.isSafeInteger(x)&&x>0;
  const input=valid(inputTokens)?inputTokens:null;
  const context=valid(contextTokens)?contextTokens:null;
  const output=valid(outputTokens)?outputTokens:null;
  const total=input!==null&&output!==null?input+output:null;
  return Object.freeze({
    schema:"debugai.input-reservation-shadow/v1",
    input_tokens:input,
    context_tokens:context,
    output_reservation_tokens:output,
    combined_reservation_tokens:total,
    reservation_fits:total!==null&&context!==null?total<=context:null,
    qualification:"SHADOW_UNVERIFIED_TEMPLATE_PARITY",
    blocking_enabled:false
  });
}
module.exports={assessInputReservation};
