"use strict";
function roleWorkItemPendingCode(role){
  const normalized=String(role||"").toUpperCase().replace(/-/g,"_");
  return `${normalized}_WORK_ITEM_CONTINUE_PENDING`;
}
function isRoleWorkItemPending(code){
  return String(code||"").endsWith("_WORK_ITEM_CONTINUE_PENDING");
}
function makeRoleWorkItemContinuePending(role){
  const code=roleWorkItemPendingCode(role);
  const pending=new Error(code);
  pending.code=code;
  return pending;
}
module.exports={roleWorkItemPendingCode,isRoleWorkItemPending,makeRoleWorkItemContinuePending};
