"use strict";
const {assertEvidenceRecord,evidenceIds}=require("../evidence-registry.js");
const {mergeEvidenceIds}=require("../tool-loop.js");

function validateEvidenceRecords(records){
  const list=Array.isArray(records)?records:[];
  for(const record of list)assertEvidenceRecord(record);
  return list;
}
function mergeBaseEvidenceWithRecords(baseEvidenceIds,records){
  return mergeEvidenceIds(baseEvidenceIds,evidenceIds(validateEvidenceRecords(records)));
}
function evidencePromptView(records){
  return (Array.isArray(records)?records:[]).map(record=>{
    if(!record||typeof record!=="object")return record;
    const {integrity,...view}=record;
    return view;
  });
}
module.exports={validateEvidenceRecords,mergeBaseEvidenceWithRecords,evidencePromptView};
