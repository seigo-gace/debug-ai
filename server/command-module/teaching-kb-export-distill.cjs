"use strict";
const fs=require("node:fs"),path=require("node:path");
const {buildTeacherRow,classifyRecord,OUT_SCHEMA}=require("./teaching-distill-adapter.js");
const fail=code=>{throw Object.assign(new Error(code),{code});};
const runtimeRoot=process.argv[2],acceptedPath=process.argv[3];
if(!runtimeRoot||!path.isAbsolute(runtimeRoot)||!acceptedPath||!path.isAbsolute(acceptedPath))fail("TEACHING_DISTILL_EXPORT_PATH_INVALID");
const candidatesDir=path.join(runtimeRoot,"teaching-kb","candidates");
if(!fs.existsSync(candidatesDir))fail("TEACHING_DISTILL_CANDIDATES_MISSING");
const seen=new Set();
if(fs.existsSync(acceptedPath)){
  for(const line of fs.readFileSync(acceptedPath,"utf8").split("\n").filter(Boolean)){
    try{const row=JSON.parse(line);if(row.case_id)seen.add(row.case_id);if(row.source_id)seen.add("src:"+row.source_id);}catch{}
  }
}
const manifest={schema:"debugai.teaching-distill-export/v1",runtime_root:runtimeRoot,accepted_path:acceptedPath,examined:0,adopted:{sft:[],recovery:[]},rejected:[],skipped_duplicate:[]};
for(const name of fs.readdirSync(candidatesDir).filter(n=>n.endsWith(".json")).sort()){
  manifest.examined++;
  const record=JSON.parse(fs.readFileSync(path.join(candidatesDir,name),"utf8"));
  if(seen.has("src:"+record.id)){manifest.skipped_duplicate.push({source_id:record.id,reason:"SOURCE_ALREADY_ACCEPTED"});continue;}
  const gate=classifyRecord(record);
  if(!gate.eligible){manifest.rejected.push({source_id:record.id,topic:record.topic,verdict:record.verdict,verification:record.verification,split:gate.split,reason:gate.reason});continue;}
  let row;
  try{row=buildTeacherRow(record,{split:gate.split});}catch(e){manifest.rejected.push({source_id:record.id,topic:record.topic,reason:e.code||String(e.message).slice(0,120)});continue;}
  if(seen.has(row.case_id)){manifest.skipped_duplicate.push({source_id:record.id,case_id:row.case_id,reason:"CASE_ALREADY_ACCEPTED"});continue;}
  fs.appendFileSync(acceptedPath,JSON.stringify(row)+"\n",{mode:0o600});
  seen.add(row.case_id);seen.add("src:"+record.id);
  manifest.adopted[gate.split].push({case_id:row.case_id,source_id:record.id,topic:record.topic});
}
const exportDir=path.join(runtimeRoot,"teaching-kb","export");
fs.mkdirSync(exportDir,{recursive:true,mode:0o700});
fs.writeFileSync(path.join(exportDir,"distill-manifest.json"),JSON.stringify(manifest,null,2)+"\n",{mode:0o600});
console.log(JSON.stringify({schema:OUT_SCHEMA,adopted_sft:manifest.adopted.sft.length,adopted_recovery:manifest.adopted.recovery.length,rejected:manifest.rejected.length,manifest:path.join(exportDir,"distill-manifest.json")}));