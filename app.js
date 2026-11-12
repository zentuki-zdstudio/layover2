/* LAYOVER v0.2: actual Supabase auth, profiles, invite-only group chat.
   This is not connected until public project credentials are set in config.js. */
const $ = s => document.querySelector(s);
const clean = value => String(value ?? '').replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const abbreviate = value => String(value || 'T').trim().slice(0,1).toUpperCase();
const when = value => value ? new Date(value).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) : '';
const urlId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}${Math.random()}`;
const cfg = window.LAYOVER_CONFIG || {};
const validConfig = /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test((cfg.supabaseUrl||'').trim()) && (cfg.publishableKey||'').trim().length>20;
let supabase = null;
let user = null;
let profile = null;
let groups = [];
let invites = [];
let activeGroupId = null;
let members = [];
let messages = [];
let groupPendingInvites = [];
let route = 'chats';
let modal = '';
let authMode = 'login';
let recoveryMode = false;
let signingIn = false;
let loading = true;
let liveChannel = null;
let avatarCache = new Map();
let memberCache = new Map();
let toastsTimer;
let currentEpoch = 0;
const icon = {chats:'💬', profile:'👤', invites:'✉️'};
const currentGroup = () => groups.find(g => g.id === activeGroupId);
const myRole = () => currentGroup()?.role || 'member';
const canManage = () => ['owner','admin'].includes(myRole());
const display = p => p?.display_name || p?.username || 'Traveler';
const root = $('#root');

function showToast(text, isError=false){const n=$('#toast');n.textContent=text;n.style.background=isError?'#803a38':'#1d3a35';n.classList.add('show');clearTimeout(toastsTimer);toastsTimer=setTimeout(()=>n.classList.remove('show'),4400);}
function fail(error, fallback='Something went wrong'){console.error(error);showToast(error?.message || fallback,true);}
function avatar(p, size=''){
  const path=p?.avatar_path;const cached=path && avatarCache.get(path);
  const markup=cached && cached.expires > Date.now() ? `<img src="${clean(cached.url)}" alt="" loading="lazy">` : clean(abbreviate(display(p)));
  return `<span class="avatar ${size}">${markup}</span>`;
}
async function signAvatar(path){
  if(!path || !supabase) return;
  const old=avatarCache.get(path);
  if(old && old.expires>Date.now()+45000) return;
  const {data,error}=await supabase.storage.from('avatars').createSignedUrl(path,3600);
  if(!error && data?.signedUrl) avatarCache.set(path,{url:data.signedUrl,expires:Date.now()+3300000});
}
async function signMany(profiles){await Promise.all([...new Set(profiles.map(p=>p?.avatar_path).filter(Boolean))].map(signAvatar));}
function shell(){
  const tabs=[['chats','Circles & chats'],['invites','Invitations'],['profile','My profile']];
  const navButton=([key,title])=>`<button class="navbtn ${route===key?'active':''}" data-action="nav" data-route="${key}" aria-current="${route===key?'page':'false'}"><span>${icon[key]}</span> ${title}${key==='invites'&&invites.length?` <span class="badge">${invites.length}</span>`:''}</button>`;
  return `<div class="layout"><aside class="side"><div class="brand"><span class="mark">✳</span> LAYOVER<b>.</b></div><p class="tag">The people make the journey.</p><nav>${tabs.map(navButton).join('')}</nav><div class="side-end"><b>✳ Your circles are yours.</b><br>Only invited members can read the conversation. Share personal details thoughtfully.</div></aside><div class="maincol"><header class="top"><div class="topbrand"><span>✳</span> LAYOVER.</div><span class="topsmall">YOUR PEOPLE, EVERYWHERE</span><button class="toplink" data-action="nav" data-route="profile">${avatar(profile)} ${clean(display(profile))}</button></header><main class="main">${route==='profile'?profilePage():route==='invites'?invitesPage():chatsPage()}</main><nav class="footer-nav" aria-label="App navigation">${tabs.map(([k,t])=>`<button data-action="nav" data-route="${k}" class="${route===k?'active':''}"><span style="font-size:19px">${icon[k]}</span>${k==='chats'?'Chats':k==='invites'?`Invites ${invites.length?`(${invites.length})`:''}`:'Profile'}</button>`).join('')}</nav></div></div>${modal ? modalView() : ''}`;
}
function render(){
  if(!validConfig){root.innerHTML=setupView();return;}
  if(loading){root.innerHTML='<div class="startup"><span class="mark">✳</span><h1>LAYOVER.</h1><p>Connecting your circles…</p></div>';return;}
  if(!user || recoveryMode){root.innerHTML=authView();return;}
  root.innerHTML=shell();
  if(route==='chats'&&activeGroupId)scrollMessages();
}
function setupView(){return `<div class="authwrap"><div class="authart"><div class="brand"><span class="mark">✳</span> LAYOVER.</div><h1>Build a circle.<br><em>Keep your people.</em></h1><p>Private group chats and real traveler profiles — built for connections that survive checkout.</p><div class="foot">v0.2 · AUTH + PRIVATE CIRCLES</div></div><div class="authformwrap"><div class="authform"><div class="eyebrow">ONE-TIME SETUP</div><h2>Connect Supabase</h2><p class="formtext">The app is ready, but has no database credentials yet. Create a Supabase project, run the included <code>supabase/schema.sql</code> once, then edit <code>config.js</code>.</p><div class="panel stack"><p><b>1.</b> Create a project at <a href="https://supabase.com/dashboard" target="_blank" rel="noopener noreferrer">Supabase Dashboard</a>.</p><p><b>2.</b> Paste <code>supabase/schema.sql</code> into SQL Editor and run it.</p><p><b>3.</b> Copy your Project URL and <b>publishable</b> key to <code>config.js</code>.</p><p><b>4.</b> Add this site's address to Auth → URL Configuration.</p></div><p class="info">Use only the public/publishable key. Never paste a service_role or secret key into a website.</p><p class="hint" style="margin-top:18px">Full instructions in README.md.</p></div></div></div>`;}
function authView(){
  const signup=authMode==='signup';const reset=authMode==='forgot';const recover=recoveryMode;
  return `<div class="authwrap"><section class="authart"><div class="brand"><span class="mark">✳</span> LAYOVER.</div><h1>Meet somewhere.<br><em>Stay connected.</em></h1><p>Private circles for friends you met on the road. No endless public feeds, no random strangers in your group.</p><div class="foot">✳ YOUR PEOPLE, EVERYWHERE.</div></section><section class="authformwrap"><div class="authform"><div class="eyebrow">WELCOME TO YOUR CIRCLE</div><h2>${recover?'Choose a new password':reset?'Reset your password':signup?'Create your account':'Welcome back'}</h2><p class="formtext">${recover?'Set a new password to restore your account.':reset?'We will email you a secure password reset link.':signup?'Start with your name and email. You can customize your username and photo next.':'Sign in to see your private circles and messages.'}</p><form id="auth-form" data-mode="${recover?'recovery':authMode}">
 ${signup?field('display_name','Name','Your name',true,'text','autocomplete="nickname" maxlength="60"'):''}
 ${!recover?field('email','Email','you@example.com',true,'email','autocomplete="email"'):''}
 ${!reset?(recover?field('password','New password','At least 8 characters',true,'password','minlength="8" autocomplete="new-password"'):field('password','Password','At least 8 characters',true,'password',`minlength="8" autocomplete="${signup?'new-password':'current-password'}"`)):''}
 <button class="btn full" type="submit" ${signingIn?'disabled':''}>${recover?'Change password':reset?'Send reset link':signup?'Create account':'Sign in'} →</button></form>
 ${!recover?`<div class="authswitch">${signup?'Already registered?':reset?'Remember your password?':'New to Layover?'} <button class="link" data-action="auth-mode" data-mode="${signup||reset?'login':'signup'}">${signup||reset?'Sign in':'Create account'}</button></div>${!signup&&!reset?'<button class="link" data-action="auth-mode" data-mode="forgot">Forgot password?</button>':''}`:''}
 <p class="info">Profiles are visible to other signed-in users by username. Chats are private to group members. Do not share your exact location, hostel room number or sensitive personal information.</p></div></section></div>`;
}
function field(name,label,placeholder='',required=true,type='text',attrs='',value=''){
 return `<div class="field"><label for="f-${clean(name)}">${clean(label)}</label><input id="f-${clean(name)}" name="${clean(name)}" type="${type}" ${required?'required':''} ${attrs} placeholder="${clean(placeholder)}" value="${clean(value)}"></div>`;
}
function chatsPage(){
 if(activeGroupId && currentGroup()) return groupPage();
 return `<div class="hero"><div><div class="eyebrow">THE PEOPLE MAKE THE JOURNEY</div><h1>Goodbyes don't<br>have to be forever.</h1><p>Your travel crews, together in their own private space.</p></div><div class="hero-graphic">✳</div></div>
 <div class="page-head"><div><div class="eyebrow">CIRCLES</div><h1>Your groups</h1><p>Find your people. Start a conversation.</p></div><button class="btn" data-action="modal" data-modal="create">+ Create circle</button></div>
 ${invites.length?`<div class="pending"><h3>✉️ ${invites.length} invitation${invites.length===1?'':'s'} waiting</h3><p class="small-note">Someone has invited you to a private circle.</p><button class="btn small" data-action="nav" data-route="invites">View invitations →</button></div>`:''}
 ${groups.length?`<div class="cards">${groups.map(g=>`<button class="circle-card" data-action="open-group" data-id="${g.id}"><span class="circle-icon">✳</span><div><h3>${clean(g.name)}</h3><p>${clean(g.description || 'Your private traveling crew.')}</p></div><div class="row between"><span class="badge ${clean(g.role)}">${clean(g.role)}</span><span class="eyecatching" style="font-size:12px;font-weight:800">Open chat →</span></div></button>`).join('')}</div>`:empty('🌿','Your first circle starts here','Create a group like “Sir Tobeys Locos”, then invite travelers by their username.','+ Create circle','modal','create')}`;
}
function empty(symbol,title,text,button,action,arg){return `<div class="empty"><span style="font-size:34px">${symbol}</span><h3>${clean(title)}</h3><p>${clean(text)}</p>${button?`<button class="btn" data-action="${action}" ${action==='modal'?`data-modal="${arg}"`:`data-route="${arg}"`}>${clean(button)}</button>`:''}</div>`;}
function groupPage(){
 const g=currentGroup();
 return `<button class="link back" data-action="group-back">← All circles</button><div class="page-head"><div><div class="eyebrow">PRIVATE CIRCLE <span class="badge ${clean(g.role)}">${clean(g.role)}</span></div><h1>${clean(g.name)}</h1><p>${clean(g.description || 'Your people, one conversation.')}</p></div><div class="actions">${canManage()?'<button class="btn secondary" data-action="modal" data-modal="invite">+ Invite</button>':''}<button class="btn light small" data-action="share-app">Share app</button><button class="btn light small" data-action="refresh-group">↻ Refresh</button></div></div>
 <div class="chat-layout"><div class="chat-column"><div class="chatbox"><div class="chat-head"><div class="row"><span class="circle-icon" style="height:38px;width:38px;font-size:20px">✳</span><div><div class="chat-title">Group chat</div><p class="sub">Only ${clean(g.name)} members can read this chat.</p></div></div><span class="badge">LIVE</span></div><div class="messages" id="messages" aria-label="Messages">${messagesHTML()}</div><form id="send-form" class="compose"><input name="body" maxlength="1000" required autocomplete="off" aria-label="Message" placeholder="Write a message to your people…"><button class="btn" type="submit">Send ↗</button></form></div></div><aside class="chat-side"><div class="panel"><div class="row between"><h3>People <span class="sub">(${members.length})</span></h3>${canManage()?'<button class="link" data-action="modal" data-modal="invite">Invite +</button>':''}</div><div class="member-list">${members.map(memberHTML).join('')||'<p class="hint">Loading members…</p>'}</div></div><div class="panel"><h3>Group settings</h3><p class="small-note">${canManage()?'Admins can invite people and manage roles. The owner cannot be removed or demoted.':'Only owners and admins can invite new members.'}</p><div class="stack" style="margin-top:15px">${canManage()?`<button class="btn secondary full" data-action="modal" data-modal="invite">Invite a traveler</button>`:''}${g.role==='owner'?`<button class="btn danger full" data-action="delete-group">Delete this circle</button>`:`<button class="btn light full" data-action="leave-group">Leave this circle</button>`}</div></div></aside></div>`;
}
function memberHTML(m){const p=m.profiles||memberCache.get(m.user_id)||{username:'traveler'};const editable=canManage()&&m.user_id!==user.id&&m.role!=='owner';return `<div class="row member">${avatar(p)}<div class="grow"><div class="name">${clean(display(p))}</div><div class="sub">@${clean(p.username||'traveler')}</div></div>${editable?`<select class="role-select" aria-label="Role for ${clean(display(p))}" data-change="role" data-id="${m.user_id}"><option value="member" ${m.role==='member'?'selected':''}>Member</option><option value="admin" ${m.role==='admin'?'selected':''}>Admin</option></select><button class="link warn" data-action="remove-member" data-id="${m.user_id}" title="Remove member">✕</button>`:`<span class="badge ${m.role}">${clean(m.role)}</span>`}</div>`;}
function messagesHTML(){
 if(!messages.length)return `<div class="empty" style="margin:auto;width:100%"><span style="font-size:28px">👋</span><h3>Say the first hello!</h3><p>Start the conversation with your crew.</p></div>`;
 return messages.map(msg=>{
 const mine=msg.user_id===user?.id;const p=memberCache.get(msg.user_id)||{display_name:mine?display(profile):'Traveler'};
 return `<div class="msg ${mine?'mine':''}">${avatar(mine?profile:p)}<div><div class="bubble"><div class="msgmeta">${clean(display(mine?profile:p))} · ${clean(when(msg.created_at))}</div><p>${clean(msg.body)}</p></div>${!mine?`<button class="report" data-action="modal" data-modal="report" data-id="${msg.id}">Report message</button>`:''}</div></div>`;
 }).join('');
}
function scrollMessages(){requestAnimationFrame(()=>{let box=$('#messages');if(box)box.scrollTop=box.scrollHeight;});}
function renderMessages(){const box=$('#messages');if(box){box.innerHTML=messagesHTML();scrollMessages();}}
function invitesPage(){return `<div class="page-head"><div><div class="eyebrow">YOUR INVITATIONS</div><h1>You're invited.</h1><p>Join only the circles you want to be part of.</p></div></div>${invites.length?`<div class="cards">${invites.map(i=>`<div class="panel stack"><div class="circle-icon">✉️</div><h3>${clean(i.groupName||'Private circle')}</h3><p class="hint">Someone invited you to join this group. Messages stay private until you accept.</p><div class="actions"><button class="btn" data-action="reply-invite" data-id="${i.id}" data-status="accepted">Join circle</button><button class="btn light" data-action="reply-invite" data-id="${i.id}" data-status="declined">Decline</button></div></div>`).join('')}</div>`:empty('✉️','No pending invitations','Ask someone you met for their Layover username and have them invite you to a circle.','','','')}`;}
function profilePage(){return `<div class="page-head"><div><div class="eyebrow">YOUR IDENTITY</div><h1>Your traveler profile</h1><p>Other signed-in travelers can find you by your @username.</p></div></div><div class="profile-hero">${avatar(profile,'big')}<div><div class="eyebrow" style="color:#cde19d">LAYOVER MEMBER</div><h2>${clean(display(profile))}</h2><div class="sub">@${clean(profile?.username||'')}</div><p style="font-size:12px;margin-top:8px">${clean(profile?.bio||'Add a little about yourself.')}</p></div></div><div class="profile-grid"><div class="panel"><h3>Edit profile</h3><p class="formtext">Share only what you're comfortable showing other members.</p><form id="profile-form">${field('display_name','Display name','Your name',true,'text','maxlength="60"',profile?.display_name)}${field('username','Username (3–24 lowercase letters, numbers, _)','your_handle',true,'text','minlength="3" maxlength="24" pattern="[a-z0-9_]{3,24}"',profile?.username)}${field('home_country','Home country (optional)','Czechia',false,'text','maxlength="60"',profile?.home_country)}<div class="field"><label for="f-bio">Your short bio (optional)</label><textarea id="f-bio" name="bio" maxlength="300" placeholder="Traveler, city explorer…">${clean(profile?.bio)}</textarea></div><button class="btn" type="submit">Save profile</button></form></div><div class="stack"><div class="panel"><h3>Profile photo</h3><p class="formtext">Choose a JPG, PNG or WebP. We resize it before uploading to private storage.</p><div class="row" style="margin-bottom:15px">${avatar(profile,'med')}<div class="hint">Max 8 MB input. Uploaded avatars can be viewed by other signed-in members.</div></div><form id="avatar-form"><div class="field"><label for="avatarfile">Choose photo</label><input id="avatarfile" type="file" name="avatar" accept="image/jpeg,image/png,image/webp" required></div><button class="btn secondary" type="submit">Upload photo ↗</button></form></div><div class="panel"><h3>Account</h3><p class="sub">${clean(user?.email||'')}</p><button class="btn light" style="margin-top:13px" data-action="sign-out">Sign out</button></div><div class="panel"><h3>Privacy first</h3><p class="small-note">Only authenticated users can browse profiles. We show no exact location, phone number or room information. Group content is only readable by members.</p></div></div></div>`;}
function modalView(){
 let title='',body='';
 if(modal==='create'){
 title='Start a new circle';body=`<p class="formtext">Create a private group for people you've actually met.</p><form id="create-form">${field('name','Circle name',"Sir Tobeys Locos",true,'text','minlength="3" maxlength="70"')}<div class="field"><label for="desc">Short description (optional)</label><textarea id="desc" maxlength="250" name="description" placeholder="Our Prague hostel crew…"></textarea></div><button class="btn full">Create circle →</button></form>`;
 }else if(modal==='invite'){
 title='Invite a traveler';body=`<p class="formtext">Enter their exact @username. They will receive a private invitation and choose whether to join.</p><form id="search-form">${field('username','Travelers username','@username',true,'text','maxlength="25"')}<button class="btn full">Find traveler →</button></form><div id="search-result" style="margin-top:14px"></div>`;
 }else if(modal.startsWith('report:')){
 title='Report a message';body=`<p class="formtext">Reports are stored privately for the group operator to review in the Supabase dashboard.</p><form id="report-form" data-id="${clean(modal.split(':')[1])}"><div class="field"><label for="report-reason">Why are you reporting this?</label><select id="report-reason" name="reason" required><option value="harassment">Harassment</option><option value="spam">Spam</option><option value="privacy">Personal information shared without consent</option><option value="other">Other concern</option></select></div><button class="btn danger full">Submit report</button></form>`;
 }
 return `<div class="modal-overlay" id="overlay"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-head"><h2 id="modal-title">${title}</h2><button data-action="close-modal" aria-label="Close dialog">✕</button></div>${body}</section></div>`;
}

