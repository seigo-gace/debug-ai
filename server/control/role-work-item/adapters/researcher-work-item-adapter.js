"use strict";
const {continueRoleWorkItem}=require("../adapter.js");
async function continueResearcherWorkItem(props){return continueRoleWorkItem({...props,role:"researcher"});}
module.exports={continueResearcherWorkItem};
