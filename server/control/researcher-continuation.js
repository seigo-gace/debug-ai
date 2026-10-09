"use strict";

const {buildResearcherWorkUnits,createDefaultRegistry,ROLE_WORK_UNIT_REGISTRY_VERSION,ROLE_FINAL_WORK_UNIT,ROLE_FINAL_PAYLOAD_SCHEMA}=require("../../orchestrator/work-unit-registry.js");
const {runRoleContinuation,checkpointPath,roleResultPath}=require("./role-continuation.js");

const RESEARCHER_REGISTRY_VERSION=ROLE_WORK_UNIT_REGISTRY_VERSION.researcher;

async function runResearcherContinuation(options={}){
  return runRoleContinuation({...options,role:"researcher",registryVersion:RESEARCHER_REGISTRY_VERSION,finalWorkUnitId:ROLE_FINAL_WORK_UNIT.researcher,finalPayloadSchema:ROLE_FINAL_PAYLOAD_SCHEMA.researcher,finalValidationSummary:"Researcher A-E work units completed",registry:options.registry||buildResearcherWorkUnits(createDefaultRegistry())});
}

module.exports={RESEARCHER_REGISTRY_VERSION,checkpointPath,roleResultPath,runResearcherContinuation};
