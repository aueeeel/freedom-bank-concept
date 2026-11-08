const esbuild=require('esbuild'),path=require('node:path'),fs=require('node:fs'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),out=path.join(root,'tmp/cloud-client-test.mjs');
fs.mkdirSync(path.dirname(out),{recursive:true});
esbuild.buildSync({entryPoints:[path.join(root,'scripts/test-cloud-client.ts')],outfile:out,bundle:true,platform:'node',format:'esm',target:'node22'});
execFileSync(process.execPath,[out],{stdio:'inherit'});
