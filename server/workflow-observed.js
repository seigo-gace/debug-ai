"use strict";

const base=require("./workflow.js");
const {wrapAuthorityForRunObservation}=require("./control/run-observation-context.js");

function createWorkflow(options={}){
  const authority=options.authority?wrapAuthorityForRunObservation(options.authority,options.runtimeEvidence||null):options.authority;
  return base.createWorkflow({...options,authority});
}

module.exports={...base,createWorkflow};
