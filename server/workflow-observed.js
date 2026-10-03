"use strict";

const base=require("./workflow.js");
const {wrapAuthorityForRunObservation}=require("./control/run-observation-context.js");
const {withRoleSemanticMode}=require("./control/role-semantic-mode.js");
const {createSearchGateShadowAdapter}=require("./control/search-gate-shadow-runtime.js");
const {withRejectedHistoryContext,persistRejectedFromDiagnosis,latestFailure}=require("./control/rejected-history-provider.js");
const {withInvariantAuthorityContext}=require("./control/invariant-authority-provider.js");

function enforceWorkflowRoleSemantics(workflow){
  return new Proxy(workflow,{
    get(target,property,receiver){
      const value=Reflect.get(target,property,receiver);
      if(typeof value!=="function")return value;
      return function(...args){return withRoleSemanticMode("enforce",()=>Reflect.apply(value,target,args));};
    }
  });
}
function wrapRuntimeEvidenceForRejectedHistory(runtimeEvidence,authority){
  if(!runtimeEvidence||typeof runtimeEvidence!=="object"||!authority)return runtimeEvidence;
  return new Proxy(runtimeEvidence,{
    get(target,property,receiver){
      const value=Reflect.get(target,property,receiver);
      if(typeof value!=="function")return value;
      if(property!=="write")return value.bind(target);
      return function(runId,type,payload){
        const result=Reflect.apply(value,target,[runId,type,payload]);
        if(type==="analysis"&&payload?.diagnosis){
          const failure=latestFailure(target,runId);
          const hypotheses=Array.isArray(payload.diagnosis.hypotheses)?payload.diagnosis.hypotheses:[];
          if(!failure&&hypotheses.some(item=>String(item?.status||"")==="REJECTED"))throw new Error("REJECTED_HISTORY_FAILURE_RECORD_REQUIRED");
          const registry=payload.evidence_registry||{},snapshot=[...(registry.evidence_ids||[]),...(registry.tool_evidence_ids||[])];
          persistRejectedFromDiagnosis({authority,runId,failure,diagnosis:payload.diagnosis,evidenceSnapshotRefs:snapshot,repositoryRevision:null});
        }
        return result;
      };
    }
  });
}
function withAuthorityContexts(workflow,{authority,runtimeEvidence}={}){
  if(!authority)return workflow;
  return new Proxy(workflow,{
    get(target,property,receiver){
      const value=Reflect.get(target,property,receiver);
      if(typeof value!=="function")return value;
      return function(...args){
        const invoke=()=>withInvariantAuthorityContext({authority,runtimeEvidence},()=>Reflect.apply(value,target,args));
        return runtimeEvidence?withRejectedHistoryContext({authority,runtimeEvidence},invoke):invoke();
      };
    }
  });
}
function withSearchGateShadow(options,authority){
  if(!options.runtimeEvidence||!options.authority)return options;
  const repositorySnapshot=typeof options.repositorySnapshot==="function"?options.repositorySnapshot:undefined;
  return{
    ...options,
    evidenceSearch:createSearchGateShadowAdapter({searchKind:"OFFICIAL_EXTERNAL",adapter:options.evidenceSearch,authority,runtimeEvidence:options.runtimeEvidence,repositorySnapshot}),
    tgserver:createSearchGateShadowAdapter({searchKind:"INTERNAL_KB",adapter:options.tgserver,authority,runtimeEvidence:options.runtimeEvidence,repositorySnapshot}),
    authority,
  };
}
function createWorkflow(options={}){
  const historyRuntimeEvidence=wrapRuntimeEvidenceForRejectedHistory(options.runtimeEvidence||null,options.authority||null);
  const authority=options.authority?wrapAuthorityForRunObservation(options.authority,historyRuntimeEvidence):options.authority;
  const observed=withSearchGateShadow({...options,runtimeEvidence:historyRuntimeEvidence,authority},authority);
  const workflow=enforceWorkflowRoleSemantics(base.createWorkflow(observed));
  return withAuthorityContexts(workflow,{authority:options.authority||null,runtimeEvidence:historyRuntimeEvidence});
}

module.exports={...base,enforceWorkflowRoleSemantics,wrapRuntimeEvidenceForRejectedHistory,withAuthorityContexts,withSearchGateShadow,createWorkflow};
