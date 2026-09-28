"use strict";
const cp=require("node:child_process");

function runDocker(args){
  try{return cp.execFileSync("docker",args,{encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();}
  catch(error){const stderr=String(error?.stderr||error?.message||"").trim();throw new Error(`DOCKER_AUDIT_FAILED:${args.join(" ")}:${stderr}`);}
}
function jsonLines(text){return String(text||"").split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));}
function composeProject(labels){const raw=String(labels||"");for(const part of raw.split(",")){const [k,...rest]=part.split("=");if(k==="com.docker.compose.project")return rest.join("=");}return "";}
function isDebugAiProject(project){return project==="debug-ai"||project.startsWith("debug-ai-");}
function isProductionProject(project){return project==="debug-ai";}
function auditDockerStorage(){
  const df=runDocker(["system","df"]);
  const containers=jsonLines(runDocker(["ps","-a","--format","{{json .}}"])).map(row=>({id:row.ID,name:row.Names,state:row.State,status:row.Status,project:composeProject(row.Labels)})).filter(x=>isDebugAiProject(x.project));
  const volumes=jsonLines(runDocker(["volume","ls","--format","{{json .}}"])).map(row=>({name:row.Name,driver:row.Driver,project:composeProject(row.Labels)})).filter(x=>isDebugAiProject(x.project));
  const images=jsonLines(runDocker(["image","ls","--format","{{json .}}"])).map(row=>({id:row.ID,repository:row.Repository,tag:row.Tag,size:row.Size,created_since:row.CreatedSince})).filter(x=>String(x.repository||"").startsWith("debug-ai"));
  const stoppedTestContainers=containers.filter(x=>!isProductionProject(x.project)&&["exited","dead","created"].includes(String(x.state||"").toLowerCase()));
  const protectedProductionVolumes=volumes.filter(x=>isProductionProject(x.project));
  const isolatedVolumes=volumes.filter(x=>!isProductionProject(x.project));
  return {schema:"debugai.docker-storage-audit/v1",mode:"READ_ONLY",docker_system_df:df,debugai:{containers,images,volumes},candidates:{stopped_isolated_test_containers:stoppedTestContainers,isolated_test_volumes:isolatedVolumes},protected:{production_volumes:protectedProductionVolumes},notes:["No resource is deleted by this command.","Build cache is reported by docker system df only because Docker does not provide a safe Compose-project ownership mapping for BuildKit cache.","The production debug-ai project is never a deletion candidate."]};
}
if(require.main===module){process.stdout.write(`${JSON.stringify(auditDockerStorage(),null,2)}\n`);}
module.exports={composeProject,isDebugAiProject,isProductionProject,auditDockerStorage};
