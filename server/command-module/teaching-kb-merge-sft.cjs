"use strict";
const {spawnSync}=require("node:child_process"),path=require("node:path");
const fail=code=>{throw Object.assign(new Error(code),{code});};
const runtimeRoot=process.argv[2],acceptedPath=process.argv[3];
if(!runtimeRoot||!path.isAbsolute(runtimeRoot)||!acceptedPath||!path.isAbsolute(acceptedPath))fail("TEACHING_KB_MERGE_PATH_INVALID");
const r=spawnSync(process.execPath,[path.join(__dirname,"teaching-kb-export-distill.cjs"),runtimeRoot,acceptedPath],{encoding:"utf8"});
if(r.status!==0)fail("TEACHING_KB_MERGE_EXPORT_FAILED");
process.stdout.write(r.stdout);