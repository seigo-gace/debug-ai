"use strict";
const {continueRoleWorkItem}=require("../adapter.js");
async function continuePatchEngineerWorkItem(props){return continueRoleWorkItem({...props,role:"patch_engineer"});}
module.exports={continuePatchEngineerWorkItem};
