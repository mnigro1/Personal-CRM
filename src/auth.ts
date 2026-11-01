import NextAuth from "next-auth";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { and, eq, isNull } from "drizzle-orm";
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

// Sign-up is open: any address gets its own workspace on first sign-in, so
// the only gate on sending a magic link is abuse control. A magic link IS
// the credential, so asking for one is the endpoint worth abusing: bombing
// a known user's inbox, or burning the SMTP quota until nobody can sign in.
const SIGNIN_LIMIT_PER_EMAIL = { limit: 5, windowSeconds: 15 * 60 };
const SIGNIN_LIMIT_PER_IP = { limit: 20, windowSeconds: 15 * 60 };
// Gmail stops delivering at ~500 messages a day. Tripping our own cap first
// means a clear "busy, try later" on the sign-in page instead of a silent
// bounce — and keeps the sending account from being flagged. Raise or drop
// this once sign-in email moves to a provider on a verified domain.
const SIGNIN_LIMIT_GLOBAL = { limit: 450, windowSeconds: 24 * 60 * 60 };

/** The sign-in page to send this request to instead, or null to proceed. */
async function signInThrottle(email: string): Promise<string | null> {
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
  if (!byEmail.allowed || !byIp.allowed) return "/signin?error=RateLimited";
  const global = await consumeRateLimit("signin:global", SIGNIN_LIMIT_GLOBAL);
  if (!global.allowed) return "/signin?error=Busy";
  return null;
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
      // link is already bounded by the single-use token.
      if (email?.verificationRequest) {
        const sendTo = await signInThrottle(user.email);
        if (sendTo) return sendTo;
      }
      return true;
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