async function loadLists(){
 if(!user)return;
 const [{data:myProfile,error:pErr},{data:rows,error:gErr},{data:inv,error:iErr}]=await Promise.all([
   supabase.from('profiles').select('*').eq('id',user.id).single(),
   supabase.from('group_members').select('group_id,role,groups(id,name,description,created_at)').eq('user_id',user.id).order('joined_at',{ascending:false}),
   supabase.from('group_invites').select('id,group_id,created_at').eq('invited_user_id',user.id).eq('status','pending').order('created_at',{ascending:false})
 ]);
 if(pErr)throw pErr;if(gErr)throw gErr;if(iErr)throw iErr;
 profile=myProfile;await signAvatar(profile?.avatar_path);
 groups=(rows||[]).filter(r=>r.groups).map(r=>({...r.groups,role:r.role}));
 invites=inv||[];
 if(invites.length){
   const {data:names,error:nErr}=await supabase.from('groups').select('id,name').in('id',invites.map(x=>x.group_id));
   if(nErr)console.warn(nErr);
   const lookup=new Map((names||[]).map(g=>[g.id,g.name]));
   invites=invites.map(i=>({...i,groupName:lookup.get(i.group_id) || 'Private circle'}));
 }
 if(activeGroupId&&!groups.some(g=>g.id===activeGroupId)){activeGroupId=null;unsubscribeGroup();}
}
async function loadGroup(gid){
 if(!groups.some(g=>g.id===gid))return;
 const [{data:m,error:me},{data:msgs,error:ms},{data:gi,error:ie}]=await Promise.all([
   supabase.from('group_members').select('group_id,user_id,role,profiles(id,username,display_name,avatar_path)').eq('group_id',gid).order('joined_at',{ascending:true}),
   supabase.from('messages').select('id,group_id,user_id,body,created_at').eq('group_id',gid).order('created_at',{ascending:false}).limit(100),
   supabase.from('group_invites').select('id,invited_user_id,status').eq('group_id',gid).eq('status','pending')
 ]);
 if(me)throw me;if(ms)throw ms;if(ie)throw ie;
 if(activeGroupId!==gid)return;
 members=m||[];memberCache=new Map(members.map(x=>[x.user_id,x.profiles]));
 messages=(msgs||[]).slice().reverse();groupPendingInvites=gi||[];
 await signMany(members.map(x=>x.profiles));
 if(activeGroupId===gid){render();subscribeGroup(gid);}
}
function unsubscribeGroup(){if(liveChannel&&supabase){supabase.removeChannel(liveChannel);liveChannel=null;}}
function subscribeGroup(gid){
 unsubscribeGroup();
 liveChannel=supabase.channel(`private-circle-${gid}`)
 .on('postgres_changes',{event:'INSERT',schema:'public',table:'messages',filter:`group_id=eq.${gid}`},async payload=>{
   const msg=payload.new;
   if(!msg||activeGroupId!==gid||messages.some(m=>m.id===msg.id))return;
   messages.push(msg);messages.sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
   if(messages.length>100)messages.shift();
   renderMessages();
 }).subscribe(status=>{if(status==='CHANNEL_ERROR')showToast('Live updates disconnected. Tap Refresh to sync.',true);});
}
async function syncSession(session){
 const epoch=++currentEpoch;
 if(!session?.user){user=null;profile=null;groups=[];invites=[];members=[];messages=[];activeGroupId=null;unsubscribeGroup();loading=false;render();return;}
 if(user?.id===session.user.id&&profile&&!loading)return;
 user=session.user;loading=true;render();
 try{await loadLists();if(epoch!==currentEpoch)return;loading=false;render();}
 catch(e){loading=false;render();fail(e,'Could not load your account');}
}

