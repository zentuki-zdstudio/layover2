"""Browser smoke test with a fake Supabase client; does NOT test real DB or RLS."""
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
source=(ROOT/'app.js').read_text()
source=source.replace('const createClient=window.supabase?.createClient;','const createClient=window.__FAKE_SUPABASE.createClient;')
assert 'window.__FAKE_SUPABASE' in source
style='\n'.join((ROOT/'styles.css').read_text().splitlines()[1:])
mock='''
window.LAYOVER_CONFIG = { supabaseUrl: 'https://test-project.supabase.co', publishableKey: 'sb_publishable_' + 'x'.repeat(30) };
const u={id:'aabbccdd-1111-4444-aaaa-bbbbccccdddd',email:'test@example.com'};
const p={id:u.id, username:'traveler_12345',display_name:'Traveler One',home_country:'Czechia',bio:'Hi',avatar_path:null};
const gr={id:'12345678-1234-4567-aabb-000000000001',name:'Sir Tobeys Locos',description:'Prague crew',created_at:'2026-11-12T12:00:00Z'};
const fake = {
 auth:{getSession:async()=>({data:{session:{user:u}}}),onAuthStateChange:()=>{},signOut:async()=>({error:null})},
 storage:{from:()=>({createSignedUrl:async()=>({data:{signedUrl:'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='}})})},
 channel:()=>({on:function(){return this},subscribe:function(){return this}}),removeChannel:()=>{},
 from:(table)=>{
  const request={ filters:[], method:'select', vals:null,
   select(){return this},eq(key,val){this.filters.push([key,val]);return this},order(){return this},limit(){return this},in(){return this},
   single(){return this.query(true)},maybeSingle(){return this.query(true)},
   insert(vals){this.method='insert';this.vals=vals;return this},update(vals){this.method='update';this.vals=vals;return this},delete(){this.method='delete';return this},
   async query(single){
    let data=[];
    if(table==='profiles') data=single ? p:[p];
    else if(table==='group_members') {
      if(this.filters.some(([k])=>k==='user_id')) data=[{group_id:gr.id,role:'owner',groups:gr}];
      else data=[{group_id:gr.id,user_id:u.id,role:'owner',profiles:p}];
    }
    else if(table==='group_invites') data=[];
    else if(table==='messages') data=[{id:'msg1',group_id:gr.id,user_id:u.id,body:'Hello world',created_at:'2026-11-12T12:30:00Z'}];
    else if(table==='groups')data=[gr];
    return {data,error:null};
   },
   then(resolve,reject){return this.query(false).then(resolve,reject)}
  };
  return request;
 }
};
window.__FAKE_SUPABASE={createClient:()=>fake};
'''
with sync_playwright() as playwright:
 b=playwright.chromium.launch(headless=True,executable_path='/usr/bin/chromium', args=['--no-sandbox','--disable-dev-shm-usage'])
 try:
  page=b.new_page(viewport={'width':390,'height':844},device_scale_factor=1)
  errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.set_content('<html><head></head><body><div id="root"></div><div id="toast"></div></body></html>')
  page.add_style_tag(content=style)
  page.add_script_tag(content=mock)
  page.add_script_tag(content=source)
  page.wait_for_selector('text=Sir Tobeys Locos',timeout=10000)
  assert page.locator('text=Your groups').count()>0
  page.get_by_role('button',name='Sir Tobeys Locos').click()
  page.wait_for_selector('text=Hello world',timeout=10000)
  assert page.locator('text=Group chat').count()>0
  assert page.locator('text=Travel Radar').count()==0
  page.screenshot(path=str(ROOT/'tests'/'chat-mobile.png'),full_page=True)
  page.get_by_role('button',name='+ Invite').first.click()
  page.wait_for_selector('text=Invite a traveler')
  page.screenshot(path=str(ROOT/'tests'/'invite-mobile.png'),full_page=True)
  print('CHAT + INVITE UI SMOKE OK')
  print('BROWSER ERRORS:',errors)
  assert not errors, errors
 finally:
  b.close()
