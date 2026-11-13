/* LAYOVER v0.3: real auth, roles, group chat, shared calendar and private corkboard.
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
let groupTab = 'chat';
let travelPlans = [];
let circlePhotos = [];
let calendarCursor = new Date(new Date().getFullYear(),new Date().getMonth(),1);
let selectedDay = '';
const wallCache = new Map();
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
  return `<div class="layout ${activeGroupId&&route==='chats'?'in-circle':''}"><aside class="side"><div class="brand"><span class="mark">✳</span> LAYOVER<b>.</b></div><p class="tag">The people make the journey.</p><nav>${tabs.map(navButton).join('')}</nav><div class="side-end"><b>✳ Your circles are yours.</b><br>Only invited members can read the conversation. Share personal details thoughtfully.</div></aside><div class="maincol"><header class="top"><div class="topbrand"><span>✳</span> LAYOVER.</div><span class="topsmall">YOUR PEOPLE, EVERYWHERE</span><button class="toplink" data-action="nav" data-route="profile">${avatar(profile)} ${clean(display(profile))}</button></header><main class="main">${route==='profile'?profilePage():route==='invites'?invitesPage():chatsPage()}</main><nav class="footer-nav" aria-label="App navigation">${tabs.map(([k,t])=>`<button data-action="nav" data-route="${k}" class="${route===k?'active':''}"><span style="font-size:19px">${icon[k]}</span>${k==='chats'?'Chats':k==='invites'?`Invites ${invites.length?`(${invites.length})`:''}`:'Profile'}</button>`).join('')}</nav></div></div>${modal ? modalView() : ''}`;
}
function render(){
  if(!validConfig){root.innerHTML=setupView();return;}
  if(loading){root.innerHTML='<div class="startup"><span class="mark">✳</span><h1>LAYOVER.</h1><p>Connecting your circles…</p></div>';return;}
  if(!user || recoveryMode){root.innerHTML=authView();return;}
  root.innerHTML=shell();
  if(route==='chats'&&activeGroupId&&groupTab==='chat')scrollMessages();
}
function setupView(){return `<div class="authwrap"><div class="authart"><div class="brand"><span class="mark">✳</span> LAYOVER.</div><h1>Build a circle.<br><em>Keep your people.</em></h1><p>Private group chats and real traveler profiles — built for connections that survive checkout.</p><div class="foot">v0.3 · PRIVATE CIRCLES + MEMORIES</div></div><div class="authformwrap"><div class="authform"><div class="eyebrow">ONE-TIME SETUP</div><h2>Connect Supabase</h2><p class="formtext">The app is ready, but has no database credentials yet. Create a Supabase project, run the included <code>supabase/schema.sql</code> once, then edit <code>config.js</code>.</p><div class="panel stack"><p><b>1.</b> Create a project at <a href="https://supabase.com/dashboard" target="_blank" rel="noopener noreferrer">Supabase Dashboard</a>.</p><p><b>2.</b> Paste <code>supabase/schema.sql</code> into SQL Editor and run it.</p><p><b>3.</b> Copy your Project URL and <b>publishable</b> key to <code>config.js</code>.</p><p><b>4.</b> Add this site's address to Auth → URL Configuration.</p></div><p class="info">Use only the public/publishable key. Never paste a service_role or secret key into a website.</p><p class="hint" style="margin-top:18px">Full instructions in README.md.</p></div></div></div>`;}
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
 const tabs=[['chat','💬','Chat'],['calendar','🗓️','Calendar'],['wall','📌','Corkboard']];
 const navigation=`<nav class="group-tabs" aria-label="Circle sections">${tabs.map(([key,em,label])=>`<button type="button" class="group-tab ${groupTab===key?'selected':''}" aria-current="${groupTab===key?'page':'false'}" data-action="group-tab" data-tab="${key}"><span>${em}</span>${label}</button>`).join('')}</nav>`;
 const content=groupTab==='calendar'?calendarPage():groupTab==='wall'?wallPage():chatPanel(g);
 return `<button class="link back" data-action="group-back">← All circles</button><div class="page-head circle-heading"><div><div class="eyebrow">PRIVATE CIRCLE <span class="badge ${clean(g.role)}">${clean(g.role)}</span></div><h1>${clean(g.name)}</h1><p>${clean(g.description || 'Your people, one conversation.')}</p></div><div class="actions">${canManage()?'<button class="btn secondary" data-action="modal" data-modal="invite">+ Invite</button>':''}<button class="btn light small" data-action="share-app">Share app</button><button class="btn light small" data-action="refresh-group">↻ Refresh</button></div></div>
 ${navigation}<div class="chat-layout"><div class="chat-column">${content}</div><aside class="chat-side"><div class="panel"><div class="row between"><h3>People <span class="sub">(${members.length})</span></h3>${canManage()?'<button class="link" data-action="modal" data-modal="invite">Invite +</button>':''}</div><div class="member-list">${members.map(memberHTML).join('')||'<p class="hint">Loading members…</p>'}</div></div><div class="panel"><h3>Circle management</h3><p class="small-note">${g.role==='owner'?'You are the founder. You can appoint admins; they can invite friends and remove ordinary members.':g.role==='admin'?'You are an admin. You can invite people and remove ordinary members. Only the founder assigns admins.':'Ask an admin to invite your friends.'}</p>${canManage()&&groupPendingInvites.length?`<div class="pending-mini"><strong>Pending invites (${groupPendingInvites.length})</strong>${groupPendingInvites.map(i=>`<div class="row between"><span class="sub">@${clean(i.username||'traveler')}</span><button class="link warn" data-action="revoke-invite" data-id="${i.id}">Revoke</button></div>`).join('')}</div>`:''}<div class="stack" style="margin-top:15px">${canManage()?`<button class="btn secondary full" data-action="modal" data-modal="invite">Invite a traveler</button>`:''}${g.role==='owner'?`<button class="btn danger full" data-action="delete-group">Delete this circle</button>`:`<button class="btn light full" data-action="leave-group">Leave this circle</button>`}</div></div></aside></div>`;
}
function chatPanel(g){return `<div class="chatbox"><div class="chat-head"><div class="row"><span class="circle-icon" style="height:38px;width:38px;font-size:20px">✳</span><div><div class="chat-title">Group chat</div><p class="sub">Only ${clean(g.name)} members can read this chat.</p></div></div><span class="badge">LIVE</span></div><div class="messages" id="messages" aria-label="Messages">${messagesHTML()}</div><form id="send-form" class="compose"><input name="body" maxlength="1000" required autocomplete="off" aria-label="Message" placeholder="Write to your people…"><button class="btn" type="submit">Send ↗</button></form></div>`;}
function memberHTML(m){
 const p=m.profiles||memberCache.get(m.user_id)||{username:'traveler'};
 const editRole=currentGroup()?.role==='owner' && m.user_id!==user.id && m.role!=='owner';
 const remove=canManage() && m.user_id!==user.id && m.role!=='owner' && (currentGroup()?.role==='owner'||m.role==='member');
 return `<div class="row member">${avatar(p)}<div class="grow"><div class="name">${clean(display(p))}</div><div class="sub">@${clean(p.username||'traveler')}</div></div>${editRole?`<select class="role-select" aria-label="Role for ${clean(display(p))}" data-change="role" data-id="${m.user_id}"><option value="member" ${m.role==='member'?'selected':''}>Member</option><option value="admin" ${m.role==='admin'?'selected':''}>Admin</option></select>`:`<span class="badge ${m.role}">${clean(m.role)}</span>`}${remove?`<button class="link warn" data-action="remove-member" data-id="${m.user_id}" title="Remove member">✕</button>`:''}</div>`;
}
function isoDay(date){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
const monthLabels=['January','February','March','April','May','June','July','August','September','October','November','December'];
function inMonth(p,y,m){
 if(p.kind==='wishlist')return p.travel_year===y && p.travel_month===m+1;
 const start=`${y}-${String(m+1).padStart(2,'0')}-01`;
 const end=isoDay(new Date(y,m+1,0));
 return p.start_date<=end && p.end_date>=start;
}
function coversDay(p,day){return p.kind==='trip'&&p.start_date<=day&&p.end_date>=day;}
function planCard(p){
 const mine=p.user_id===user?.id;const person=p.profiles||memberCache.get(p.user_id)||{};
 const canDelete=mine||canManage();
 const dt=p.kind==='wishlist'?`${monthLabels[p.travel_month-1]} ${p.travel_year} · wish list`:`${new Date(p.start_date+'T12:00').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}${p.end_date!==p.start_date?' – '+new Date(p.end_date+'T12:00').toLocaleDateString('en-GB',{day:'numeric',month:'short'}):''}`;
 return `<article class="travel-card"><div class="travel-icon">${p.kind==='wishlist'?'✧':'✈'}</div><div class="grow"><div class="travel-top"><span class="badge ${p.kind==='wishlist'?'wish':''}">${p.kind==='wishlist'?'Dreaming':'Trip'}</span><span class="sub">${clean(dt)}</span></div><h3>${clean(p.city)}, ${clean(p.country)}</h3><p class="travel-author">${clean(display(person))}${p.note?' · '+clean(p.note):''}</p></div><div class="travel-actions">${mine?`<button class="link" data-action="edit-plan" data-id="${p.id}" aria-label="Edit travel plan">Edit</button>`:''}${canDelete?`<button class="link warn" data-action="delete-plan" data-id="${p.id}" aria-label="Delete travel plan">✕</button>`:''}</div></article>`;
}
function calendarPage(){
 const y=calendarCursor.getFullYear(),m=calendarCursor.getMonth();
 const first=(new Date(y,m,1).getDay()+6)%7;
 const days=new Date(y,m+1,0).getDate();
 const monthPlans=travelPlans.filter(p=>inMonth(p,y,m));
 const today=isoDay(new Date());
 let dayCells='';
 for(let i=0;i<first;i++) dayCells+='<span class="cal-blank"></span>';
 for(let d=1;d<=days;d++){
   const day=isoDay(new Date(y,m,d));const daily=travelPlans.filter(p=>coversDay(p,day));
   dayCells+=`<button type="button" class="cal-day ${day===today?'today':''} ${selectedDay===day?'picked':''}" data-action="select-day" data-day="${day}" aria-label="${d} ${monthLabels[m]}: ${daily.length} trips"><span class="cal-number">${d}</span>${daily.length?`<span class="cal-dots">${daily.slice(0,3).map(()=>'<i></i>').join('')}${daily.length>3?'<em>+</em>':''}</span>`:''}</button>`;
 }
 const chosen=selectedDay&&selectedDay.startsWith(`${y}-${String(m+1).padStart(2,'0')}`)?travelPlans.filter(p=>coversDay(p,selectedDay)):[];
 return `<section class="calendar-card"><div class="section-title"><div><div class="eyebrow">OUR SHARED PLANS</div><h2>Where to next?</h2><p class="small-note">Every member of this circle can add a trip or a dream destination.</p></div><button class="btn" data-action="modal" data-modal="plan">+ Add plan</button></div><div class="calendar-toolbar"><button class="cal-arrow" data-action="month-prev" aria-label="Previous month">←</button><div class="cal-month">${monthLabels[m]} ${y}</div><button class="cal-arrow" data-action="month-next" aria-label="Next month">→</button></div><div class="cal-grid"><div class="cal-week">Mon</div><div class="cal-week">Tue</div><div class="cal-week">Wed</div><div class="cal-week">Thu</div><div class="cal-week">Fri</div><div class="cal-week">Sat</div><div class="cal-week">Sun</div>${dayCells}</div><div class="cal-guide">🟢 Trip dates <span>✧ Wish list destinations are shown below for their chosen month</span></div></section>
 ${selectedDay&&chosen.length?`<section class="calendar-feed"><div class="eyebrow">ON ${clean(selectedDay)}</div>${chosen.map(planCard).join('')}</section>`:''}
 <section class="calendar-feed"><div class="section-title compact"><div><div class="eyebrow">THIS MONTH</div><h2>Our trips & wish list</h2></div><span class="badge">${monthPlans.length} plans</span></div>${monthPlans.length?monthPlans.sort((a,b)=>a.kind.localeCompare(b.kind)||String(a.start_date||'').localeCompare(String(b.start_date||''))).map(planCard).join(''):`<div class="empty tiny"><span>🧭</span><h3>No plans for this month yet</h3><p>Add where you’re heading, or where you dream of going.</p></div>`}</section>`;
}
function wallImage(photo){const cached=wallCache.get(photo.image_path);return cached&&cached.expires>Date.now()?`<img alt="${clean(photo.caption||'Group memory')}" src="${clean(cached.url)}" loading="lazy">`:'<span class="photo-loading">Loading memory…</span>';}
function wallPage(){
 const full=circlePhotos.length>=100;
 return `<section class="wall-shell"><div class="section-title"><div><div class="eyebrow">THE MEMORIES WE MADE</div><h2>Our corkboard <span class="pin-icon">📌</span></h2><p class="small-note">A little wall of moments shared by your circle. Photos only, no videos.</p></div><button class="btn" data-action="modal" data-modal="photo" ${full?'disabled':''}>+ Pin a photo</button></div><div class="wall-progress"><span>${circlePhotos.length} / 100 photos pinned</span><div class="wall-track"><span style="width:${Math.min(circlePhotos.length,100)}%"></span></div></div><div class="corkboard">${circlePhotos.length?`<div class="polaroid-grid">${circlePhotos.map((p,i)=>{const person=p.profiles||memberCache.get(p.user_id)||{};const removable=p.user_id===user.id||canManage();return `<div class="polaroid" style="--twist:${((i*7)%9)-4}deg"><span class="thumbtack" aria-hidden="true"></span><div class="polaroid-picture">${wallImage(p)}</div><div class="polaroid-caption">${clean(p.caption||'A moment to remember ✳')}</div><div class="polaroid-meta">${clean(display(person))}</div>${removable?`<button class="photo-remove" title="Unpin photo" aria-label="Remove this photo" data-action="delete-photo" data-id="${p.id}">✕</button>`:''}</div>`;}).join('')}</div>`:`<div class="cork-empty"><span>📷</span><h3>Every circle starts with a memory.</h3><p>Pin your first photo from the road.</p><button class="btn light" data-action="modal" data-modal="photo">+ Pin a photo</button></div>`}</div><p class="small-note wall-privacy">Only members of ${clean(currentGroup()?.name)} can see this board. Please ask before posting photos of other people.</p></section>`;
}
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
 }else if(modal==='plan'||modal.startsWith('edit-plan:')){
 const editing=modal.startsWith('edit-plan:');
 const item=editing?travelPlans.find(p=>p.id===modal.split(':')[1]):null;
 if(editing&&!item)return '';
 const wish=item?.kind==='wishlist';
 const year=new Date().getFullYear();const month=new Date().getMonth()+1;
 title=editing?'Edit travel plan':'Add a travel plan';
 const monthOptions=monthLabels.map((n,i)=>`<option value="${i+1}" ${(item?.travel_month||month)===(i+1)?'selected':''}>${n}</option>`).join('');
 body=`<p class="formtext">Share a city and approximate dates with this circle — never your live location.</p><form id="travel-form" data-id="${item?.id||''}"><div class="field"><label for="plan-kind">Plan type</label><select id="plan-kind" name="kind" data-change="plan-kind"><option value="trip" ${!wish?'selected':''}>✈ Trip · I have dates</option><option value="wishlist" ${wish?'selected':''}>✧ Wish list · maybe someday</option></select></div>${field('city','City','Barcelona',true,'text','maxlength="70" list="city-ideas"',item?.city||'')}${field('country','Country','Spain',true,'text','maxlength="70" list="country-ideas"',item?.country||'')}<datalist id="city-ideas"><option value="Prague"><option value="Berlin"><option value="Barcelona"><option value="Lisbon"><option value="Budapest"><option value="Rome"><option value="Vienna"><option value="Paris"><option value="Amsterdam"><option value="London"><option value="Tokyo"></datalist><datalist id="country-ideas"><option value="Czechia"><option value="Germany"><option value="Spain"><option value="Portugal"><option value="Italy"><option value="Austria"><option value="Hungary"><option value="France"><option value="Netherlands"><option value="United Kingdom"><option value="Japan"></datalist><div id="trip-fields" ${wish?'hidden':''}><div class="form-two">${field('start_date','From','',!wish,'date','',item?.start_date||isoDay(new Date()))}${field('end_date','Until','',!wish,'date','',item?.end_date||isoDay(new Date()))}</div></div><div id="wishlist-fields" ${wish?'':'hidden'}><div class="form-two"><div class="field"><label for="plan-month">Dream month</label><select id="plan-month" name="travel_month">${monthOptions}</select></div>${field('travel_year','Dream year','',wish,'number',`min="2024" max="2100"`,item?.travel_year||year+1)}</div><p class="small-note" style="margin-bottom:13px">It's okay if your plans aren't confirmed. Month + year is enough.</p></div><div class="field"><label for="plan-note">Little note (optional)</label><textarea name="note" id="plan-note" maxlength="180" placeholder="I'd love to explore the old town, meet friends…">${clean(item?.note||'')}</textarea></div><button class="btn full" type="submit">${editing?'Save changes':'Add to our calendar'} →</button></form>`;
 }else if(modal==='photo'){
 title='Pin a memory';body=`<p class="formtext">Choose a photo, add your own short caption, then pin it to your circle's corkboard.</p><form id="photo-form"><div class="field"><label for="wall-file">Photo (JPG, PNG or WebP)</label><input id="wall-file" name="photo" type="file" accept="image/jpeg,image/png,image/webp" required></div><div class="photo-preview" id="photo-preview"><span>📸</span><p>Your photo preview will appear here</p></div>${field('caption','Polaroid caption','Prague Castle ’26',false,'text','maxlength="80"')}<p class="small-note" style="margin-bottom:14px">We shrink large photos before upload. Ask everyone pictured for permission.</p><button class="btn full" type="submit">📌 Pin this photo</button></form>`;
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
 if(groupPendingInvites.length && canManage()){
   const {data:inviteProfiles}=await supabase.from('profiles').select('id,username').in('id',groupPendingInvites.map(i=>i.invited_user_id));
   const names=new Map((inviteProfiles||[]).map(p=>[p.id,p.username]));
   groupPendingInvites=groupPendingInvites.map(i=>({...i,username:names.get(i.invited_user_id)}));
 }
 await loadCircleExtras(gid,false);
 if(activeGroupId===gid){render();subscribeGroup(gid);}
}
async function loadCircleExtras(gid,rerender=true){
 const [{data:tp,error:te},{data:cp,error:ce}]=await Promise.all([
   supabase.from('travel_plans').select('id,group_id,user_id,kind,city,country,start_date,end_date,travel_year,travel_month,note,created_at,profiles(id,username,display_name,avatar_path)').eq('group_id',gid).order('created_at',{ascending:false}).limit(400),
   supabase.from('circle_photos').select('id,group_id,user_id,image_path,caption,created_at,profiles(id,username,display_name,avatar_path)').eq('group_id',gid).order('created_at',{ascending:false}).limit(100)
 ]);
 if(te||ce)throw Error('Calendar / Corkboard is not ready. Run supabase/upgrade_v0.3.sql in Supabase SQL Editor. '+(te||ce).message);
 if(activeGroupId!==gid)return;
 travelPlans=tp||[];circlePhotos=cp||[];
 if(groupTab==='wall')await signWallPhotos(circlePhotos);
 if(rerender && activeGroupId===gid)render();
}
async function signWallPhotos(photos){
 for(let offset=0;offset<photos.length;offset+=12){
   await Promise.all(photos.slice(offset,offset+12).map(async p=>{
     const entry=wallCache.get(p.image_path);if(entry && entry.expires>Date.now()+30000)return;
     const {data,error}=await supabase.storage.from('circle-photos').createSignedUrl(p.image_path,600);
     if(!error&&data?.signedUrl)wallCache.set(p.image_path,{url:data.signedUrl,expires:Date.now()+540000});
   }));
 }
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
   if(groupTab==='chat')renderMessages();
  })
 .on('postgres_changes',{event:'*',schema:'public',table:'travel_plans',filter:`group_id=eq.${gid}`},()=>{if(activeGroupId===gid)loadCircleExtras(gid).catch(console.warn);})
 .on('postgres_changes',{event:'*',schema:'public',table:'circle_photos',filter:`group_id=eq.${gid}`},()=>{if(activeGroupId===gid)loadCircleExtras(gid).catch(console.warn);})
 .subscribe(status=>{if(status==='CHANNEL_ERROR')showToast('Live updates disconnected. Tap Refresh to sync.',true);});
}
async function syncSession(session){
 const epoch=++currentEpoch;
 if(!session?.user){user=null;profile=null;groups=[];invites=[];members=[];messages=[];travelPlans=[];circlePhotos=[];activeGroupId=null;unsubscribeGroup();loading=false;render();return;}
 if(user?.id===session.user.id&&profile&&!loading)return;
 if(user && user.id!==session.user.id){activeGroupId=null;members=[];messages=[];travelPlans=[];circlePhotos=[];unsubscribeGroup();}
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
async function compressWallPhoto(file){
 if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('Photos only: JPG, PNG or WebP. Videos are not supported.');
 if(file.size>15*1024*1024)throw Error('Image must be smaller than 15 MB before compression.');
 const url=URL.createObjectURL(file);
 try{
  const image=new Image();await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(Error('Cannot open this image.'));image.src=url;});
  const max=1400,scale=Math.min(1,max/Math.max(image.width,image.height));
  const c=document.createElement('canvas');c.width=Math.max(1,Math.round(image.width*scale));c.height=Math.max(1,Math.round(image.height*scale));
  const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(image,0,0,c.width,c.height);
  const blob=await new Promise((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(Error('Image could not be compressed.')),'image/jpeg',.8));
  if(blob.size>3*1024*1024)throw Error('Image is too large after compression. Try a smaller image.');
  return blob;
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
  if(action==='open-group'){activeGroupId=el.dataset.id;groupTab='chat';members=[];messages=[];travelPlans=[];circlePhotos=[];render();await loadGroup(activeGroupId);return;}
  if(action==='refresh-group'){await refresh();showToast('Circle refreshed.');return;}
  if(action==='group-tab'){groupTab=el.dataset.tab;if(groupTab==='wall')await signWallPhotos(circlePhotos);render();return;}
  if(action==='month-prev'||action==='month-next'){calendarCursor=new Date(calendarCursor.getFullYear(),calendarCursor.getMonth()+(action==='month-prev'?-1:1),1);selectedDay='';render();return;}
  if(action==='select-day'){selectedDay=selectedDay===el.dataset.day?'':el.dataset.day;render();return;}
  if(action==='edit-plan'){modal=`edit-plan:${el.dataset.id}`;render();return;}
  if(action==='delete-plan'){
   const p=travelPlans.find(p=>p.id===el.dataset.id);if(!p||!confirm(`Remove ${p.city}, ${p.country} from our calendar?`))return;
   const {error}=await supabase.from('travel_plans').delete().eq('id',p.id);if(error)throw error;
   await loadCircleExtras(activeGroupId);showToast('Plan removed.');return;
  }
  if(action==='delete-photo'){
   const p=circlePhotos.find(p=>p.id===el.dataset.id);if(!p||!confirm('Remove this photo from the corkboard?'))return;
   const {error:se}=await supabase.storage.from('circle-photos').remove([p.image_path]);if(se)throw se;
   const {error}=await supabase.from('circle_photos').delete().eq('id',p.id);if(error)throw error;
   wallCache.delete(p.image_path);await loadCircleExtras(activeGroupId);showToast('Photo unpinned.');return;
  }
  if(action==='revoke-invite'){
   const {error}=await supabase.from('group_invites').delete().eq('id',el.dataset.id);if(error)throw error;
   await loadGroup(activeGroupId);showToast('Invitation revoked.');return;
  }
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
   modal='';await loadGroup(activeGroupId);showToast('Invitation sent. They can accept from their Invitations tab.');return;
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
   const {data:photosForCleanup}=await supabase.from('circle_photos').select('image_path').eq('group_id',g.id);
   if(photosForCleanup?.length){const {error:storageError}=await supabase.storage.from('circle-photos').remove(photosForCleanup.map(p=>p.image_path));if(storageError)throw storageError;}
   const {error}=await supabase.from('groups').delete().eq('id',g.id);if(error)throw error;
   activeGroupId=null;unsubscribeGroup();await refresh();showToast('Circle deleted.');return;
  }
 }catch(e){el.disabled=false;fail(e);}
});
root.addEventListener('change',async event=>{
 const el=event.target;
 if(el.dataset.change==='plan-kind'){
  const trip=el.value==='trip';const trips=$('#trip-fields'),wish=$('#wishlist-fields');if(!trips||!wish)return;
  trips.hidden=!trip;wish.hidden=trip;
  trips.querySelectorAll('input').forEach(e=>e.required=trip);
  wish.querySelectorAll('input').forEach(e=>e.required=!trip);
  return;
 }
 if(el.id==='wall-file'){
  const file=el.files?.[0],preview=$('#photo-preview');if(!preview)return;
  if(!file){preview.innerHTML='<span>📸</span><p>Your photo preview will appear here</p>';return;}
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)){showToast('Please choose a JPG, PNG, or WebP photo.',true);el.value='';return;}
  const url=URL.createObjectURL(file),image=document.createElement('img');image.alt='Selected photo preview';image.src=url;image.onload=()=>URL.revokeObjectURL(url);image.onerror=()=>URL.revokeObjectURL(url);
  preview.replaceChildren(image);return;
 }
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
   const {data:gid,error}=await supabase.rpc('create_circle',{p_name:data.name.trim(),p_description:data.description.trim()});if(error)throw error;
   modal='';await loadLists();activeGroupId=gid;groupTab='chat';render();await loadGroup(gid);showToast('Circle created. Invite your travelers!');return;
  }
  if(form.id==='travel-form'){
   const kind=data.kind,city=String(data.city||'').trim(),country=String(data.country||'').trim();
   if(city.length<2||country.length<2)throw Error('Add both a city and a country.');
   const common={kind,city,country,note:String(data.note||'').trim().slice(0,180)};
   const payload=kind==='trip'?{
      ...common,start_date:data.start_date,end_date:data.end_date,travel_year:null,travel_month:null
    }:{...common,start_date:null,end_date:null,travel_month:Number(data.travel_month),travel_year:Number(data.travel_year)};
   if(kind==='trip'&&(!data.start_date||!data.end_date||data.end_date<data.start_date))throw Error('Check your travel dates — the end must not be before the start.');
   const editId=form.dataset.id;
   const query=editId?supabase.from('travel_plans').update(payload).eq('id',editId):supabase.from('travel_plans').insert({...payload,group_id:activeGroupId,user_id:user.id});
   const {error}=await query;if(error)throw error;
   modal='';await loadCircleExtras(activeGroupId);showToast(editId?'Travel plan updated.':'Travel plan added to the circle!');return;
  }
  if(form.id==='photo-form'){
   if(circlePhotos.length>=100)throw Error('This circle has reached its 100 photo limit.');
   const file=form.querySelector('input[type=file]')?.files?.[0];if(!file)throw Error('Choose a photo first.');
   const caption=String(data.caption||'').trim().slice(0,80);
   const blob=await compressWallPhoto(file),path=`${activeGroupId}/${user.id}/${urlId()}.jpg`;
   const submit=form.querySelector('button[type=submit]');if(submit)submit.disabled=true;
   try{
    const {error:upErr}=await supabase.storage.from('circle-photos').upload(path,blob,{contentType:'image/jpeg',upsert:false});
    if(upErr)throw upErr;
    const {error:dbErr}=await supabase.from('circle_photos').insert({group_id:activeGroupId,user_id:user.id,caption,image_path:path});
    if(dbErr){await supabase.storage.from('circle-photos').remove([path]);throw dbErr;}
    modal='';await loadCircleExtras(activeGroupId);await signWallPhotos(circlePhotos);render();showToast('Memory pinned to your corkboard!');return;
   }finally{if(submit?.isConnected)submit.disabled=false;}
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
