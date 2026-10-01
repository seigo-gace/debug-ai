"use strict";

const base=require("./workflow.js");
const {wrapAuthorityForRunObservation}=require("./control/run-observation-context.js");
const {withRoleSemanticMode}=require("./control/role-semantic-mode.js");

function enforceWorkflowRoleSemantics(workflow){
  return new Proxy(workflow,{
    get(target,property,receiver){
      const value=Reflect.get(target,property,receiver);
      if(typeof value!=="function")return value;
      return function(...args){return withRoleSemanticMode("enforce",()=>Reflect.apply(value,target,args));};
    }
  });
}
function createWorkflow(options={}){
  const authority=options.authority?wrapAuthorityForRunObservation(options.authority,options.runtimeEvidence||null):options.authority;
  return enforceWorkflowRoleSemantics(base.createWorkflow({...options,authority}));
}

module.exports={...base,enforceWorkflowRoleSemantics,createWorkflow};
