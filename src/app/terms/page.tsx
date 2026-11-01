import Link from "next/link";

export const metadata = { title: "Terms of Service · Personal CRM" };

const LAST_UPDATED = "November 1, 2026";

/** Public (no session). Plain language on purpose; see the privacy page too. */
export default function TermsPage() {
  const supportEmail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL;
  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6 text-sm leading-relaxed">
      <div>
        <h1 className="text-2xl font-semibold">Terms of Service</h1>
        <p className="mt-1 text-xs text-muted-foreground">Last updated {LAST_UPDATED}</p>
      </div>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">The service</h2>
        <p>
          Personal CRM is a tool for keeping private notes about your
          professional and personal relationships, with optional connections
          to AI assistants you already use. By creating an account you agree to
          these terms and to the{" "}
          <Link href="/privacy" className="underline">Privacy Policy</Link>.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Your account</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>You must be old enough to enter a contract where you live.</li>
          <li>
            Sign-in is by a link emailed to you, so keep that inbox secure.
            Anyone who can read your email can sign in as you.
          </li>
          <li>
            A connector URL you create is a key to your account. Don&apos;t share
            it; revoke it in Settings if it leaks.
          </li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Your content</h2>
        <p>
          Everything you add stays yours. You give us only the permission
          needed to store it, show it back to you, and pass it to the AI
          assistant you connect, on your instruction. You are responsible for
          what you record — in particular for notes about other people, which
          should be accurate, fair and lawful where you are. Don&apos;t use the
          service to store anything you have no right to hold, to harass or
          surveil anyone, or to break the law.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">AI assistants</h2>
        <p>
          Claude, ChatGPT and similar assistants are separate products with
          their own terms, prices and privacy practices. We don&apos;t control
          what they say or do; the service gives them tools, and they decide
          how to use them. Review what your assistant writes into your notebook
          — every change it makes can be undone in the app.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Availability and changes</h2>
        <p>
          This is a young product. It is provided as it is, it may change, and
          it may occasionally be unavailable. We will try to give notice before
          removing anything important, and you can export your data at any time
          from Settings.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Ending things</h2>
        <p>
          You can delete your account whenever you like (Settings → Your
          data); that erases everything immediately and permanently. We may
          suspend or close accounts that abuse the service or these terms.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Liability</h2>
        <p>
          To the extent the law allows, we are not liable for indirect or
          consequential losses, or for decisions you make based on notes in the
          app, and our total liability is limited to what you have paid us for
          the service in the twelve months before a claim.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Contact</h2>
        <p>
          Questions about these terms
          {supportEmail ? (
            <>
              : <a className="underline" href={`mailto:${supportEmail}`}>{supportEmail}</a>.
            </>
          ) : (
            " — use the support link in the app."
          )}
        </p>
      </section>

      <p className="text-xs text-muted-foreground">
        <Link href="/privacy" className="underline">Privacy Policy</Link> ·{" "}
        <Link href="/signin" className="underline">Back to sign in</Link>
      </p>
    </main>
  );
}
