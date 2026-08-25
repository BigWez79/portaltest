# Queue

Read top to bottom, one task per run, one commit per task. Move a finished task
to **Done** with the branch name beside it. Anything in **Held** needs a person
and must not be picked up.

Every "done when" here is meant to be checkable by something working alone at
3am. If one is not, it is a bad task — say so in the pull request rather than
guessing.

---

## Next up

### 1. A route for the Admin tile
The Admin tile currently points at `/admin`, which does not exist. Add a route
that renders a placeholder page behind the same access check as the tile, so a
non-admin who types the URL gets the sign-in card rather than a 404 that leaks
the route's existence.

**Done when** `tests/access-matrix.spec.ts` has a case proving a non-admin
requesting `/admin` is not served admin content, and `npm run verify` passes.

### 2. Middleware so no route is unprotected by default
Access is enforced per page today. Add `src/middleware.ts` that requires a
session for everything except `/`, `/api/auth/*` and static assets, so a new
route is protected before anyone remembers to protect it.

**Done when** a test requests an invented path while signed out and is redirected
to `/`, and every existing test still passes.

### 3. Structured logging for a staff-lookup miss
`resolveAccess` currently `console.warn`s when nobody matches. Emit one
structured line instead — address, whether it was a UPN or a mailbox match
attempt, and the source — so a mismatch is diagnosable from Vercel's log without
guessing.

**Done when** a test asserts the miss line is emitted for an unknown address and
is *not* emitted for a known one.

### 4. A `--check` mode smoke test for the sync
`scripts/sync-staff.ts --check` reports differences and exits non-zero. It has no
test. Add one against a fake Graph response and a fake Supabase client so the
mapping (`Title` -> `email`, `Yes` -> `true`, and so on) is pinned.

**Done when** the test covers a new row, a changed flag, an orphan and a row with
an empty `Title`.

### 5. Accessibility pass on the tile grid
Tiles are anchors carrying three spans. Check heading order, focus order, focus
visibility and that each tile's accessible name is its app name rather than the
whole blurb.

**Done when** an automated axe pass runs in the suite with no violations at 390
and 1440, and the screenshots are attached.

---

## Held — needs a person

- Creating the Entra web app registration and its secret (BLOCKED.md)
- Creating the Supabase projects and applying `0001_staff.sql` (BLOCKED.md)
- Pointing `portal.poweranalytix.co.uk` at Vercel (BLOCKED.md)
- Deciding whether Supabase becomes the master for staff access (BLOCKED.md)

---

## Done

_(nothing yet — this repo is the first commit)_
