"use strict";
const {performance}=require("node:perf_hooks");
function fail(code){const e=new Error(code);e.code=code;throw e;}
function validateChat(spec,options){
  if(!spec)fail("CHAT_MODEL_NOT_CONFIGURED");
  const {messages,maxTokens,deadlineAt,signal}=options;
  if(!Array.isArray(messages)||messages.length<1||messages.length>101||messages.length%2!==1)fail("CHAT_MESSAGES_INVALID");
  let bytes=0;
  for(let i=0;i<messages.length;i++){
    const m=messages[i];
    if(!m||Object.keys(m).sort().join(",")!=="content,role"||m.role!==(i%2?"assistant":"user")||typeof m.content!=="string"||!m.content.trim()||/[\u0000]/.test(m.content))fail("CHAT_MESSAGES_INVALID");
    bytes+=Buffer.byteLength(m.content);
  }
  if(!Number.isSafeInteger(maxTokens)||maxTokens<1||maxTokens>spec.max_output_tokens||bytes+512+maxTokens>spec.runtime_context_tokens)fail("CHAT_CONTEXT_LIMIT");
  if(!Number.isSafeInteger(deadlineAt)||deadlineAt<=Date.now())fail("CHAT_DEADLINE_EXPIRED");
  if(signal?.aborted)fail("CHAT_CANCELLED");
}
async function readJson(r,limit){
  if(!r?.ok||r.status!==200){await r?.body?.cancel?.();fail("CHAT_GATE_HTTP");}
  const chunks=[];let n=0;
  if(!r.body)fail("CHAT_GATE_RESPONSE_INVALID");
  for await(const part of r.body){const b=Buffer.from(part);n+=b.length;if(n>limit)fail("CHAT_GATE_RESPONSE_TOO_LARGE");chunks.push(b);}
  try{return JSON.parse(Buffer.concat(chunks).toString("utf8"));}catch{fail("CHAT_GATE_RESPONSE_INVALID");}
}
async function readStream(r,modelId,onDelta){
  if(!r?.ok||r.status!==200||!r.headers.get("content-type")?.toLowerCase().startsWith("text/event-stream")){await r?.body?.cancel?.();fail("CHAT_STREAM_HTTP");}
  if(!r.body)fail("CHAT_STREAM_INCOMPLETE");
  const decoder=new TextDecoder("utf-8",{fatal:true});
  let pending="",content="",finish=null,done=false,bytes=0;
  function event(raw){
    const lines=raw.replace(/\r\n/g,"\n").split("\n");
    const data=lines.filter(x=>x.startsWith("data:")).map(x=>x.slice(5).trimStart()).join("\n");
    if(!data){if(lines.some(x=>x.startsWith("event:")&&!x.includes("message")))fail("CHAT_STREAM_EVENT_INVALID");return;}
    if(done)fail("CHAT_STREAM_AFTER_DONE");
    if(data==="[DONE]"){done=true;return;}
    let v;try{v=JSON.parse(data);}catch{fail("CHAT_STREAM_JSON_INVALID");}
    if(v?.error)fail("CHAT_STREAM_UPSTREAM_FAILED");
    if(v.model!==modelId||!Array.isArray(v.choices)||v.choices.length>1)fail("CHAT_STREAM_IDENTITY_INVALID");
    if(!v.choices.length)return;
    const choice=v.choices[0],d=choice?.delta;
    if(!d||typeof d!=="object"||d.tool_calls?.length||d.function_call)fail("CHAT_STREAM_DELTA_INVALID");
    if(d.content!==undefined&&d.content!==null&&typeof d.content!=="string")fail("CHAT_STREAM_DELTA_INVALID");
    if(typeof d.content==="string"&&d.content){
      if(finish!==null)fail("CHAT_STREAM_AFTER_FINISH");
      content+=d.content;onDelta(d.content);
    }
    if(choice.finish_reason!==null&&choice.finish_reason!==undefined){
      if(finish!==null||!["stop","length"].includes(choice.finish_reason))fail("CHAT_STREAM_FINISH_INVALID");
      finish=choice.finish_reason;
    }
  }
  function drain(){
    while(true){const m=/\r?\n\r?\n/.exec(pending);if(!m)break;event(pending.slice(0,m.index));pending=pending.slice(m.index+m[0].length);}
  }
  for await(const chunk of r.body){bytes+=chunk.length;if(bytes>2*1024*1024)fail("CHAT_STREAM_TOO_LARGE");pending+=decoder.decode(chunk,{stream:true});drain();}
  pending+=decoder.decode();drain();
  if(pending.trim()||!done||!finish||!content.trim())fail("CHAT_STREAM_INCOMPLETE");
  return {content,finish_reason:finish};
}
async function executeChat({spec,options,fetchImpl,apiKey,transport,timeoutMs,queueWaitMs=0}){
  validateChat(spec,options);
  const remaining=Math.min(timeoutMs,options.deadlineAt-Date.now());if(remaining<=0)fail("CHAT_DEADLINE_EXPIRED");
  const deadline=AbortSignal.timeout(Math.max(1,Math.floor(remaining))), signal=options.signal?AbortSignal.any([options.signal,deadline]):deadline;
  const headers={authorization:"Bearer "+apiKey,"content-type":"application/json","X-AI-Core-Client":"debug-ai"};
  const req={headers,dispatcher:transport,signal,redirect:"error"};
  const identity=await readJson(await fetchImpl(spec.origin+"/v1/models",{...req,method:"GET"}),16384);
  if(identity.object!=="list"||identity.data?.length!==1||identity.data[0]?.id!==spec.model_id)fail("CHAT_MODEL_IDENTITY_MISMATCH");
  if(signal.aborted)fail("CHAT_CANCELLED");
  const started=performance.now();
  const body={model:spec.model_id,messages:[{role:"system",content:"日本語で自然に回答する開発支援AIです。未実行の作業を実行済みと報告しないでください。この通常会話ではツールは実行できません。"},...options.messages],max_tokens:options.maxTokens,temperature:0.2,stream:typeof options.onDelta==="function",chat_template_kwargs:{enable_thinking:false}};
  const response=await fetchImpl(spec.origin+"/v1/chat/completions",{...req,method:"POST",body:JSON.stringify(body)});
  if(body.stream){
    const result=await readStream(response,spec.model_id,options.onDelta);
    if(signal.aborted)fail("CHAT_CANCELLED");
    return {...result,model_id:spec.model_id,queue_wait_ms:queueWaitMs,elapsed_ms:Math.round(performance.now()-started)};
  }
  const result=await readJson(response,2*1024*1024);
  const choice=result.choices?.[0];
  if(result.model!==spec.model_id||result.choices?.length!==1||typeof choice?.message?.content!=="string"||!choice.message.content.trim()||choice.message.tool_calls?.length||!["stop","length"].includes(choice.finish_reason))fail("CHAT_GATE_RESPONSE_INVALID");
  if(signal.aborted)fail("CHAT_CANCELLED");
  return {content:choice.message.content,model_id:result.model,finish_reason:choice.finish_reason,queue_wait_ms:queueWaitMs,elapsed_ms:Math.round(performance.now()-started)};
}
module.exports={validateChat,executeChat};
