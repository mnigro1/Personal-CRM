import NextAuth from "next-auth";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  invites,
  sessions,
  users,
  verificationTokens,
  workspaces,
} from "@/db/schema";

async function isSignInAllowed(email: string): Promise<boolean> {
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email));
  if (existing) return true;

  // Bootstrap: the very first user in an empty database is the owner.
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(users);
  if (count === 0) return true;

  const [invite] = await db
    .select({ id: invites.id })
    .from(invites)
    .where(
      and(
        eq(invites.email, email),
        isNull(invites.acceptedAt),
        gt(invites.expiresAt, new Date()),
      ),
    );
  return !!invite;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  providers: [
    {
      id: "email",
      type: "email",
      name: "Email",
      from: process.env.EMAIL_FROM ?? "crm@localhost",
      maxAge: 24 * 60 * 60,
      options: {},
      async sendVerificationRequest({ identifier, url }) {
        if (process.env.NODE_ENV === "production" && process.env.RESEND_API_KEY) {
          const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: process.env.EMAIL_FROM,
              to: identifier,
              subject: "Sign in to Personal CRM",
              text: `Sign in link: ${url}`,
            }),
          });
          if (!res.ok) throw new Error(`Resend failed: ${await res.text()}`);
          return;
        }
        // Dev: no email provider — the link is the console output.
        console.log(
          `\n🔑 Magic link for ${identifier}:\n${url}\n`,
        );
      },
    },
  ],
  pages: {
    signIn: "/signin",
    verifyRequest: "/signin/sent",
  },
  callbacks: {
    async signIn({ user }) {
      if (!user.email) return false;
      return isSignInAllowed(user.email);
    },
    session({ session, user }) {
      session.user.id = user.id;
      return session;
    },
  },
  events: {
    async createUser({ user }) {
      if (!user.id || !user.email) return;
      await db.insert(workspaces).values({
        ownerUserId: user.id,
        name: `${user.name ?? user.email.split("@")[0]}'s workspace`,
      });
      await db
        .update(invites)
        .set({ acceptedAt: new Date() })
        .where(and(eq(invites.email, user.email), isNull(invites.acceptedAt)));
    },
  },
});
