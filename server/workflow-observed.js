"use strict";

const base=require("./workflow.js");
const {wrapAuthorityForRunObservation}=require("./control/run-observation-context.js");
const {withRoleSemanticMode}=require("./control/role-semantic-mode.js");
const {createSearchGateShadowAdapter}=require("./control/search-gate-shadow-runtime.js");

function enforceWorkflowRoleSemantics(workflow){
  return new Proxy(workflow,{
    get(target,property,receiver){
      const value=Reflect.get(target,property,receiver);
      if(typeof value!=="function")return value;
      return function(...args){return withRoleSemanticMode("enforce",()=>Reflect.apply(value,target,args));};
    }
  });
}
function withSearchGateShadow(options,authority){
  if(!options.runtimeEvidence||!options.authority)return options;
  return{
    ...options,
    evidenceSearch:createSearchGateShadowAdapter({searchKind:"OFFICIAL_EXTERNAL",adapter:options.evidenceSearch,authority:options.authority,runtimeEvidence:options.runtimeEvidence}),
    tgserver:createSearchGateShadowAdapter({searchKind:"INTERNAL_KB",adapter:options.tgserver,authority:options.authority,runtimeEvidence:options.runtimeEvidence}),
    authority,
  };
}
function createWorkflow(options={}){
  const authority=options.authority?wrapAuthorityForRunObservation(options.authority,options.runtimeEvidence||null):options.authority;
  const observed=withSearchGateShadow(options,authority);
  return enforceWorkflowRoleSemantics(base.createWorkflow(observed));
}

module.exports={...base,enforceWorkflowRoleSemantics,withSearchGateShadow,createWorkflow};
