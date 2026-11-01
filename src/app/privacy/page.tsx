import Link from "next/link";

export const metadata = { title: "Privacy Policy" };

const LAST_UPDATED = "November 1, 2026";

/**
 * Plain-language description of what the app actually does with data.
 * Public (no session). Keep every statement here true of the code: when a
 * processor or a data flow changes, this page changes in the same PR.
 */
export default function PrivacyPage() {
  const supportEmail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL;
  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6 text-sm leading-relaxed">
      <div>
        <h1 className="text-2xl font-semibold">Privacy Policy</h1>
        <p className="mt-1 text-xs text-muted-foreground">Last updated {LAST_UPDATED}</p>
      </div>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">What Personal CRM is</h2>
        <p>
          Personal CRM is a private notebook for the people in your life: who
          they are, what you talked about, what you promised to do next. You
          can connect your own AI assistant (such as Claude or ChatGPT) so it
          can read and write your notebook on your instruction.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">What we store</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Your account:</strong> your email address, timezone, and
            the settings you choose (such as how you like messages drafted).
          </li>
          <li>
            <strong>Your notebook:</strong> the contacts, notes, memories,
            follow-ups, introductions and message drafts you add — directly
            or through your AI. Notes are stored exactly as you entered them.
          </li>
          <li>
            <strong>Sign-in data:</strong> single-use sign-in links and the
            session that keeps you signed in. We never store a password.
          </li>
          <li>
            <strong>Connector keys:</strong> the credential your AI uses to
            reach your notebook is stored only as a one-way hash.
          </li>
          <li>
            <strong>Operational data:</strong> our hosting provider keeps
            standard request logs (IP address, URL, time) for a limited period,
            and we keep short-lived counters used to limit abuse.
          </li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Notes about other people</h2>
        <p>
          Your notebook is about people who are not our users. You decide what
          to write down, and you are responsible for recording it fairly and
          lawfully. If someone asks you to remove what you hold about them, you
          can delete it yourself at any time; we do not share your notebook
          with anyone, including the people in it.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Where your data goes</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Hosting and database:</strong> the app runs on Vercel and
            stores data in a Neon Postgres database in the United States,
            encrypted in transit and at rest by those providers.
          </li>
          <li>
            <strong>Sign-in emails:</strong> the link that signs you in is sent
            by an email provider; the only thing sent is that link.
          </li>
          <li>
            <strong>Your AI:</strong> when you connect Claude, ChatGPT or
            another assistant, parts of your notebook are sent to that provider
            only when your assistant asks for them while working for you, and
            only through the connector you created. That provider&apos;s own
            terms and privacy policy govern what it does with them. Revoking
            the connector in Settings stops this immediately.
          </li>
        </ul>
        <p>
          We do not sell your data, show ads, or use your notebook to train
          anything.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Your controls</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Export:</strong> Settings → Your data downloads everything
            we hold for you as a file you keep.
          </li>
          <li>
            <strong>Delete:</strong> Settings → Your data → Delete my account
            permanently erases your account and your entire notebook. There is
            no retention copy.
          </li>
          <li>
            <strong>Revoke:</strong> any connector key can be revoked in
            Settings, and signing out ends your session.
          </li>
        </ul>
        <p>
          We keep your data for as long as you keep your account. Hosting
          providers may retain backups for a short period after deletion.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Security</h2>
        <p>
          Every request is scoped to your own workspace, connector keys are
          hashed, sign-in links expire within an hour and work once, and
          abusive request patterns are rate-limited. No system is perfect; if
          you believe something is wrong, please tell us so we can fix it.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Changes and contact</h2>
        <p>
          If this policy changes in a way that matters, the date above changes
          and we will say so in the app.
          {supportEmail ? (
            <>
              {" "}
              Questions: <a className="underline" href={`mailto:${supportEmail}`}>{supportEmail}</a>.
            </>
          ) : null}
        </p>
      </section>

      <p className="text-xs text-muted-foreground">
        <Link href="/" className="underline">Home</Link> ·{" "}
        <Link href="/terms" className="underline">Terms of Service</Link> ·{" "}
        <Link href="/signin" className="underline">Back to sign in</Link>
      </p>
    </main>
  );
}
