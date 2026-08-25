import NextAuth from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";

/**
 * Sign-in only. The portal asks for no Graph scope at all — it needs a name and
 * an address, and the staff lookup happens server-side against Supabase.
 *
 * Portal v2.0 requested Sites.ReadWrite.All and handed that token to the
 * browser. Nothing here does.
 */
const SCOPES = "openid profile email";

type EntraProfile = {
  sub: string;
  tid?: string;
  name?: string;
  email?: string;
  preferred_username?: string;
};

const tenantId = process.env.ENTRA_TENANT_ID ?? "";

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt", maxAge: 60 * 60 * 8 },
  pages: { signIn: "/", error: "/" },
  providers: [
    MicrosoftEntraID({
      clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
      clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
      // Pinned to the tenant. Without this the issuer defaults to /common/ and
      // any Microsoft account can start a sign-in.
      issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
      authorization: { params: { scope: SCOPES } },
      profile(profile: EntraProfile) {
        const upn = (profile.preferred_username ?? "").toLowerCase();
        const mail = (profile.email ?? "").toLowerCase();
        return {
          id: profile.sub,
          name: profile.name ?? null,
          // The Staff list keys on an email address. Entra hands back a UPN that
          // is not always the mailbox, so keep both and match on either.
          email: mail || upn || null,
          upn: upn || null,
          image: null,
        };
      },
    }),
  ],
  callbacks: {
    /**
     * Belt and braces over the pinned issuer: reject a token minted for any
     * other directory, even if the issuer check is ever relaxed.
     */
    signIn({ profile }) {
      const tid = (profile as EntraProfile | undefined)?.tid;
      if (!tenantId) return false;
      return typeof tid === "string" && tid.toLowerCase() === tenantId.toLowerCase();
    },
    jwt({ token, profile }) {
      if (profile) {
        const p = profile as EntraProfile;
        const upn = (p.preferred_username ?? "").toLowerCase();
        const mail = (p.email ?? "").toLowerCase();
        token.email = mail || upn;
        token.name = p.name ?? token.name;
        token.upn = upn;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.email = (token.email as string) ?? "";
        session.user.name = (token.name as string) ?? null;
        session.user.upn = (token.upn as string) ?? null;
      }
      return session;
    },
  },
});
