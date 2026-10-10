"use strict";

const NODE_ERROR_CODES=new Set(["ENOENT","EACCES","EPERM","EBUSY","EEXIST","EISDIR","ENOTDIR","EMFILE","ENOSPC","EROFS","EINVAL"]);
const RUN_ID_PATTERN=/\brun_[a-z0-9_-]+\b/i;
const LONG_HEX=/[a-f0-9]{32,}/i;
const UPPER_SNAKE=/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;
const FIRST_UPPER_SNAKE=/^([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*)/;

function labelSafe(label){
  if(typeof label!=="string"||!label||label.length>64)return false;
  if(!UPPER_SNAKE.test(label))return false;
  if(/[/\\@]/.test(label))return false;
  if(RUN_ID_PATTERN.test(label))return false;
  if(LONG_HEX.test(label))return false;
  return true;
}

function classifyRetentionError(raw){
  const text=String(raw??"").trim();
  if(!text)return"OTHER";
  for(const code of NODE_ERROR_CODES){
    if(text===code||text.startsWith(`${code}:`)||new RegExp(`\\b${code}\\b`).test(text))return`NODE_${code}`;
  }
  const head=text.split(":")[0].trim();
  const match=head.match(FIRST_UPPER_SNAKE);
  if(match&&labelSafe(match[1]))return match[1];
  return"OTHER";
}

function summarizeRetentionErrorClasses(items,{maxClasses=32}={}){
  const counts=new Map();
  for(const item of items||[]){
    if(!item||typeof item.error!=="string")continue;
    const label=classifyRetentionError(item.error);
    counts.set(label,(counts.get(label)||0)+1);
  }
  const max=Number.isInteger(maxClasses)&&maxClasses>1?maxClasses:32;
  const keys=[...counts.keys()].sort((a,b)=>a.localeCompare(b));
  if(keys.length<=max)return{counts:Object.fromEntries(keys.map(k=>[k,counts.get(k)]))};
  const kept=keys.slice(0,max-1);
  let other=0;
  for(const key of keys.slice(max-1))other+=counts.get(key);
  if(counts.has("OTHER"))other+=counts.get("OTHER");
  const out=Object.fromEntries(kept.map(k=>[k,counts.get(k)]));
  if(other>0)out.OTHER=other;
  return{counts:out};
}

function formatRetentionErrorHistogram(domain,summary){
  const prefix=String(domain??"").trim();
  if(!prefix)return"";
  const counts=summary?.counts&&typeof summary.counts==="object"?summary.counts:{};
  const keys=Object.keys(counts).filter(k=>Number.isInteger(counts[k])&&counts[k]>0).sort((a,b)=>a.localeCompare(b));
  if(!keys.length)return"";
  const body=keys.map(k=>`${k}:${counts[k]}`).join(",");
  const fragment=`${prefix}_classes=${body}`;
  if(/[/\\@]/.test(fragment)||RUN_ID_PATTERN.test(fragment)||LONG_HEX.test(fragment))return`${prefix}_classes=OTHER:${keys.reduce((n,k)=>n+counts[k],0)}`;
  return fragment;
}

module.exports={classifyRetentionError,summarizeRetentionErrorClasses,formatRetentionErrorHistogram};
