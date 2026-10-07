"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {createServer}=require("../http.js");

test("investigation benchmark HTTP start/status delegates without mutation routes",async t=>{
  const calls=[];
  const workflow={
    startInvestigationBenchmark:async body=>{calls.push(["start",body]);return{schema:"debugai.investigation-benchmark-accepted/v1",benchmark_id:"invbench_test",state:"RUNNING",case_id:body.case_id};},
    investigationBenchmarkStatus:async id=>{calls.push(["status",id]);return{schema:"debugai.investigation-benchmark-status/v1",benchmark_id:id,state:"DONE",case_id:"L1-CS1",result:{pass:true}};},
  };
  const server=createServer({workflow});
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const start=await fetch(base+"/v1/investigation-benchmark/start",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({case_id:"L1-CS1"})});
  assert.equal(start.status,202);assert.equal((await start.json()).benchmark_id,"invbench_test");
  const status=await fetch(base+"/v1/investigation-benchmark/status/invbench_test");
  assert.equal(status.status,200);assert.equal((await status.json()).state,"DONE");
  assert.deepEqual(calls,[["start",{case_id:"L1-CS1"}],["status","invbench_test"]]);
});
