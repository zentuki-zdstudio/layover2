# ✳ LAYOVER v0.2 — real accounts and private group chats

**Today’s release:** sign up / sign in, editable profiles, photo upload, private groups, invite-by-username, owner/admin/member roles, accept/decline invitations, realtime text chat, reporting and leave/remove/delete actions. Unfinished Travel Radar, Memory Wall, events and booking features are **hidden**.

This is a **working frontend + database schema**, but **it is not live until you create a Supabase project and connect your own public credentials**. There is no fake chat mode.

## 1. Create a Supabase project

1. Open <https://supabase.com/dashboard> → New project. Give it a name and choose a region near your users.
2. Open **SQL Editor → New query**.
3. Copy the **entire contents** of `supabase/schema.sql` and run it **once on a new Supabase project**. It creates the necessary tables, authentication triggers, row-level security policies, storage bucket, and realtime publication. Re-running it will cause `already exists` errors.
4. In **Project Settings → API Keys** (or **Connect** depending on your dashboard) copy your **Project URL** and **publishable key** (`sb_publishable_...`). Legacy public `anon` key also works.
5. Open `config.js` and paste only those two public values:

```js
window.LAYOVER_CONFIG = {
  supabaseUrl: 'https://YOUR-PROJECT.supabase.co',
  publishableKey: 'sb_publishable_YOUR_PUBLIC_KEY'
};
```

**NEVER put a `service_role`, `sb_secret`, JWT secret, database password, or SMTP password into frontend files or GitHub.** The publishable/anon key is intended to be public; RLS protects the database.

## 2. Authentication URL configuration (critical)

In Supabase go to **Authentication → URL Configuration**:

- **Site URL:** the exact public base URL for your website, for example `https://YOUR-GITHUB-NAME.github.io/layover/`.
- **Redirect URLs:** add that same complete URL, with its trailing slash. If developing locally add `http://localhost:8000/` and `http://127.0.0.1:8000/`.
- **Authentication → Providers → Email:** keep Email enabled. For a private pilot, enable **Confirm email** to help prevent impersonation.
- If sign-up confirmation emails aren't reaching other people, configure your own SMTP sender before wider use. Supabase’s default email sender can have restrictions/rate limits.

If a user's email confirmation is required, they'll need to click it before sign-in. On registration, the app generates an initial username like `traveler_XXXXXXXXXXXX`; the user can change it on their profile page.

## 3. Launch locally or on GitHub Pages

For local testing:

```bash
cd layover-live
python3 -m http.server 8000
```

Visit <http://localhost:8000/>.

For GitHub Pages:

1. Create a new GitHub repository, e.g. `layover`.
2. Upload the **files inside** `layover-live/` to your repository root (so `index.html` and `config.js` are in the root).
3. Repository **Settings → Pages → Deploy from a branch → main → /(root) → Save**.
4. Open the generated page at `https://YOUR-GITHUB-NAME.github.io/layover/`.
5. Ensure your actual website URL is included in the Supabase Auth URLs; otherwise email confirmation/password recovery may redirect incorrectly.

The UI uses plain HTML, CSS, and JavaScript. There is **no Node build step**. Supabase JS loads through the version-pinned official jsDelivr CDN script. The browser must be online for chat, login and avatar storage to work.

## 4. End-to-end test with two accounts

1. Open the site in normal Chrome and an incognito/private window (or two browsers).
2. Register one account in each with two different email addresses. Confirm both emails as necessary.
3. On Account B, open **My profile**, customize the username, e.g. `alex_crew`.
4. On Account A, **Create circle**: `Sir Tobey's Locos` (or any name). Account A becomes `owner` automatically.
5. Click **Invite**, enter `@alex_crew`, find the user, and send an invitation.
6. In Account B, open **Invitations → Join circle**.
7. Open the group from both accounts and send a message. It should appear on the other screen without refresh.
8. On Account A, promote Account B from `member` to `admin`; admins can now invite others.
9. Confirm a third account cannot read any group chats until invited and joined.

## 5. Authorization rules implemented at the DB level

- Users can edit their **own** name, username, bio, country and avatar path; emails are never displayed publicly.
- Members can see their **own groups** and messages; other users can't read them using arbitrary IDs.
- Only a group’s owner/admin can invite and manage non-owner member roles. Nobody can self-assign owner or admin.
- An invitation is **pending** until the named recipient accepts; only acceptance grants membership through a database trigger.
- Group owner cannot leave without deleting their group. Owner can delete the entire group and messages; non-owners can leave.
- Chat message `user_id` must match the authenticated user, and their group membership is checked at insertion.
- Photos are in a **private Supabase Storage bucket**; paths are user-specific, upload writes are limited to the uploader's folder; other logged-in users can request time-limited signed URLs for displayed profile images.
- Messages are up to 1,000 characters. Basic report submission is implemented; reports are only visible to project operators via the Supabase dashboard, not other users.

## 6. Limitations before a public release

- This is intended for a **small invite-only pilot**, not an unmoderated public social platform. Before public rollout, add an accessible support/moderation workflow, message blocking and abuse handling, account/data deletion, rate limiting, anti-spam protections, and age-appropriate safeguards.
- Anyone who knows a registered username can send an invite. Group chats require acceptance. Profiles are searchable by **exact username**; there is no public people feed.
- Online presence, push notifications, attachments in chat, direct messages, and location sharing are intentionally out of scope.
- Basic Postgres Changes is fine for a small pilot; for scale, migrate to Realtime Broadcast per Supabase docs.
- Avatars are available to other signed-in users. Do not upload a photo without permission, including group photos.
- Email signups may be limited by the default SMTP service.
- There is no account self-deletion UI yet. Plan for a secure server-side delete-account workflow before public release.
- SQL schema is intended for a **fresh** project. Don't apply it over an existing database without review.

## 7. Files

```
index.html              UI shell
styles.css              responsive mobile/desktop design
app.js                  authenticated frontend
config.js               YOUR PUBLIC Supabase URL/key placeholders
supabase/schema.sql     database tables, triggers, RLS, storage and realtime
manifest.webmanifest    basic PWA metadata
assets/*                branding assets
sw.js                   cache of static UI assets (never caches Supabase API responses)
README.md               deployment and security instructions
```

### Docs
- Supabase Auth: https://supabase.com/docs/guides/auth
- Supabase RLS: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase Realtime: https://supabase.com/docs/guides/realtime/postgres-changes
- Supabase Auth redirect URLs: https://supabase.com/docs/guides/auth/redirect-urls
- GitHub Pages: https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site
