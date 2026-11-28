"use strict";
const fs=require("node:fs"),path=require("node:path");
const {persistTeachingCandidate}=require("./teaching-kb-store.js");
const fail=code=>{throw Object.assign(new Error(code),{code});};
const read=p=>JSON.parse(fs.readFileSync(p,"utf8"));
const batchRoot=process.argv[2],runtimeRoot=process.argv[3]||batchRoot;
if(!batchRoot||!path.isAbsolute(batchRoot))fail("TEACHING_KB_BACKFILL_PATH_INVALID");
async function main(){
  let tg=null;try{if(process.env.DEBUG_AI_TGSERVER_URL)tg=require("../adapters/tgserver.js").createTgserverAdapter();}catch{}
  const status=read(path.join(batchRoot,"status.json"));
  const out=[];
  for(const row of status.lessons||[]){
    const f=path.join(batchRoot,row.id+".json");if(!fs.existsSync(f))continue;
    const teaching=read(f).turns?.[0]?.teaching;
    if(!teaching||teaching.schema!=="debugai.interactive-teaching/v1")continue;
    out.push(await persistTeachingCandidate({runtimeRoot,tgserver:tg,batchId:status.id,chatId:row.id,topic:row.topic,result:teaching}));
  }
  console.log(JSON.stringify({schema:"debugai.teaching-kb-backfill/v1",batch:status.id,records:out.length,kb_statuses:out.map(r=>r.kb_status)}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});