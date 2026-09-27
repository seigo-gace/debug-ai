"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {createDapEvidenceLane}=require("../control/dap-evidence-runtime.js");

test("DAP lane stays disabled for non-runtime failure classes",async()=>{let prepared=0;const lane=createDapEvidenceLane({prepare(){prepared++;throw new Error("should not run")}});const evidence=await lane.collect({repo:process.cwd(),checks:[{status:"FAIL",check_type:"typecheck",stderr:"TS2322"}]});assert.equal(prepared,0);assert.equal(evidence.status,"NOT_CONFIGURED");assert.equal(evidence.authority,"HINT_ONLY");assert.equal(evidence.local_only,true);});

test("DAP lane admits only a safe repo-local runtime target and keeps hint-only authority",async()=>{const repo=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-dap-lane-")),file=path.join(repo,"probe.cjs");fs.writeFileSync(file,"function main(){\n const answer=41;\n return answer+1;\n}\nmain();\n");let prepared=null;const expected={schema:"debugai-dap-runtime-evidence/v1",authority:"HINT_ONLY",local_only:true,status:"PASS",configured:true,executed:true,reason:"RUNTIME_DEBUG_SESSION_EXECUTED",target:{file:"probe.cjs",line:3,configurationName:"node"},records:[]};const lane=createDapEvidenceLane({jobRoot:"/ignored",prepare(args){prepared=args;return{job_id:"DAP_TEST"};},async wait(){return{evidence:expected};}});const evidence=await lane.collect({repo,checks:[{status:"FAIL",check_type:"unit",stderr:`TypeError: boom at ${file}:3:2`}],task:"debug failure",variableNames:["answer"]});assert.equal(prepared.targetFile,file);assert.equal(prepared.line,3);assert.equal(prepared.configurationName,"node");assert.deepEqual(prepared.variableNames,["answer"]);assert.equal(evidence,expected);fs.rmSync(repo,{recursive:true,force:true});});

test("DAP lane refuses runtime failure when no safe file-line target exists",async()=>{let prepared=0;const lane=createDapEvidenceLane({prepare(){prepared++;throw new Error("should not run")}});const repo=fs.mkdtempSync(path.join(os.tmpdir(),"debugai-dap-no-target-"));const evidence=await lane.collect({repo,checks:[{status:"FAIL",check_type:"integration",stderr:"TypeError: boom without location"}]});assert.equal(prepared,0);assert.equal(evidence.status,"NOT_CONFIGURED");assert.equal(evidence.reason,"DAP_SAFE_TARGET_NOT_FOUND");fs.rmSync(repo,{recursive:true,force:true});});
