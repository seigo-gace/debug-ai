"use strict";
const fs=require("node:fs"),path=require("node:path");
const SCHEMA="debugai.teaching-weight-status/v1";
function fail(code){const e=new Error(code);e.code=code;throw e;}
function resolveManifestPath(){
  const env=process.env.DEBUG_AI_QWEN_TEACHING_WEIGHT_MANIFEST;
  if(env&&path.isAbsolute(env)&&fs.existsSync(env))return env;
  const dflt="/workspace/ai-core/.ai-core/runs/qwen35-teacher-sft-v1-interactive-20261128/training-result.json";
  if(fs.existsSync(dflt))return dflt;
  return null;
}
function readWeightManifest(){
  const manifestPath=resolveManifestPath();
  if(!manifestPath)return {schema:SCHEMA,connected:false,weight_update:false,weight_status:"NOT_CONNECTED",manifest_path:null};
  let manifest;
  try{manifest=JSON.parse(fs.readFileSync(manifestPath,"utf8"));}catch{return {schema:SCHEMA,connected:false,weight_update:false,weight_status:"MANIFEST_INVALID",manifest_path:manifestPath}};
  const adapterDir=path.dirname(manifestPath);
  const adapterOk=fs.existsSync(path.join(adapterDir,"adapter_model.safetensors"))&&fs.existsSync(path.join(adapterDir,"adapter_config.json"));
  const gateLora=process.env.DEBUG_AI_QWEN35_GATE_LORA_GGUF;
  const gateGguf=gateLora&&fs.existsSync(gateLora)?gateLora:gateLora&&fs.existsSync(path.join("/home/admin1/projects/ai-core/models",path.basename(gateLora)))?path.join("/home/admin1/projects/ai-core/models",path.basename(gateLora)):null;
  const peftOrigin=process.env.DEBUG_AI_QWEN35_TEACHING_ORIGIN||"http://127.0.0.1:18187";
  const trained=adapterOk&&manifest.adapter_after_sha256&&manifest.adapter_before_sha256!==manifest.adapter_after_sha256;
  const quality=manifest.independent_quality_status==="HOLDOUT_LOSS_REDUCED";
  const weight_update=trained&&quality;
  let weight_status="ADAPTER_NOT_QUALIFIED";
  if(weight_update){
    if(gateGguf)weight_status="ADAPTER_IN_GATE";
    else if(process.env.DEBUG_AI_QWEN35_TEACHING_PEFT==="true")weight_status="ADAPTER_PEFT_SERVER";
    else weight_status="ADAPTER_TRAINED_NOT_IN_GATE";
  }
  return {schema:SCHEMA,connected:true,weight_update,weight_status,
    manifest_path:manifestPath,adapter_dir:adapterDir,adapter_after_sha256:manifest.adapter_after_sha256||null,
    optimizer_steps:manifest.optimizer_steps||null,mean_training_loss:manifest.mean_training_loss||null,
    holdout_loss_before:manifest.holdout_loss_before??null,holdout_loss_after:manifest.holdout_loss_after??null,
    interactive_examples:manifest.interactive_examples??null,gate_lora_gguf:gateGguf,peft_origin:peftOrigin,
    student_model_gate:weight_status==="ADAPTER_PEFT_SERVER"?"qwen35_teaching":weight_status==="ADAPTER_IN_GATE"?"qwen35":"qwen35"};
}
function writeRuntimeStatus(runtimeRoot,status){
  if(!runtimeRoot||!path.isAbsolute(runtimeRoot))fail("TEACHING_WEIGHT_RUNTIME_INVALID");
  const root=path.join(runtimeRoot,"teaching-kb");
  fs.mkdirSync(root,{recursive:true,mode:0o700});
  const file=path.join(root,"weight-status.json");
  fs.writeFileSync(file,JSON.stringify({...status,updated_at:new Date().toISOString()})+"\n",{mode:0o600});
  return file;
}
module.exports={SCHEMA,readWeightManifest,writeRuntimeStatus,resolveManifestPath};