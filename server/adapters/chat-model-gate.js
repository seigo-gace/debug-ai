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
  const body={model:spec.model_id,messages:[{role:"system",content:"日本語で自然に回答する開発支援AIです。未実行の作業を実行済みと報告しないでください。この通常会話ではツールは実行できません。"},...options.messages],max_tokens:options.maxTokens,temperature:0.2,stream:false,chat_template_kwargs:{enable_thinking:false}};
  const result=await readJson(await fetchImpl(spec.origin+"/v1/chat/completions",{...req,method:"POST",body:JSON.stringify(body)}),2*1024*1024);
  const choice=result.choices?.[0];
  if(result.model!==spec.model_id||result.choices?.length!==1||typeof choice?.message?.content!=="string"||!choice.message.content.trim()||choice.message.tool_calls?.length||!["stop","length"].includes(choice.finish_reason))fail("CHAT_GATE_RESPONSE_INVALID");
  if(signal.aborted)fail("CHAT_CANCELLED");
  return {content:choice.message.content,model_id:result.model,finish_reason:choice.finish_reason,queue_wait_ms:queueWaitMs,elapsed_ms:Math.round(performance.now()-started)};
}
module.exports={validateChat,executeChat};