async function start(){
 if(!validConfig){loading=false;render();return;}
 try{
  const createClient=window.supabase?.createClient;
  if(!createClient)throw new Error('Supabase client library could not load. Check your connection.');
  supabase=createClient(cfg.supabaseUrl.trim(),cfg.publishableKey.trim(),{auth:{autoRefreshToken:true,persistSession:true,detectSessionInUrl:true}});
  supabase.auth.onAuthStateChange((event,session)=>{
   if(event==='PASSWORD_RECOVERY')recoveryMode=true;
   if(event==='SIGNED_OUT')recoveryMode=false;
   setTimeout(()=>syncSession(session),0);
  });
  const {data,error}=await supabase.auth.getSession();
  if(error)throw error;
  await syncSession(data.session);
 }catch(e){loading=false;root.innerHTML=`<div class="startup"><span class="mark">✳</span><h2>Connection error</h2><p>${clean(e?.message || 'Unable to load Supabase client.')}</p><button class="btn" onclick="location.reload()">Try again</button></div>`;console.error(e);}
}
async function refresh(){await loadLists();if(activeGroupId&&groups.some(g=>g.id===activeGroupId))await loadGroup(activeGroupId);else render();}

async function submitAuth(form){
 const values=Object.fromEntries(new FormData(form).entries()),mode=form.dataset.mode;
 signingIn=true;render();
 try{
  if(mode==='recovery'){
   const {error}=await supabase.auth.updateUser({password:values.password});if(error)throw error;
   recoveryMode=false;authMode='login';showToast('Password changed.');const {data}=await supabase.auth.getSession();await syncSession(data.session);
  }else if(mode==='signup'){
   const {data,error}=await supabase.auth.signUp({email:values.email.trim(),password:values.password,options:{data:{display_name:values.display_name.trim()},emailRedirectTo:location.origin+location.pathname}});
   if(error)throw error;
   if(!data.session)showToast('Check your email to confirm your account.');
   else showToast('Account created! Welcome to LAYOVER.');
   authMode='login';
  }else if(mode==='forgot'){
   const {error}=await supabase.auth.resetPasswordForEmail(values.email.trim(),{redirectTo:location.origin+location.pathname});if(error)throw error;
   showToast('If that email has an account, a reset link will arrive.');authMode='login';
  }else{
   const {error}=await supabase.auth.signInWithPassword({email:values.email.trim(),password:values.password});if(error)throw error;
  }
 }catch(e){fail(e);}finally{signingIn=false;render();}
}
async function compressAvatar(file){
 if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('Upload a JPG, PNG, or WebP image.');
 if(file.size>8*1024*1024)throw Error('Image must be smaller than 8 MB.');
 const url=URL.createObjectURL(file);
 try{
  const image=new Image();const loaded=new Promise((res,rej)=>{image.onload=res;image.onerror=()=>rej(new Error('Cannot read this image.'));});image.src=url;await loaded;
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=512;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,512,512);
  const size=Math.min(image.width,image.height);ctx.drawImage(image,(image.width-size)/2,(image.height-size)/2,size,size,0,0,512,512);
  return await new Promise((res,rej)=>canvas.toBlob(blob=>blob?res(blob):rej(new Error('Image conversion failed.')),'image/jpeg',.78));
 }finally{URL.revokeObjectURL(url);}
}
async function inviteUsername(raw){
 const name=String(raw).toLowerCase().trim().replace(/^@/,'');
 if(!/^[a-z0-9_]{3,24}$/.test(name))throw Error('Enter a valid username: lowercase letters, digits, underscores.');
 const {data,error}=await supabase.from('profiles').select('id,username,display_name,avatar_path').eq('username',name).maybeSingle();
 if(error)throw error;
 const el=$('#search-result');if(!el)return;
 if(!data){el.innerHTML=`<p class="info">No traveler found with @${clean(name)}. Ask them to sign up and share their username.</p>`;return;}
 if(data.id===user.id){el.innerHTML='<p class="info">You are already in this group.</p>';return;}
 if(members.some(m=>m.user_id===data.id)){el.innerHTML='<p class="info">This traveler is already in the group.</p>';return;}
 if(groupPendingInvites.some(i=>i.invited_user_id===data.id)){el.innerHTML='<p class="info">An invitation is already pending for this traveler.</p>';return;}
 await signAvatar(data.avatar_path);
 el.innerHTML=`<div class="panel row wrap">${avatar(data,'med')}<div class="grow"><div class="name">${clean(display(data))}</div><div class="sub">@${clean(data.username)}</div></div><button class="btn small" data-action="send-invite" data-id="${data.id}">Send invitation</button></div>`;
}

