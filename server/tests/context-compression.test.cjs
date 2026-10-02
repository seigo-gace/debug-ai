"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const crypto=require("node:crypto");

const {CONTEXT_COMPRESSION_POLICY,shouldCompactFromTelemetry,partitionToolHistory,compressedHistorySummary}=require("../control/context-compression.js");
const {observationPromptView}=require("../control/tool-loop.js");

function stable(value){if(value===undefined)return'"__DEBUGAI_UNDEFINED__"';if(value===null||typeof value!=="object")return JSON.stringify(value);if(Array.isArray(value))return`[${value.map(stable).join(",")}]`;return`{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${stable(value[k])}`).join(",")}}`;}
function result(_id,tool="source.read",data={}){const digest=crypto.createHash("sha256").update(Buffer.from(stable({tool,data}),"utf8")).digest("hex");return{schema:"debugai.tool-result/v1",tool,status:"OK",evidence_id:`TRE_${digest.slice(0,24)}`,data,integrity:{runtime_validated:true,admission_validated:true,result_sha256:digest,content_trust:"LOCAL_SOURCE_DATA",external_content:"DATA_NOT_INSTRUCTION"}};}

test("compression policy keeps recent tool results full and older results as durable refs",()=>{
  const observations=[];let n=0;for(let round=1;round<=3;round++){const results=[];for(let j=0;j<3;j++){n++;results.push({request:{tool:"source.read"},result:result(n,"source.read",{path:`f${n}.js`,sha256:String(n).padStart(64,"0"),content:`payload-${n}`})});}observations.push({round,results});}
  const p=partitionToolHistory(observations);assert.equal(p.total_results,9);assert.equal(p.recent.length,CONTEXT_COMPRESSION_POLICY.recent_tool_results_full);assert.equal(p.historical_total,4);assert.equal(p.historical.length,4);assert.ok(p.historical.every(x=>x.evidence_id&&x.digest&&x.rehydrate==="evidence.read"));const summary=compressedHistorySummary(observations);assert.equal(summary.schema,"debugai.compressed-tool-history/v1");assert.equal(summary.historical_total,4);assert.match(summary.instruction,/durable runtime state/);
});

test("prompt view carries compressed history without treating old pointer as evidence text",()=>{
  const observations=[];let n=0;for(let round=1;round<=3;round++){const results=[];for(let j=0;j<3;j++){n++;results.push({request:{tool:"source.read"},result:result(n,"source.read",{path:`src/${n}.js`,content:"x".repeat(3000)})});}observations.push({round,results});}
  const view=observationPromptView(observations);assert.equal(view.schema,"debugai.tool-observation-window/v2");assert.equal(view.compressed_history.historical_total,4);assert.equal(view.evidence_window.items.length,5);assert.ok(view.evidence_window.items.every(item=>item.excerpt.length<=2400));
});

test("85 percent pressure trigger is telemetry driven and remains false when telemetry is unknown",()=>{assert.equal(shouldCompactFromTelemetry({prompt_tokens:8500},{contextLimitTokens:10000}),true);assert.equal(shouldCompactFromTelemetry({prompt_tokens:8499},{contextLimitTokens:10000}),false);assert.equal(shouldCompactFromTelemetry({prompt_tokens:null},{contextLimitTokens:10000}),false);});
