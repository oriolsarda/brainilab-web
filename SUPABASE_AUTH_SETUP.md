# BrainiLab — Step 1: Supabase + Authentication

This build prepares the first real backend step: **user authentication**.

Implemented in the frontend:

- Google sign-in through Supabase Auth.
- Create account with email + password.
- Sign in with email + password.
- Email confirmation flow.
- Forgot-password email.
- Password reset page.
- Persistent Supabase browser sessions.
- Supabase user ID mirrored into the existing BrainiLab data layer.
- Local prototype fallback when Supabase has not yet been configured.

## Important scope of Step 1

Authentication is real once Supabase is configured, but **gameplay data is still local to the browser**.

The following are not in PostgreSQL yet:

- player profile
- streak
- Daily Brain Score
- game results
- friends
- groups
- rankings

Those move to the database in the next backend steps. This avoids mixing authentication work with the player-data model before the latter is designed.

---

## 1. Create the Supabase project

Create a hosted project in Supabase.

From the project dashboard, copy:

- Project URL
- Publishable key (`sb_publishable_...`)

Do **not** use the `service_role` / secret key in browser code.

## 2. Configure BrainiLab

Edit:

`assets/js/supabase-config.js`

For local development on the server we have been using:

```js
window.BRAINI_SUPABASE = {
  url: "https://YOUR_PROJECT_REF.supabase.co",
  publishableKey: "sb_publishable_YOUR_KEY",

  authRedirectUrl: "http://localhost:8000/profile/index.html",
  passwordResetRedirectUrl: "http://localhost:8000/auth/reset-password/index.html"
};
```

Later, production should use BrainiLab's HTTPS domain:

```js
window.BRAINI_SUPABASE = {
  url: "https://YOUR_PROJECT_REF.supabase.co",
  publishableKey: "sb_publishable_YOUR_KEY",

  authRedirectUrl: "https://brainilabgames.com/profile/index.html",
  passwordResetRedirectUrl: "https://brainilabgames.com/auth/reset-password/index.html"
};
```

## 3. Configure Auth URLs in Supabase

In Supabase Auth → URL Configuration:

For current local development:

- Site URL: `http://localhost:8000`
- Redirect URL: `http://localhost:8000/**`

When BrainiLab is deployed:

- Site URL: `https://brainilabgames.com`
- Add the exact production redirects you use, such as:
  - `https://brainilabgames.com/profile/index.html`
  - `https://brainilabgames.com/auth/reset-password/index.html`

Keep localhost only for development.

## 4. Email + password

In Auth → Providers → Email:

- Enable email/password authentication.
- Keep email confirmation enabled for production.

The site already calls:

- `supabase.auth.signUp()`
- `supabase.auth.signInWithPassword()`
- `supabase.auth.resetPasswordForEmail()`
- `supabase.auth.updateUser()`
- `supabase.auth.signOut()`

No password is stored in the BrainiLab database or JavaScript.

## 5. Google login

In Google Auth Platform / Google Cloud:

1. Create an OAuth Client ID of type **Web application**.
2. Add Authorized JavaScript origin:
   - `http://localhost:8000`
   - later `https://brainilabgames.com`
3. Under Authorized redirect URIs, add the **Supabase callback URL shown on the Google provider page in your Supabase dashboard**.
4. Copy the Google Client ID and Client Secret.
5. In Supabase Auth → Providers → Google:
   - Enable Google.
   - Paste Client ID.
   - Paste Client Secret.

The Google Client Secret belongs in Supabase, never in the BrainiLab frontend.

BrainiLab already calls:

```js
supabase.auth.signInWithOAuth({
  provider: "google",
  options: {
    redirectTo: "..."
  }
})
```

## 6. Test locally

From the BrainiLab folder, run a local web server on port 8000.

Then open:

`http://localhost:8000/profile/index.html`

Test:

### Email account

1. Click **Save my progress**.
2. Choose **Create account**.
3. Enter email + password.
4. Confirm the email.
5. Return to BrainiLab.
6. My BrainiLab should show the real Supabase email and an **Account active** badge.

### Sign in

1. Sign out.
2. Open the account modal.
3. Select **Sign in**.
4. Use the same email/password.

### Google

1. Click **Continue with Google**.
2. Complete Google's consent flow.
3. Supabase should redirect to `/profile/index.html`.
4. The session should persist on reload.

### Password reset

1. Choose **Sign in**.
2. Enter the email.
3. Click **Forgot password?**
4. Open the Supabase reset email.
5. The link returns to:
   `auth/reset-password/index.html`
6. Set a new password.

## 7. Files added in this step

- `assets/js/supabase-config.js`
- `assets/js/supabase-auth.js`
- `auth/reset-password/index.html`
- this `SUPABASE_AUTH_SETUP.md`

Updated:

- `assets/js/auth.js`
- `assets/js/data.js`
- all HTML pages load the Supabase browser client before BrainiLab Auth.

## 8. Security boundary

This step uses only Supabase's **publishable browser key**.

Never put any of these in a frontend file:

- Supabase service-role key
- Supabase secret key
- Google OAuth client secret
- database password

Those stay server-side / in Supabase's dashboard.

## 9. What Step 2 will add

Once authentication is verified, the next step is the `profiles` layer.

It will create the first BrainiLab-owned PostgreSQL table connected to `auth.users` and will let us store:

- display name
- avatar
- country
- friend code
- account creation metadata

At that point we can begin the real guest → account migration instead of only keeping guest gameplay data in the browser.

## Official reference

Supabase Auth:
https://supabase.com/docs/guides/auth

Email/password:
https://supabase.com/docs/guides/auth/passwords

Google:
https://supabase.com/docs/guides/auth/social-login/auth-google

Redirect URLs:
https://supabase.com/docs/guides/auth/redirect-urls
