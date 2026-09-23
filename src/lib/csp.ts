/**
 * The Content-Security-Policy, in one place.
 *
 * The argument behind every server-side decision in this project is that a
 * script running on the page must not be able to reach anything — no Supabase
 * key is in the bundle, no token is in browser storage, and the suite asserts
 * both. None of that is enforced by the browser, though: it is a property of
 * the code holding. This header is the part the browser enforces.
 *
 * Two callers, deliberately:
 *
 * - `src/proxy.ts` calls it with a nonce, for anything that renders. Next
 *   writes inline bootstrap scripts carrying the RSC payload, so `script-src`
 *   cannot simply be `'self'`; it reads the nonce back out of this header and
 *   stamps it on its own tags.
 * - `next.config.ts` calls it with nothing, as the floor under every response
 *   the proxy's matcher skips — the chunks, the fonts, the logo. Those are not
 *   documents and execute nothing, so no nonce is needed and the policy they
 *   carry is strictly the tighter one.
 *
 * One function rather than two literals because two literals drift, and the
 * one that drifts is the one nothing renders through.
 */

/** 128 bits, fresh per request. A guessable nonce is not a nonce. */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Next's own 404 page carries a `<style>` element — five rules setting the
 * colours of a page nothing here wrote. It is built by React on the client from
 * the flight payload, so no nonce reaches it, and under `style-src 'self'` the
 * browser refuses it and logs an error. Rule 4 makes a 404 the ordinary answer
 * to a route somebody may not open, so that is not an edge case; it is what a
 * third of the suite asks for.
 *
 * A hash rather than `'unsafe-inline'` on `style-src`, because a hash names
 * this one string and nothing else. It is a framework internal and will change
 * when Next does — loudly: every 404 test fails on a console error the moment
 * it stops matching, which is the whole of the check. Taken from
 * `node_modules/next/dist/client/components/http-access-fallback/error-fallback.js`
 * on Next 16.3.2.
 *
 * It goes when this suite has a 404 page of its own and Next's is never
 * rendered — see the "404 and a crash that look like the product" task.
 */
const NEXT_FALLBACK_STYLE = "'sha256-Z5XTK23DFuEMs0PwnyZDO9SWxemQ5HxcpVaBNuUJyWY='";

/**
 * `next dev` cannot live under the policy below and is not meant to: React
 * calls `eval` in development to rebuild a server stack trace in the browser,
 * and the dev server writes its stylesheets inline so it can swap them without
 * a reload. Both are gone from a production build — the suite runs against one
 * (`next start`), and asserts on what it is served, so nothing here is what the
 * checks are reading.
 *
 * Keyed on NODE_ENV, which Next sets itself: `next build` and `next start` are
 * "production", and there is no way to reach this branch from a deployment
 * short of building the app in development mode.
 */
const isDev = process.env.NODE_ENV === "development";

export function contentSecurityPolicy(nonce?: string): string {
  const script = nonce
    ? // 'strict-dynamic' means the nonced bootstrap may load the chunks it
      // needs without every chunk URL being listed. Browsers that understand it
      // ignore the 'self' beside it; older ones fall back to that.
      `'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`
    : "'self'";

  // A nonce and 'unsafe-inline' in the same directive is not both: a browser
  // that understands the nonce ignores the 'unsafe-inline' beside it. So in
  // development it is one or the other, and there it has to be the loose one.
  const style = isDev
    ? "'self' 'unsafe-inline'"
    : `'self' ${NEXT_FALLBACK_STYLE}${nonce ? ` 'nonce-${nonce}'` : ""}`;

  return [
    "default-src 'self'",
    `script-src ${script}`,
    `style-src ${style}`,
    // React writes a `style` attribute for anything computed — a bar's width in
    // the margin calculator, a muted colour. An attribute cannot execute, and
    // no nonce or hash mechanism reaches one, so this is where the policy stops
    // rather than a hole in it. `style-src` above still governs <style> and
    // stylesheets, which is where CSS could do damage.
    "style-src-attr 'unsafe-inline'",
    // `data:` is here for one thing: the logo on My Profile, which is a picture
    // resized in the browser, stored as a data URL and printed in an invoice
    // header. It was `'self'` alone until that was built, on the reasoning that
    // the logo was a file — it never was, and the policy quietly made the
    // feature impossible rather than making anything safer.
    //
    // What it costs: a data URL in an `img` is a sandboxed image context, so an
    // SVG arriving that way cannot run script. What actually keeps a crafted
    // picture out of a document is `checkLogo` in profile-calc.ts, which takes
    // PNG and nothing else, and the constraint in 0008_profile_logo.sql behind
    // it. Still no `blob:` — nothing displays one; the PDFs are downloaded.
    "img-src 'self' data:",
    "font-src 'self'",
    // Server actions and the RSC router both post back here and nowhere else.
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // The same thing X-Frame-Options says, said in the header that is actually
    // specified. Both are sent: the old one is what an old browser reads.
    "frame-ancestors 'none'",
  ].join("; ");
}
