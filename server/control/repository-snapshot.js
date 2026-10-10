"use strict";
const crypto=require("node:crypto");
const fs=require("node:fs");
const path=require("node:path");
const {execFileSync}=require("node:child_process");
const {contentHash}=require("../../orchestrator/durable-contracts.js");

const MAX_FILES=10000;
const MAX_TOTAL_BYTES=256*1024*1024;
const EXCLUDED_DIRECTORIES=new Set([".git",".debugai-input","node_modules","build","coverage","runtime","logs","tmp",".temp",".cache","patch-backups","patch-candidates","sandbox-jobs",".debugai-runtime"]);
const EMPTY_HASH=crypto.createHash("sha256").update("").digest("hex");

function sha256(value){return crypto.createHash("sha256").update(value).digest("hex");}
function inside(root,candidate){const relative=path.relative(root,candidate);return relative===""||(!relative.startsWith(`..${path.sep}`)&&relative!==".."&&!path.isAbsolute(relative));}
function relativePosix(root,candidate){
  const relative=path.relative(root,candidate);
  if(!relative||path.isAbsolute(relative)||relative===".."||relative.startsWith(`..${path.sep}`))throw new Error("REPOSITORY_SNAPSHOT_PATH_TRAVERSAL");
  const normalized=relative.split(path.sep).join("/");
  if(normalized.split("/").some(part=>part===""||part==="."||part===".."))throw new Error("REPOSITORY_SNAPSHOT_PATH_TRAVERSAL");
  return normalized;
}
function readRegularFile(file,fsImpl){
  const noFollow=fs.constants.O_NOFOLLOW||0,fd=fsImpl.openSync(file,fs.constants.O_RDONLY|noFollow);
  try{
    const stat=fsImpl.fstatSync(fd);
    if(!stat.isFile())throw new Error(`REPOSITORY_SNAPSHOT_UNSUPPORTED_FILE:${file}`);
    return fsImpl.readFileSync(fd);
  }finally{fsImpl.closeSync(fd);}
}
function sourceTreeSnapshotId(repoPath,{fsImpl=fs,maxFiles=MAX_FILES,maxTotalBytes=MAX_TOTAL_BYTES,requireGitMarker=true}={}){
  const root=path.resolve(String(repoPath||""));
  const rootStat=fsImpl.lstatSync(root);
  if(!rootStat.isDirectory()||rootStat.isSymbolicLink())throw new Error("REPOSITORY_SNAPSHOT_ROOT_UNSAFE");
  const marker=path.join(root,".git");
  if(requireGitMarker){
    const markerStat=fsImpl.lstatSync(marker);
    if((!markerStat.isDirectory()&&!markerStat.isFile())||markerStat.isSymbolicLink())throw new Error("REPOSITORY_SNAPSHOT_GIT_MARKER_UNSAFE");
  }else{
    try{const markerStat=fsImpl.lstatSync(marker);if((!markerStat.isDirectory()&&!markerStat.isFile())||markerStat.isSymbolicLink())throw new Error("REPOSITORY_SNAPSHOT_GIT_MARKER_UNSAFE");}
    catch(error){if(error?.code!=="ENOENT")throw error;}
  }
  const entries=[];let fileCount=0,totalBytes=0;
  function add(type,relativePath,contentHashValue,byteLength){
    fileCount++;
    totalBytes+=byteLength;
    if(fileCount>maxFiles)throw new Error("REPOSITORY_SNAPSHOT_FILE_LIMIT_EXCEEDED");
    if(totalBytes>maxTotalBytes)throw new Error("REPOSITORY_SNAPSHOT_BYTE_LIMIT_EXCEEDED");
    entries.push({entry_type:type,relative_path:relativePath,content_hash:contentHashValue});
  }
  function walk(directory){
    const directoryReal=fsImpl.realpathSync(directory);
    if(!inside(root,directoryReal))throw new Error("REPOSITORY_SNAPSHOT_DIRECTORY_TRAVERSAL");
    const children=fsImpl.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
    for(const child of children){
      if(child.name==="."||child.name===".."||child.name.includes("/"))throw new Error("REPOSITORY_SNAPSHOT_PATH_TRAVERSAL");
      if(child.name===".git")continue;
      const absolute=path.join(directory,child.name),relative=relativePosix(root,absolute),stat=fsImpl.lstatSync(absolute);
      if(stat.isDirectory()){
        if(EXCLUDED_DIRECTORIES.has(child.name))continue;
        add("directory",relative,EMPTY_HASH,0);walk(absolute);continue;
      }
      if(stat.isFile()){
        const contents=readRegularFile(absolute,fsImpl);add("regular",relative,sha256(contents),contents.length);continue;
      }
      if(stat.isSymbolicLink()){
        const target=fsImpl.readlinkSync(absolute),resolved=path.resolve(path.dirname(absolute),target);
        if(!inside(root,resolved))throw new Error(`REPOSITORY_SNAPSHOT_SYMLINK_TRAVERSAL:${relative}`);
        const targetBytes=Buffer.from(target,"utf8");add("symlink",relative,sha256(targetBytes),targetBytes.length);continue;
      }
      throw new Error(`REPOSITORY_SNAPSHOT_UNSUPPORTED_FILE:${relative}`);
    }
  }
  walk(root);
  entries.sort((a,b)=>a.relative_path<b.relative_path?-1:a.relative_path>b.relative_path?1:0);
  return `tree_${sha256(Buffer.from(JSON.stringify(entries),"utf8"))}`;
}
function repositorySnapshotId(repoPath,{execFileSyncImpl=execFileSync,fsImpl=fs,maxFiles=MAX_FILES,maxTotalBytes=MAX_TOTAL_BYTES,allowMissingGitMarker=false}={}){
  if(typeof repoPath!=="string"||!repoPath){const error=new Error("DURABLE_REPO_SNAPSHOT_UNAVAILABLE");error.cause=new Error("DURABLE_REPO_SNAPSHOT_REPO_REQUIRED");throw error;}
  let gitError=null;
  try{
    const head=execFileSyncImpl("git",["-C",repoPath,"rev-parse","HEAD"],{encoding:"utf8",timeout:10000,stdio:["ignore","pipe","pipe"]}).trim();
    const status=execFileSyncImpl("git",["-C",repoPath,"status","--porcelain=v1","--untracked-files=no"],{encoding:"utf8",timeout:10000,stdio:["ignore","pipe","pipe"]});
    if(!/^[a-f0-9]{40}$/i.test(head))throw new Error("INVALID_HEAD");
    // Porcelain status records changed paths, not dirty source bytes.
    // Preserve clean historical identities and bind dirty content/mode changes.
    const binding={head,status};
    if(status.trim()){
      const diff=execFileSyncImpl("git",["-C",repoPath,"diff","--binary","--no-ext-diff","--no-textconv","--submodule=diff","HEAD","--"],{encoding:"utf8",timeout:10000,maxBuffer:maxTotalBytes,stdio:["ignore","pipe","pipe"]});
      binding.tracked_diff_sha256=sha256(Buffer.from(diff,"utf8"));
    }
    return `git_${contentHash(binding)}`;
  }catch(error){gitError=error;}
  try{return sourceTreeSnapshotId(repoPath,{fsImpl,maxFiles,maxTotalBytes,requireGitMarker:!allowMissingGitMarker});}
  catch(error){const wrapped=new Error("DURABLE_REPO_SNAPSHOT_UNAVAILABLE");wrapped.cause=error;wrapped.git_cause=gitError;throw wrapped;}
}

module.exports={MAX_FILES,MAX_TOTAL_BYTES,EXCLUDED_DIRECTORIES,sourceTreeSnapshotId,repositorySnapshotId};
