/**
 * Where a session that has to end goes, and what the sign-in card says
 * afterwards.
 *
 * Plain constants in their own file on purpose: the sign-in card is a client
 * component, so it cannot import them from `session.ts`, which is server-only.
 * Two literals kept in one place beat the same two strings typed out in three.
 */
export const SIGNED_OUT_PATH = "/auth/signed-out";

/** The `?error=` value the sign-in card reads. */
export const SIGNED_OUT_REASON = "access-ended";
