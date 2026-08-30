# BrainiLab V41.0 — final manual browser checklist

Run once on the V41.0 local server before Step 2 deployment.

- Desktop: Home, Games, Daily, one evergreen quiz, Rankings, Groups, Profile, Plus, Suggestions, Admin.
- Mobile (~390 px): same core pages; open/close mobile nav and all modals/sheets.
- Auth: guest → Google login → signed-in avatar → sign out → sign in again.
- Daily: start/finish each of the four game types; confirm 10,000-point total model and no answer leakage.
- Evergreen: complete one 20-question quiz; result CTA/share and explanation timing.
- Rankings: Global/Country and Individual/Friends/Groups; empty/error states must not invent users.
- Groups/Friends: create/invite/accept/remove with real Supabase state.
- Plus: active member, Manage subscription, scheduled-cancellation copy, checkout blocked if membership verification is unavailable.
- Suggestions: real Supabase success and visible failure if backend is unavailable.
- Admin: navigation, Daily Operations, content, users, results, monetization, question quality.
- Responsive: no horizontal page overflow at 320/390/760/920 widths; tables/charts may scroll inside their own containers.
- Confirm no `LOCAL STRIPE TEST` appears anywhere. `?ads_test=1` is allowed only on localhost/private LAN and remains deliberate QA tooling.
