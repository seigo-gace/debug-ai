"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {createServer,safeErrorCode}=require("../http.js");

test("HTTP error log is bounded and does not print raw error message",async()=>{
  assert.equal(safeErrorCode({code:"AI CORE/HTTP 400"}),"AI_CORE_HTTP_400");
  const workflow={runAnalysis:async()=>{const error=new Error("Bearer super-secret-token should never reach docker logs");error.code="AI_CORE_HTTP";throw error;}};
  const server=createServer({workflow});
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const address=server.address(),logs=[],original=console.error;console.error=(...args)=>logs.push(args.join(" "));
  try{
    const response=await fetch(`http://127.0.0.1:${address.port}/v1/analyze`,{method:"POST",headers:{"content-type":"application/json"},body:"{}"});
    assert.equal(response.status,400);const body=await response.json();assert.equal(body.code,"AI_CORE_HTTP");assert.match(body.error,/super-secret-token/);
    assert.equal(logs.length,1);assert.match(logs[0],/path=\/v1\/analyze/);assert.match(logs[0],/code=AI_CORE_HTTP/);assert.doesNotMatch(logs[0],/super-secret-token/);assert.doesNotMatch(logs[0],/Bearer/);
  }finally{console.error=original;await new Promise(resolve=>server.close(resolve));}
});
