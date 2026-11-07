import {createClient} from 'npm:@supabase/supabase-js@2.119.0';
import {inviteHandler,type Invite} from './handler.ts';
const url=Deno.env.get('SUPABASE_URL')!;
const anonKey=Deno.env.get('SUPABASE_ANON_KEY')!;
const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
const unwrap=<T>({data,error}:{data:T;error:any}):T=>{if(error)throw error;return data;};
Deno.serve(inviteHandler({
 async authenticate(token){const client=createClient(url,anonKey,options);const {data,error}=await client.auth.getUser(token);return error?null:data.user?.id??null;},
 async isManager(token,id){const scoped=createClient(url,anonKey,{...options,global:{headers:{Authorization:'Bearer '+token}}});const {data,error}=await scoped.from('cqa_managers').select('user_id').eq('user_id',id).maybeSingle();return !error&&!!data;},
 async prepare(id,email,manager){const admin=createClient(url,serviceKey,options);return unwrap(await admin.rpc('cqa_prepare_employee_invite',{p_employee_id:id,p_email:email,p_manager_id:manager})) as Invite;},
 async sendNew(email,name,redirect){const admin=createClient(url,serviceKey,options);const data=unwrap(await admin.auth.admin.inviteUserByEmail(email,{redirectTo:redirect,data:{employee_name:name}}));if(!data.user)throw Error('Invitation user missing');return data.user.id;},
 async sendExisting(email,redirect){const client=createClient(url,anonKey,options);const {error}=await client.auth.signInWithOtp({email,options:{shouldCreateUser:false,emailRedirectTo:redirect}});if(error)throw error;},
 async finish(invite,userId,error){const admin=createClient(url,serviceKey,options);const patch=error?{invitation_status:'error',invitation_error:error}:{user_id:userId,invitation_status:'sent',invited_at:new Date().toISOString(),invitation_error:null};const result=unwrap(await admin.from('cqa_employees').update(patch).eq('id',invite.id).eq('invitation_attempt_id',invite.attemptId).select('id').maybeSingle());if(!result)throw Error('Invitation changed while sending');},
}));
