import {inviteContext} from './src/invite-model.ts';
const status=document.getElementById('invite-status');
const form=document.getElementById('invite-password-form');
const next=document.getElementById('invite-next');
const title=document.getElementById('invite-title');
const context=inviteContext(location.href);
// Remove session credentials from the address immediately; never log the URL.
history.replaceState(null,'',location.pathname);
function showError(text){status.textContent=text;status.classList.add('is-error');}
async function accept(){
 if(context.error){showError(context.error);return;}
 const client=window.FreedomAuth?.getClient?.();if(!client){showError('Вход временно недоступен. Попробуйте открыть ссылку позже.');return;}
 try{
  const {error}=await client.auth.setSession({access_token:context.access,refresh_token:context.refresh});
  context.access=null;context.refresh=null;if(error)throw error;
  const {data,error:verifyError}=await client.auth.getUser();if(verifyError||!data.user)throw verifyError||Error('Missing user');
  if(!context.setup){location.replace('employees.html?mine=1');return;}
  title.textContent='Добро пожаловать в команду.';status.textContent='Придумайте пароль для следующих входов. В кабинете уже будут ваши разговоры и оценки.';form.hidden=false;
  form.addEventListener('submit',async event=>{
   event.preventDefault();const password=form.elements.password,confirm=form.elements.confirm,submit=form.querySelector('button');
   if(password.value!==confirm.value){confirm.setCustomValidity('Пароли не совпадают.');confirm.reportValidity();return;}
   if(!form.reportValidity())return;submit.disabled=true;submit.dataset.loading='true';status.classList.remove('is-error');status.textContent='Сохраняем пароль…';
   try{const {error}=await client.auth.updateUser({password:password.value});if(error)throw error;password.value='';confirm.value='';form.hidden=true;next.hidden=false;status.textContent='Пароль сохранён. Открываем ваш рабочий кабинет…';location.replace('employees.html?mine=1');}
   catch(error){showError(error?.code==='weak_password'?'Выберите более надёжный пароль: не менее 8 символов.':'Не удалось сохранить пароль. Попробуйте ещё раз.');}
   finally{submit.disabled=false;submit.dataset.loading='false';}
  });
  form.elements.confirm.addEventListener('input',()=>form.elements.confirm.setCustomValidity(''));
  form.elements.password.addEventListener('input',()=>form.elements.confirm.setCustomValidity(''));
 }catch{context.access=null;context.refresh=null;showError('Ссылка недействительна или срок её действия истёк. Попросите руководителя отправить новое приглашение.');}
}
accept();
