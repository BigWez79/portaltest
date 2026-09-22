import type { NextConfig } from "next";
import { contentSecurityPolicy } from "./src/lib/csp";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  /**
   * `next dev` otherwise appends a "nextjs-agent-rules" block to CLAUDE.md on
   * every start, pointing agents at node_modules/next/dist/docs/. Useful in
   * principle; the problem is that it rewrites a tracked file, so the working
   * tree goes dirty every time anybody runs the dev server.
   *
   * That is not cosmetic here. CLAUDE.md's own rule is that a generated file is
   * gitignored before it is generated, precisely because an untracked or
   * modified file aborts an unattended run — and this one cannot be gitignored,
   * because CLAUDE.md is tracked and is the rule file itself. On 2026-08-26 the
   * sibling repo's overnight run reached "queued tasks: 22" and then stopped
   * dead on "working tree is dirty", which is exactly this failure mode.
   *
   * The docs are still there to read at node_modules/next/dist/docs/. Nothing
   * needs a block in CLAUDE.md to find them.
   */
  agentRules: false,

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          /**
           * The floor. `src/proxy.ts` replaces this with the same policy plus
           * the request's nonce on everything it runs on, which is everything
           * that renders; what is left here is the chunks, the fonts and the
           * logo, none of which are documents and none of which need one.
           *
           * Both layers come from `contentSecurityPolicy` so there is one
           * policy to change, not two — and a response that somehow misses the
           * proxy gets the stricter of the two rather than none.
           */
          { key: "Content-Security-Policy", value: contentSecurityPolicy() },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
