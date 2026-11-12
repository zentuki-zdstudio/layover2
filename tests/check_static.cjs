const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');
const read = n => fs.readFileSync(path.join(__dirname,'..',n),'utf8');
const sql=read('supabase/schema.sql');
const html=read('index.html');
const app=read('app.js');
const css=read('styles.css');
for(const t of ['profiles','groups','group_members','group_invites','messages','message_reports']) {
 assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security;`), `RLS missing: ${t}`);
}
assert.equal((sql.match(/create policy \w+ on /g)||[]).length,18,'Expected 18 SQL policies (incl. avatars)');
assert.match(sql,/create function public.seed_group_owner/);
assert.match(sql,/create function public.accept_group_invite/);
assert.match(sql,/grant update \(role\) on public.group_members/);
assert.match(sql,/revoke all on public.profiles/);
assert.match(sql,/storage\.foldername\(name\)/);
assert.match(sql,/alter publication supabase_realtime add table public.messages/);
assert.match(app,/signInWithPassword/);
assert.match(app,/signUp/);
assert.match(app,/group_invites/);
assert.match(app,/createSignedUrl/);
assert.match(app,/postgres_changes/);
assert.match(sql,/messages_member_send/);
assert.match(html,/id="root"/);
assert.match(css,/@media\(max-width:700px\)/);
console.log('Static structure checks passed');
