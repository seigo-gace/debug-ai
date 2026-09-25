"use strict";
const C=require("./contracts.js");
const T=Object.freeze({
RECEIVED:new Set(["PARSED","BLOCKED"]),
PARSED:new Set(["CONTEXT_READY","BLOCKED"]),
CONTEXT_READY:new Set(["VERIFYING","BLOCKED"]),
VERIFYING:new Set(["FAILED","COMPLETE","BLOCKED"]),
FAILED:new Set(["RESOLVING","BLOCKED","ESCALATION_REQUIRED"]),
RESOLVING:new Set(["PATCH_READY","BLOCKED","ESCALATION_REQUIRED"]),
PATCH_READY:new Set(["WAITING_APPROVAL","BLOCKED"]),
WAITING_APPROVAL:new Set(["APPLYING","BLOCKED"]),
APPLYING:new Set(["RETESTING","BLOCKED"]),
RETESTING:new Set(["COMPLETE","FAILED","BLOCKED","ESCALATION_REQUIRED"]),
COMPLETE:new Set(),BLOCKED:new Set(),ESCALATION_REQUIRED:new Set(["RESOLVING","BLOCKED"])});
function canTransition(a,b){return Boolean(T[a]?.has(b));}
class StateMachine{constructor({store}={}){this.store=store||null;} checkpoint(run){C.validateRunState(run);this.store?.saveRunState?.(run);return run;} transition(run,next){C.validateRunState(run);if(!Object.values(C.RunState).includes(next))throw new C.ContractError("state",`invalid state ${next}`);if(run.state!==next&&!canTransition(run.state,next))throw new C.ContractError("state",`invalid transition ${run.state}->${next}`);run.state=next;run.updated_at=C.nowSec();this.checkpoint(run);return run;}}
module.exports={TRANSITIONS:T,canTransition,StateMachine};