root.addEventListener('click',async event=>{
 if(event.target.id==='overlay'){modal='';render();return;}
 const el=event.target.closest('[data-action]');if(!el||el.disabled)return;
 const {action}=el.dataset;
 try{
  if(action==='auth-mode'){authMode=el.dataset.mode;render();return;}
  if(action==='nav'){route=el.dataset.route;activeGroupId=null;unsubscribeGroup();render();return;}
  if(action==='group-back'){activeGroupId=null;unsubscribeGroup();render();return;}
  if(action==='modal'){modal=el.dataset.modal==='report'?`report:${el.dataset.id}`:el.dataset.modal;render();return;}
  if(action==='close-modal'){modal='';render();return;}
  if(action==='open-group'){activeGroupId=el.dataset.id;members=[];messages=[];render();await loadGroup(activeGroupId);return;}
  if(action==='refresh-group'){await refresh();showToast('Conversation refreshed.');return;}
  if(action==='sign-out'){const {error}=await supabase.auth.signOut();if(error)throw error;showToast('Signed out.');return;}
  if(action==='share-app'){
   const link=location.origin+location.pathname;
   if(navigator.share){try{await navigator.share({title:'Join me on LAYOVER',text:'Make a profile and send me your @username so I can invite you to our circle!',url:link});}catch(e){if(e.name!=='AbortError')throw e;}}
   else if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(link);showToast('App link copied. Ask them for their username after signup.');}
   else prompt('Share this website with your friends:',link);
   return;
  }
  if(action==='send-invite'){
   el.disabled=true;
   const {error}=await supabase.from('group_invites').insert({group_id:activeGroupId,invited_user_id:el.dataset.id,invited_by:user.id});
   if(error)throw error;
   groupPendingInvites.push({invited_user_id:el.dataset.id});modal='';render();showToast('Invitation sent. They can accept from their Invitations tab.');return;
  }
  if(action==='reply-invite'){
   el.disabled=true;
   const {error}=await supabase.from('group_invites').update({status:el.dataset.status}).eq('id',el.dataset.id);
   if(error)throw error;
   await refresh();showToast(el.dataset.status==='accepted'?'You joined the circle!':'Invitation declined.');return;
  }
  if(action==='remove-member'){
   const m=members.find(m=>m.user_id===el.dataset.id);if(!m||!confirm(`Remove ${display(m.profiles)} from this group?`))return;
   const {error}=await supabase.from('group_members').delete().eq('group_id',activeGroupId).eq('user_id',m.user_id);if(error)throw error;
   await loadGroup(activeGroupId);showToast('Member removed.');return;
  }
  if(action==='leave-group'){
   if(!confirm('Leave this circle? You will lose access to its messages.'))return;
   const {error}=await supabase.from('group_members').delete().eq('group_id',activeGroupId).eq('user_id',user.id);if(error)throw error;
   activeGroupId=null;unsubscribeGroup();await refresh();showToast('You left the circle.');return;
  }
  if(action==='delete-group'){
   const g=currentGroup();if(!g||!confirm(`Permanently delete ${g.name} and all its messages for everyone?`))return;
   const {error}=await supabase.from('groups').delete().eq('id',g.id);if(error)throw error;
   activeGroupId=null;unsubscribeGroup();await refresh();showToast('Circle deleted.');return;
  }
 }catch(e){el.disabled=false;fail(e);}
});
root.addEventListener('change',async event=>{
 const el=event.target;
 if(el.dataset.change!=='role')return;
 const target=members.find(m=>m.user_id===el.dataset.id),previous=target?.role;
 if(!target||!confirm(`Change ${display(target.profiles)} to ${el.value}?`)){el.value=previous||'member';return;}
 try{const {error}=await supabase.from('group_members').update({role:el.value}).eq('group_id',activeGroupId).eq('user_id',el.dataset.id);if(error)throw error;await loadGroup(activeGroupId);showToast('Role updated.');}
 catch(e){el.value=previous;fail(e);}
});
root.addEventListener('submit',async event=>{
 const form=event.target;if(!(form instanceof HTMLFormElement))return;event.preventDefault();
 if(form.querySelector('button[type=submit]')?.disabled)return;
 const data=Object.fromEntries(new FormData(form).entries());
 try{
  if(form.id==='auth-form'){await submitAuth(form);return;}
  if(form.id==='profile-form'){
   const username=data.username.trim().toLowerCase();if(!/^[a-z0-9_]{3,24}$/.test(username))throw Error('Username must be 3–24 lowercase letters, digits or underscores.');
   const {error}=await supabase.from('profiles').update({display_name:data.display_name.trim(),username,home_country:data.home_country.trim(),bio:data.bio.trim()}).eq('id',user.id);if(error)throw error;
   await loadLists();render();showToast('Profile saved.');return;
  }
  if(form.id==='avatar-form'){
   const file=form.querySelector('input[type=file]')?.files?.[0];if(!file)throw Error('Select an image.');
   const blob=await compressAvatar(file),old=profile?.avatar_path;
   const path=`${user.id}/${urlId()}.jpg`;
   const {error:upErr}=await supabase.storage.from('avatars').upload(path,blob,{contentType:'image/jpeg',upsert:false});if(upErr)throw upErr;
   const {error:pErr}=await supabase.from('profiles').update({avatar_path:path}).eq('id',user.id);
   if(pErr){await supabase.storage.from('avatars').remove([path]);throw pErr;}
   avatarCache.delete(old);if(old)await supabase.storage.from('avatars').remove([old]);
   await loadLists();render();showToast('Photo uploaded.');return;
  }
  if(form.id==='create-form'){
   const {data:g,error}=await supabase.from('groups').insert({name:data.name.trim(),description:data.description.trim(),created_by:user.id}).select('id').single();if(error)throw error;
   modal='';await loadLists();activeGroupId=g.id;render();await loadGroup(g.id);showToast('Circle created. Invite your travelers!');return;
  }
  if(form.id==='search-form'){await inviteUsername(data.username);return;}
  if(form.id==='report-form'){
   const {error}=await supabase.from('message_reports').insert({message_id:form.dataset.id,group_id:activeGroupId,reported_by:user.id,reason:data.reason});if(error)throw error;
   modal='';render();showToast('Report submitted. Thank you.');return;
  }
  if(form.id==='send-form'){
   const body=String(data.body||'').trim();if(!body)return;
   const input=form.querySelector('input[name=body]');
   const {data:newMessage,error}=await supabase.from('messages').insert({group_id:activeGroupId,user_id:user.id,body:body.slice(0,1000)}).select('id,group_id,user_id,body,created_at').single();
   if(error)throw error;
   if(input)input.value='';
   if(!messages.some(m=>m.id===newMessage.id))messages.push(newMessage);
   if(messages.length>100)messages.shift();renderMessages();return;
  }
 }catch(e){fail(e);}
});
start();
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(console.warn));
}
