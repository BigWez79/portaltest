# Email templates

Two templates, pasted into the dashboard by a person. `BLOCKED.md` lists email
templates under project settings, and `supabase config push` would be the
workaround it forbids — so these live here, in version control, and a person
copies them across.

| File | Dashboard location |
|---|---|
| `magic-link.html` | Authentication → Emails → **Magic Link** |
| `invite.html` | Authentication → Emails → **Invite user** |

## Why the stock templates do not work here

Supabase ships templates built on `{{ .ConfirmationURL }}`, which expands to

```
https://<ref>.supabase.co/auth/v1/verify?token=…&type=…&redirect_to=…
```

Supabase verifies that itself and redirects to `redirect_to` **with the session
in the URL fragment**, which only client-side JavaScript can read.

`src/app/auth/callback/route.ts` does the opposite on purpose: it takes a
`token_hash` and calls `verifyOtp` on the server, so no token is ever handled in
the browser — the same principle as every other Supabase call in this project,
and the reason the session cookie is `httpOnly`.

Put the two together unchanged and sign-in is quietly broken: the link lands on
`/auth/callback` with no `token_hash`, the route bounces to `/?error=link`, and
the real session sits unread in the address bar. That was the state of things on
25 August 2026. The route now logs exactly this case by name rather than leaving
it to be rediscovered.

## Why the templates changed and not the route

The other server-side option was to accept Supabase's PKCE `?code=` redirect and
call `exchangeCodeForSession`. It was rejected for one practical reason: PKCE
needs the code-verifier cookie set by the browser that *asked* for the link, so a
link requested on a laptop and opened on a phone fails. `token_hash` works across
devices, which is how people actually read email.

Rewriting the route to read the fragment was never on the table — that needs a
browser Supabase client, which `CLAUDE.md` rule 1 forbids outright.

## The two things worth getting right

**`{{ .RedirectTo }}`, not `{{ .SiteURL }}`.** `RedirectTo` is what the app
passed as `emailRedirectTo` — `<site>/auth/callback` — so one template serves
localhost, staging and every Vercel preview. Supabase accepts wildcard redirect
URLs, which is what makes preview sign-ins possible at all; hard-coding
`SiteURL` would throw that away. The `{{ if .RedirectTo }}` fallback covers a
link sent from the dashboard, where it is empty.

**The `type` must match the token.** A magic link is `type=magiclink`, an invite
is `type=invite`. Verifying an invite as a magic link fails with a message that
reads like an expired link, which is a bad hour. The route validates the type
against the list `verifyOtp` accepts and logs it plainly when it does not match.

## After pasting

```
./deploy/check-auth-config.sh      # signups still disabled, etc.
```

then request a link from the portal and open it. If it bounces to the sign-in
page, the server log names the reason — no `token_hash`, wrong `type`, or
Supabase rejecting the token itself.
