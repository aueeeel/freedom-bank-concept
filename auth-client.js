import {createClient} from '@supabase/supabase-js';

const config = window.FREEDOM_AUTH_CONFIG;
const client = config?.url && config?.publishableKey ? createClient(config.url,config.publishableKey,{
  auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,storageKey:'freedom-concept-auth-v1'},
}) : null;
const dialog = document.querySelector('.auth-dialog');
const form = document.querySelector('#auth-form');
const emailInput = form.elements.email;
const passwordInput = form.elements.password;
const confirmInput = form.elements.confirm;
const submit = form.querySelector('.auth-submit');
const message = form.querySelector('.auth-message');
const account = dialog.querySelector('.account-view');
const tabs = dialog.querySelector('.auth-tabs');
let mode = 'login', user = null, busy = false, lastPublishedUser = null;

// Навигация по ролям: «Проверка» видна всегда; сотруднику раздел «Сотрудники» показывается как «Мой кабинет»,
// а у руководителя вместо «Приложения» — «Апелляции» сотрудников.
let role = 'guest', roleRequest = 0;
function applyRoleNav() {
  document.body.dataset.workspaceRole = role;
  const appealsPage = /employees\.html$/.test(location.pathname) && new URLSearchParams(location.search).get('tab') === 'appeals';
  document.querySelectorAll('.segment[data-panel="check"]').forEach(button => { button.hidden = false; });
  document.querySelectorAll('.segment[data-panel="employees"]').forEach(button => {
    button.textContent = role === 'employee' ? 'Мой кабинет' : 'Сотрудники';
    if (appealsPage) { button.setAttribute('aria-checked', 'false'); button.tabIndex = -1; }
  });
  document.querySelectorAll('.segment[data-panel="app"]').forEach(button => {
    if (role === 'manager') {
      button.textContent = 'Апелляции';
      button.dataset.pageRoute = 'employees.html?tab=appeals';
      button.setAttribute('aria-checked', String(appealsPage));
      button.tabIndex = appealsPage ? 0 : -1;
    } else {
      button.textContent = 'Приложение';
      delete button.dataset.pageRoute;
    }
  });
}
async function loadRole() {
  const call = ++roleRequest;
  let next = 'guest';
  if (user && client) {
    try {
      const {data, error} = await client.from('cqa_managers').select('user_id').eq('user_id', user.id);
      next = !error && data?.length ? 'manager' : 'employee';
    } catch { next = 'employee'; }
  }
  if (call !== roleRequest) return;
  role = next;
  applyRoleNav();
}
function updateHeader() {
  document.querySelectorAll('[data-auth="login"]').forEach(button => {
    button.textContent = user ? 'Мой профиль' : 'Войти';
  });
  document.querySelectorAll('[data-auth="signup"]').forEach(button => {button.hidden=!!user;});
}
function renderAccount() {
  const signedIn = !!user;
  form.hidden=signedIn;tabs.hidden=signedIn;account.hidden=!signedIn;
  if(signedIn){
    dialog.querySelector('#auth-title').textContent='Вы на своей стороне.';
    account.querySelector('.account-email').textContent=user.email||'';
    account.querySelector('.account-message').textContent='';
    if(!account.querySelector('.account-work-profile')){const link=document.createElement('a');link.className='button button-secondary account-work-profile';link.href='employees.html?mine=1';link.textContent='Рабочий профиль';account.append(link);}
  }
  updateHeader();
  if(lastPublishedUser!==user?.id){lastPublishedUser=user?.id;loadRole();window.dispatchEvent(new CustomEvent('freedom-auth-change'));}
}
function setMode(next) {
  mode=next==='signup'?'signup':'login';
  message.textContent='';message.classList.remove('error');
  dialog.querySelector('#auth-title').textContent=mode==='signup'?'Начни со свободы.':'С возвращением.';
  tabs.querySelectorAll('[data-auth-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.authMode===mode)));
  dialog.querySelector('.signup-confirm').hidden=mode!=='signup';
  dialog.querySelector('.password-hint').hidden=mode!=='signup';
  confirmInput.required=mode==='signup';confirmInput.value='';confirmInput.setCustomValidity('');
  passwordInput.minLength=mode==='signup'?8:1;
  passwordInput.autocomplete=mode==='signup'?'new-password':'current-password';
  passwordInput.type='password';passwordInput.value='';
  dialog.querySelector('.password-toggle').textContent='Показать';
  dialog.querySelector('.password-toggle').setAttribute('aria-label','Показать пароль');
  submit.textContent=mode==='signup'?'Создать аккаунт':'Войти';
  if(!client){message.textContent='Регистрация и вход скоро появятся. Сейчас сервис подключается.';submit.disabled=true;}
}
function setBusy(value) {
  busy=value;submit.disabled=value||!client;
  submit.dataset.loading=String(value);
  submit.setAttribute('aria-busy',String(value));
  form.setAttribute('aria-busy',String(value));
  tabs.querySelectorAll('button').forEach(button=>button.disabled=value);
  for(const input of [emailInput,passwordInput,confirmInput])input.readOnly=value;
  submit.textContent=mode==='signup'?'Создать аккаунт':'Войти';
}
function errorMessage(error) {
  const messages={
    invalid_credentials:'Проверьте почту и пароль.',
    user_already_exists:'Этот email уже зарегистрирован. Попробуйте войти.',
    email_exists:'Этот email уже зарегистрирован. Попробуйте войти.',
    weak_password:'Выберите более надёжный пароль: не менее 8 символов.',
    email_not_confirmed:'Вход ещё не настроен. Попробуйте позже.',
    over_request_rate_limit:'Слишком много попыток. Подождите немного и попробуйте снова.',
    over_email_send_rate_limit:'Слишком много попыток. Попробуйте позже.',
    signup_disabled:'Регистрация временно недоступна.',
    email_address_invalid:'Проверьте адрес электронной почты.',
  };
  return messages[error?.code] || (error?.name==='AuthRetryableFetchError' ? 'Нет связи с сервисом. Проверьте интернет и попробуйте снова.' : 'Не удалось выполнить запрос. Попробуйте ещё раз.');
}
window.FreedomAuth = {getClient(){return client;},getUser(){return user?{id:user.id,email:user.email}:null;},open(next='login'){
  if(!busy)setMode(next);
  renderAccount();
  if(!dialog.open)dialog.showModal();
  if(!user&&!busy)emailInput.focus();
}};
tabs.addEventListener('click',event=>{
  const button=event.target.closest('[data-auth-mode]');if(button&&!busy){setMode(button.dataset.authMode);emailInput.focus();}
});
dialog.querySelector('.password-toggle').addEventListener('click',()=>{
  const show=passwordInput.type==='password';passwordInput.type=show?'text':'password';
  dialog.querySelector('.password-toggle').textContent=show?'Скрыть':'Показать';
  dialog.querySelector('.password-toggle').setAttribute('aria-label',show?'Скрыть пароль':'Показать пароль');
});
confirmInput.addEventListener('input',()=>confirmInput.setCustomValidity(''));
passwordInput.addEventListener('input',()=>confirmInput.setCustomValidity(''));
form.addEventListener('submit',async event=>{
  event.preventDefault();if(busy||!client)return;
  if(mode==='signup'&&passwordInput.value!==confirmInput.value){confirmInput.setCustomValidity('Пароли не совпадают.');confirmInput.reportValidity();return;}
  if(!form.reportValidity())return;
  const credentials={email:emailInput.value.trim(),password:passwordInput.value};
  setBusy(true);message.textContent='';message.classList.remove('error');
  try {
    const {data,error}=mode==='signup'?await client.auth.signUp(credentials):await client.auth.signInWithPassword(credentials);
    if(error)throw error;
    if(!data.session||!data.user){message.textContent='Регистрация ещё не доступна. Попробуйте позже.';message.classList.add('error');return;}
    user=data.user;passwordInput.value='';confirmInput.value='';renderAccount();
  }catch(error){message.textContent=errorMessage(error);message.classList.add('error');}
  finally{credentials.password='';setBusy(false);}
});
dialog.querySelector('.account-logout').addEventListener('click',async event=>{
  if(!client)return;const button=event.currentTarget;button.disabled=true;button.dataset.loading='true';button.setAttribute('aria-busy','true');
  try {
    const {error}=await client.auth.signOut({scope:'local'});if(error)throw error;
    user=null;setMode('login');renderAccount();emailInput.focus();
  }catch{account.querySelector('.account-message').textContent='Не удалось выйти. Попробуйте ещё раз.';}
  finally{button.disabled=false;button.dataset.loading='false';button.setAttribute('aria-busy','false');}
});
function close(){dialog.close();}
dialog.querySelector('.auth-close').addEventListener('click',close);
dialog.querySelector('.account-continue').addEventListener('click',close);
dialog.addEventListener('click',event=>{const r=dialog.getBoundingClientRect();if(event.target===dialog&&(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom))close();});
dialog.addEventListener('close',()=>{passwordInput.value='';confirmInput.value='';});
if(client){
  client.auth.onAuthStateChange((_event,session)=>{user=session?.user||null;renderAccount();});
  client.auth.getSession().then(async({data})=>{
    if(!data.session)return;
    const {data:verified,error}=await client.auth.getUser();
    if(!error){user=verified.user;renderAccount();}
    else if(error.status===401||error.status===403){await client.auth.signOut({scope:'local'});user=null;renderAccount();}
  }).catch(()=>{});
}
setMode('login');updateHeader();applyRoleNav();
