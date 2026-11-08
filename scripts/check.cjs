const {spawnSync}=require('node:child_process');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const files=['api/coach.mjs','lib/coach-engine.mjs','lib/coach-handler.mjs','lib/coach-profile.mjs','coach.js','coach-config.js','app.js','media.js','segmented-navbar.js','server.cjs','auth-client.js','employees.js','wave-background.js','qa.js','invite-client.js','invite.js','cqa-local-model.cjs','api/cqa.mjs','lib/cqa-queue.mjs'];
for(const file of files){
 const result=spawnSync(process.execPath,['--check',file],{cwd:root,stdio:'inherit',timeout:30000});
 if(result.error)throw result.error;
 if(result.status!==0)process.exit(result.status??1);
}
console.log(`Syntax checks passed for ${files.length} browser and server files.`);
