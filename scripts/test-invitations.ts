import assert from 'node:assert/strict';
import {inviteHandler,type InviteDependencies} from '../supabase/functions/cqa-invite-employee/handler';
import {inviteContext} from '../src/invite-model';
const id='11111111-1111-4111-8111-111111111111';
function setup(existing=false,fail=false){const calls:string[]=[];const deps:InviteDependencies={authenticate:async token=>token==='valid'?'manager':null,isManager:async()=>true,prepare:async(_id,email,manager)=>{assert.equal(manager,'manager');calls.push('prepare');return{id,name:'Test',email,userId:existing?'existing-user':null,needsPassword:!existing,attemptId:'attempt'};},sendNew:async(_email,_name,redirect)=>{calls.push('new');assert.equal(redirect,'https://freedom-bank-concept.vercel.app/invite.html?setup=1');if(fail)throw Error('SMTP password and provider details must not be returned');return'new-user';},sendExisting:async(_email,redirect)=>{calls.push('existing');assert.equal(redirect,'https://freedom-bank-concept.vercel.app/invite.html?setup=0');},finish:async(_invite,user,error)=>{calls.push(error?'failed':'sent');assert.equal(user,error?null:existing?'existing-user':'new-user');}};return{deps,calls,run:inviteHandler(deps)};}
function request(body:object|string={employeeId:id,email:'Employee@example.com'},token='valid',origin='https://freedom-bank-concept.vercel.app'){return new Request('https://functions.example.com/invite',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Origin:origin},body:typeof body==='string'?body:JSON.stringify(body)});}
let s=setup();let r=await s.run(request());assert.equal(r.status,200);assert.deepEqual(s.calls,['prepare','new','sent']);assert.equal((await r.json()).status,'sent');
s=setup(true);r=await s.run(request());assert.equal(r.status,200);assert.deepEqual(s.calls,['prepare','existing','sent']);
s=setup(false,true);r=await s.run(request());assert.equal(r.status,502);assert.deepEqual(s.calls,['prepare','new','failed']);assert.ok(!(await r.text()).includes('password'));
s=setup();r=await s.run(request({},'invalid'));assert.equal(r.status,401);assert.deepEqual(s.calls,[]);
s=setup();s.deps.isManager=async()=>false;r=await s.run(request());assert.equal(r.status,403);assert.deepEqual(s.calls,[]);
s=setup();r=await s.run(request({employeeId:id,email:'wrong'}));assert.equal(r.status,400);assert.deepEqual(s.calls,[]);
s=setup();r=await s.run(request(undefined,'valid','https://untrusted.example'));assert.equal(r.status,403);assert.deepEqual(s.calls,[]);
s=setup();r=await s.run(request('x'.repeat(4097)));assert.equal(r.status,413);assert.deepEqual(s.calls,[]);
s=setup();s.deps.prepare=async()=>{throw Error('Повторить приглашение можно через минуту');};r=await s.run(request());assert.equal(r.status,429);
const context=inviteContext('https://site.example/invite.html?setup=1#access_token=fake&refresh_token=fake-refresh&type=invite');assert.equal(context.setup,true);assert.equal(context.access,'fake');assert.equal(inviteContext('https://site.example/invite.html').access,null);assert.equal(inviteContext('https://site.example/invite.html#error=expired').access,null);assert.ok(inviteContext('https://site.example/invite.html#access_token=only').error);
console.log('Invitation checks passed: manager-only authorization, new/existing account, SMTP error handling, status accuracy, cooldown, CORS, payload limits, callback validation.');
