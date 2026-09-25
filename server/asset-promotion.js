"use strict";
const ALLOWED=new Set(["confirmed_root_cause","decisive_evidence","failed_fix_worth_avoiding","accepted_fix","validation","regression","invariant","environment","source_refs"]);
function evaluateAsset(asset){const reasons=[];if(!asset||typeof asset!=="object")reasons.push("ASSET_OBJECT_REQUIRED");else{if(!ALLOWED.has(asset.kind))reasons.push("KIND_NOT_PROMOTABLE");if(asset.confirmed!==true)reasons.push("CONFIRMED_REQUIRED");if(!String(asset.summary||"").trim())reasons.push("SUMMARY_REQUIRED");if(["hypothesis","intermediate_log","raw_tool_output","official_docs_copy"].includes(asset.kind))reasons.push("EPHEMERAL_NOT_PROMOTABLE");}return {promote:reasons.length===0,reasons};}
function assertPromotable(asset){const x=evaluateAsset(asset);if(!x.promote)throw new Error(`ASSET_PROMOTION_REJECTED:${x.reasons.join(",")}`);return true;}
module.exports={ALLOWED,evaluateAsset,assertPromotable};
