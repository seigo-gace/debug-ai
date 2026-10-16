"use strict";
const {continueRoleWorkItem}=require("../adapter.js");
async function continueLocalReviewerWorkItem(props){return continueRoleWorkItem({...props,role:"local_reviewer"});}
module.exports={continueLocalReviewerWorkItem};
