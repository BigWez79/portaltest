import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface User {
    upn?: string | null;
  }
  interface Session {
    user: {
      name?: string | null;
      email?: string | null;
      image?: string | null;
      upn?: string | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    upn?: string | null;
  }
}
