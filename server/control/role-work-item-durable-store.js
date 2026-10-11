"use strict";
const {createHash}=require("node:crypto");
const {ContinuationError}=require("./role-work-item-continuation.js");

/**
 * Reuses RunAuthority's existing atomic durable commit and immutable records.
 * No second database, coordinator, model routing or role-state singleton.
 */
function makeRoleWorkItemDurableStore({authority,runId}={}){
  if(!authority?.durableEnabled?.()||typeof authority.commitDurable!=="function")
    throw new ContinuationError("DURABLE_AUTHORITY_REQUIRED");
  if(typeof runId!=="string"||!/^[A-Za-z0-9._-]{1,200}$/.test(runId))
    throw new ContinuationError("RUN_ID_INVALID");
  function locate(key){
    const tuple=JSON.parse(key);
    if(!Array.isArray(tuple)||tuple.length!==3||tuple[0]!==runId)
      throw new ContinuationError("WORK_ITEM_KEY_INVALID");
    const hash=createHash("sha256").update(key).digest("hex");
    return {index:"role_work_item_"+hash,pathPrefix:"durable/work-item/"+runId+"/"+hash};
  }
  return {
    async load(key){
      const {index}=locate(key);
      const {manifest}=authority.loadDurable(runId);
      const ref=manifest.workflow_input_refs?.[index];
      if(!ref)return null;
      const record=authority.readDurableRecord(ref);
      if(record?.schema!=="role-work-item-continuation/v1"||record?.key!==key)
        throw new ContinuationError("WORK_ITEM_RECORD_INVALID");
      return record;
    },
    async commit(key,revision,nextState){
      const {index,pathPrefix}=locate(key);
      const {manifest}=authority.loadDurable(runId);
      const ref=manifest.workflow_input_refs?.[index];
      let previous=null;
      if(ref){
        previous=authority.readDurableRecord(ref);
        if(previous?.key!==key||previous?.schema!=="role-work-item-continuation/v1")
          throw new ContinuationError("WORK_ITEM_RECORD_INVALID");
      }
      if((previous?.revision??0)!==revision||nextState.revision!==revision+1||nextState.key!==key)
        throw new ContinuationError("STALE_WORK_ITEM_REVISION");
      const path=pathPrefix+"/"+String(nextState.revision).padStart(6,"0")+".json";
      try{
        await authority.commitDurable({runId,manifestPatch:{workflow_input_refs:{[index]:path}},
          immutableRecords:[{path,record:nextState}]});
      }catch(error){
        // Existing durable authority rejects stale writer generation/epoch.
        // Never retry a speculative conflicting record write here.
        throw error;
      }
    }
  };
}
module.exports={makeRoleWorkItemDurableStore};
