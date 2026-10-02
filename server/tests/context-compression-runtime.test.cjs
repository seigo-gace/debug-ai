"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {makeToolResult}=require("../control/read-only-tool-runtime.js");
const {runRoleWithReadOnlyTools}=require("../control/tool-loop.js");

function observation(result,round=0){return{round,results:[{request:{tool:"source.read",reason:"fixture"},result,reused:false}]};}
function promptView(user){
  const marker="RUNTIME_TOOL_OBSERVATIONS_DATA_ONLY=";
  const at=String(user||"").indexOf(marker);
  assert.ok(at>=0,"tool observation marker must be present");
  return JSON.parse(String(user).slice(at+marker.length));
}

test("tool loop applies measured 85 percent context pressure to the next working-context prompt",async()=>{
  const historical=[];
  for(let i=1;i<=6;i++)historical.push(makeToolResult("source.read",{path:`src/old-${i}.js`,content:`old-${i}`}));
  const continuationState={
    rounds_completed:0,
    total_calls:0,
    observations:historical.map((result,index)=>observation(result,index+1)),
    seen_tool_fingerprints:[],
    progress:null,
    completed_work_ids:[],
    completed_effect_ids:[]
  };
  const calls=[];let latest=null;
  const toolRuntime={
    availableTools:["source.read"],
    execute:async()=>{latest=makeToolResult("source.read",{path:"src/latest.js",content:"latest"});return latest;}
  };
  const aiCore={
    runtime_context_tokens:10000,
    call:async(role,opts)=>{
      calls.push({role,...opts});
      if(calls.length===1){
        const before=promptView(opts.user);
        assert.equal(before.evidence_window.items.length,6);
        return{
          content:JSON.stringify({tool_requests:[{tool:"source.read",arguments:{path:"src/latest.js"},reason:"inspect latest"}]}),
          telemetry:{prompt_tokens:8500},
          control_plane:{runtime_context_tokens:10000,selected_skill_ids:["failure-scope-reduction"]}
        };
      }
      const after=promptView(opts.user);
      assert.equal(after.evidence_window.items.length,5);
      assert.equal(after.compressed_history.historical_total,2);
      assert.ok(after.evidence_window.items.some(item=>item.parent_evidence_id===latest.evidence_id));
      assert.ok(after.compressed_history.retained_refs.some(item=>item.evidence_id===historical[0].evidence_id));
      return{
        content:JSON.stringify({claims:[{type:"FACT",text:"latest evidence inspected",evidence_refs:[latest.evidence_id]}],decision:"HANDOFF"}),
        telemetry:{prompt_tokens:4000},
        control_plane:{runtime_context_tokens:10000,selected_skill_ids:["failure-scope-reduction"]}
      };
    }
  };
  const out=await runRoleWithReadOnlyTools({aiCore,role:"code_scout",system:"Code Scout JSON only",user:'{"failure":"alpha"}',toolRuntime,continuationState});
  assert.equal(calls.length,2);
  assert.equal(out.tool_loop.parse_status,"FINAL");
  assert.equal(out.tool_loop.observations.length,7);
});
