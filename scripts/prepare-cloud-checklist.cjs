const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const esbuild=require('esbuild');
const root=path.resolve(__dirname,'..');
const code=esbuild.buildSync({entryPoints:[path.join(root,'src/qa-model.ts')],bundle:true,write:false,format:'iife',globalName:'CqaModel',platform:'browser'}).outputFiles[0].text;
const context={};vm.createContext(context);vm.runInContext(code,context);
fs.mkdirSync(path.join(root,'lib'),{recursive:true});
fs.writeFileSync(path.join(root,'lib/cqa-checklist.mjs'),'// Canonical online checklist; regenerate with scripts/prepare-cloud-checklist.cjs.\nexport const checklist='+JSON.stringify(context.CqaModel.initialChecklist,null,2)+';\n');
