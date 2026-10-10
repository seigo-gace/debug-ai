"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const{
  classifyRetentionError,
  summarizeRetentionErrorClasses,
  formatRetentionErrorHistogram,
}=require("../control/retention-error-classification.js");
const {archiveTerminalRuns}=require("../control/storage-retention.js");

test("classifyRetentionError extracts UPPER_SNAKE before colon and ignores path suffix",()=>{
  assert.equal(classifyRetentionError("ARCHIVE_RECEIPT_MISSING:run_secret_abc"),"ARCHIVE_RECEIPT_MISSING");
  assert.equal(classifyRetentionError("DURABLE_GC_UNARCHIVED_RECORD_PRESENT:run_done:durable/role-result/x.json"),"DURABLE_GC_UNARCHIVED_RECORD_PRESENT");
  assert.equal(classifyRetentionError("JOB_STATUS_INCOMPATIBLE:RUNNING"),"JOB_STATUS_INCOMPATIBLE");
});

test("classifyRetentionError maps node errno codes without leaking paths",()=>{
  assert.equal(classifyRetentionError("ENOENT"),"NODE_ENOENT");
  assert.equal(classifyRetentionError("ENOENT: no such file durable/state/run_x.json"),"NODE_ENOENT");
});

test("classifyRetentionError fails closed to OTHER for unstructured messages",()=>{
  assert.equal(classifyRetentionError("incompatible storage_format_version=999"),"OTHER");
  assert.equal(classifyRetentionError(""),"OTHER");
});

test("classifyRetentionError fails closed to OTHER for unknown uppercase secret-like prefixes",()=>{
  assert.equal(classifyRetentionError("INTERNAL_TOKEN_VALUE:xxx"),"OTHER");
  assert.equal(classifyRetentionError("INJECTED_HISTOGRAM_LABEL:run_x"),"OTHER");
});

test("summarizeRetentionErrorClasses counts distinct classes and caps overflow into OTHER",()=>{
  const items=[];
  for(let i=0;i<40;i++)items.push({error:`ARCHIVE_RECEIPT_OVERFLOW_${String(i).padStart(2,"0")}_INVALID:run_${i}`});
  const summary=summarizeRetentionErrorClasses(items,{maxClasses:32});
  const keys=Object.keys(summary.counts);
  assert.ok(keys.length<=32);
  assert.ok(summary.counts.OTHER>=9);
  assert.equal(keys.filter(k=>k.startsWith("ARCHIVE_RECEIPT_OVERFLOW_")).length,31);
});

test("summarizeRetentionErrorClasses does not double-count OTHER when capping",()=>{
  const items=[{error:"OTHER:ignored"}];
  for(let i=0;i<35;i++)items.push({error:`DURABLE_GC_CAP_${String(i).padStart(2,"0")}_INVALID:run_${i}`});
  const summary=summarizeRetentionErrorClasses(items,{maxClasses:32});
  const keys=Object.keys(summary.counts);
  assert.ok(keys.length<=32);
  const inputCount=items.length;
  const outputSum=Object.values(summary.counts).reduce((n,v)=>n+v,0);
  assert.equal(outputSum,inputCount);
  assert.equal(summary.counts.OTHER,5);
});

test("summarizeRetentionErrorClasses uses error field only",()=>{
  const summary=summarizeRetentionErrorClasses([
    {run_id:"run_leak",error:"TGSERVER_TIMEOUT:run_leak"},
    {run_id:"run_other",error:"TGSERVER_TIMEOUT:ignored"},
  ]);
  assert.equal(summary.counts.TGSERVER_TIMEOUT,2);
});

test("formatRetentionErrorHistogram is alphabetically stable and excludes paths and run ids",()=>{
  const summary=summarizeRetentionErrorClasses([
    {error:"DURABLE_GC_UNARCHIVED_RECORD_PRESENT:run_a"},
    {error:"ARCHIVE_RECEIPT_MISSING:run_b"},
    {error:"ARCHIVE_RECEIPT_MISSING:run_c"},
  ]);
  const line=formatRetentionErrorHistogram("archive_error",summary);
  assert.match(line,/^archive_error_classes=ARCHIVE_RECEIPT_MISSING:2,DURABLE_GC_UNARCHIVED_RECORD_PRESENT:1$/);
  assert.doesNotMatch(line,/run_/);
  assert.doesNotMatch(line,/[/\\@]/);
});

test("archiveTerminalRuns report still includes run_id while histogram formatter never does",async()=>{
  const terminal=[{run_id:"run_blocked",reason:"BLOCKED",state:{job_status:"BLOCKED"},manifest:{policy_refs:{}}}];
  const authority={
    durableEnabled:()=>true,
    inspectDurableRuns:()=>({terminal,recoverable:[],incompatible:[]}),
    loadDurable:runId=>({state:{job_status:"BLOCKED",generation:1,execution_epoch:0,run_id:runId},manifest:{schema:"execution-manifest/v1",manifest_id:`man_${runId}`,run_id:runId,job:{status:"BLOCKED",finished_at:1},workflow_input_refs:{},role_execution_refs:{},policy_refs:{}}}),
    listDurableRunRecords:runId=>[{path:`durable/commit/${runId}.json`,record:{schema:"debugai.commit/v1",run_id:runId}}],
    readDurableRecord:(path,{allowMissing=false}={})=>{if(allowMissing)return null;throw new Error(`MISSING:${path}`);},
    commitDurable:async()=>({state:{generation:2}}),
  };
  const tgserver={log:async()=>{throw new Error("TG_DOWN");}};
  const report=await archiveTerminalRuns({authority,tgserver,maxRuns:3,now:100});
  assert.equal(report.errors.length,1);
  assert.equal(report.errors[0].run_id,"run_blocked");
  assert.match(report.errors[0].error,/TG_DOWN/);
  const hist=formatRetentionErrorHistogram("archive_error",summarizeRetentionErrorClasses(report.errors));
  assert.match(hist,/OTHER:1/);
  assert.doesNotMatch(hist,/run_blocked/);
});

test("production entrypoint uses retention error classification for histograms",()=>{
  const source=fs.readFileSync(path.join(__dirname,"..","main.js"),"utf8");
  assert.match(source,/require\("\.\/control\/retention-error-classification\.js"\)/);
  assert.match(source,/formatRetentionErrorHistogram/);
});
