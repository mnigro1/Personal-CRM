import NextAuth from "next-auth";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "@/db";
import { clientIp, consumeRateLimit } from "@/db/rate-limit";
import {
  accounts,
  invites,
  sessions,
  users,
  verificationTokens,
  workspaces,
} from "@/db/schema";

// A magic link IS the credential, so asking for one is the endpoint worth
// abusing: bombing a known user's inbox, or burning the SMTP quota (Gmail
// allows a few hundred messages a day) until nobody can sign in.
const SIGNIN_LIMIT_PER_EMAIL = { limit: 5, windowSeconds: 15 * 60 };
const SIGNIN_LIMIT_PER_IP = { limit: 20, windowSeconds: 15 * 60 };

async function signInRateLimited(email: string): Promise<boolean> {
  let ip = "unknown";
  try {
    ip = clientIp(await headers());
  } catch {
    // Outside a request scope (tests); the per-email bucket still applies.
  }
  const [byEmail, byIp] = await Promise.all([
    consumeRateLimit(`signin:email:${email}`, SIGNIN_LIMIT_PER_EMAIL),
    consumeRateLimit(`signin:ip:${ip}`, SIGNIN_LIMIT_PER_IP),
  ]);
  return !byEmail.allowed || !byIp.allowed;
}

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
      // An hour is plenty to open an email; a day-long live credential is not.
      maxAge: 60 * 60,
      options: {},
      async sendVerificationRequest({ identifier, url }) {
        const isProd = process.env.NODE_ENV === "production";
        // Gmail SMTP (app password): free, delivers to any recipient —
        // unlike Resend's free tier, which only reaches the account owner.
        if (isProd && process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
          const { createTransport } = await import("nodemailer");
          const transporter = createTransport({
            host: "smtp.gmail.com",
            port: 465,
            secure: true,
            auth: {
              user: process.env.GMAIL_USER,
              pass: process.env.GMAIL_APP_PASSWORD,
            },
          });
          await transporter.sendMail({
            from: `"Personal CRM" <${process.env.GMAIL_USER}>`,
            to: identifier,
            subject: "Sign in to Personal CRM",
            text: `Click to sign in:\n\n${url}\n\nThis link expires in 1 hour. If you didn't request it, ignore this email.`,
          });
          return;
        }
        if (isProd && process.env.RESEND_API_KEY) {
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
        // Never fall through to the console in production: the link is a
        // live credential, and hosted logs are not a place to keep one.
        if (isProd) {
          throw new Error(
            "No email provider configured: set GMAIL_USER + GMAIL_APP_PASSWORD, or RESEND_API_KEY + EMAIL_FROM",
          );
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
    // Expired links and the like land back on the form with a message,
    // not on the framework's default error page.
    error: "/signin",
  },
  callbacks: {
    async signIn({ user, email }) {
      if (!user.email) return false;
      // Only the request step (sending a link) is throttled — clicking the
      // link is already bounded by the single-use token. Counted before the
      // allow-list check so unknown addresses can't be probed in bulk either.
      if (email?.verificationRequest && (await signInRateLimited(user.email))) {
        return "/signin?error=RateLimited";
      }
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
