import type { Metadata } from "next";
import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SITE_DESCRIPTION, SITE_NAME, TAGLINE } from "@/lib/site";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: { absolute: "Personal CRM · Remember the people who matter" },
  description: SITE_DESCRIPTION,
  // Signed-out visitors see this page at `/` (next.config.ts rewrites it
  // there); this route's own path is an implementation detail. Open Graph
  // fields are inherited from the root layout on purpose: a page-level
  // `openGraph` would replace them wholesale and drop the image that
  // src/app/opengraph-image.tsx attaches there.
  alternates: { canonical: "/" },
};

const STEPS = [
  {
    title: "Sign in with a link",
    detail:
      "Enter your email and tap the link we send. No password, and the same link sets up your account.",
  },
  {
    title: "Connect Claude or ChatGPT",
    detail:
      "Five minutes, once. Create a connector URL in the app and paste it into your AI’s Connectors settings.",
  },
  {
    title: "Tell your AI about the people you meet",
    detail:
      "“Had coffee with Sam, she’s moving to Denver in March” lands here as a contact, a memory and a follow-up.",
  },
];

const FEATURES = [
  {
    title: "A follow-up inbox",
    detail: "Everything you said you’d do, due and overdue, grouped by person.",
  },
  {
    title: "Memories per contact",
    detail:
      "What you learned about someone, kept in your words and easy to find before you next talk.",
  },
  {
    title: "AI snapshots",
    detail: "A short, current summary of where things stand with each person.",
  },
  {
    title: "Message drafts in your voice",
    detail:
      "Ask for a draft and it sounds like you. Nothing is sent until you send it.",
  },
  {
    title: "Intro tracking",
    detail:
      "Who you introduced to whom, whether both sides said yes, and how it went.",
  },
];

/**
 * The public landing page. Visitors with no session cookie get it at `/`
 * (see the rewrite in next.config.ts); signed-in users never see it there.
 * Static on purpose: nothing here reads cookies, headers or the database,
 * so a share or a crawl costs nothing and the Open Graph tags come straight
 * from the prerender.
 */
export default function WelcomePage() {
  const supportEmail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL;

  return (
    <div className="min-h-svh pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
      <header className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
        <div className="flex items-center gap-2 font-semibold tracking-tight">
          <BrandMark />
          {SITE_NAME}
        </div>
        <Button
          variant="ghost"
          size="sm"
          nativeButton={false}
          render={<Link href="/signin" />}
        >
          Sign in
        </Button>
      </header>

      <main className="mx-auto max-w-2xl space-y-16 px-4 pt-10 pb-16 sm:pt-16">
        <section className="space-y-5">
          <Badge variant="secondary">Free while in beta</Badge>
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            {TAGLINE}
          </h1>
          <p className="max-w-prose text-lg text-muted-foreground">
            You talk to your AI. It keeps the notebook. The app shows you who
            to follow up with.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <Button
              size="lg"
              nativeButton={false}
              render={<Link href="/signin" />}
              className="px-4"
            >
              Get started
            </Button>
            <a
              href="#how-it-works"
              className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              How it works
            </a>
          </div>
        </section>

        <FollowUpPreview />

        <section id="how-it-works" className="scroll-mt-6 space-y-6">
          <h2 className="text-xl font-semibold tracking-tight">How it works</h2>
          <ol className="space-y-5">
            {STEPS.map((step, i) => (
              <li key={step.title} className="flex gap-4">
                <span
                  aria-hidden
                  className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium"
                >
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <p className="font-medium">{step.title}</p>
                  <p className="text-sm text-muted-foreground">{step.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="space-y-6">
          <h2 className="text-xl font-semibold tracking-tight">What you get</h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {FEATURES.map((feature) => (
              <li key={feature.title} className="rounded-xl border p-4">
                <p className="font-medium">{feature.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {feature.detail}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <Card>
          <CardHeader>
            <CardTitle>What you need</CardTitle>
            <CardDescription>
              Custom connectors need a paid plan: Claude Pro (or higher) or
              ChatGPT Plus. No AI connected? Everything also works by hand in
              the web app — add contacts, log what happened, tick off
              follow-ups.
            </CardDescription>
          </CardHeader>
        </Card>

        <section className="space-y-4 border-t pt-10">
          <h2 className="text-2xl font-semibold tracking-tight">
            Free while in beta.
          </h2>
          <p className="text-muted-foreground">
            Sign in with your email and you&apos;re in. No card, no password.
          </p>
          <Button
            size="lg"
            nativeButton={false}
            render={<Link href="/signin" />}
            className="px-4"
          >
            Get started
          </Button>
        </section>
      </main>

      <footer className="mx-auto flex max-w-2xl flex-wrap gap-x-4 gap-y-1 px-4 pb-8 text-xs text-muted-foreground">
        <Link href="/privacy" className="hover:text-foreground">
          Privacy
        </Link>
        <Link href="/terms" className="hover:text-foreground">
          Terms
        </Link>
        {supportEmail && (
          <a href={`mailto:${supportEmail}`} className="hover:text-foreground">
            Support
          </a>
        )}
      </footer>
    </div>
  );
}

const PREVIEW = [
  {
    name: "Sam Rivera",
    items: [
      {
        description: "Send Sam the Denver coffee list",
        reason: "She’s moving in March and asked for recommendations",
        due: "Due Thursday",
      },
    ],
  },
  {
    name: "Priya Natarajan",
    items: [
      {
        description: "Introduce Priya to Jordan at Northwind",
        reason: "Both said yes after the panel",
        due: "Due next Monday",
      },
    ],
  },
];

/**
 * A still of the Home follow-up card with made-up people, built from the
 * same pieces the real one uses. Decorative: hidden from assistive tech,
 * and nothing in it is interactive.
 */
function FollowUpPreview() {
  const fakeButton = (variant: "default" | "outline") =>
    cn(buttonVariants({ variant, size: "sm" }), "pointer-events-none");

  return (
    <div aria-hidden className="select-none">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Follow-ups
            <Badge variant="secondary">2 this week</Badge>
          </CardTitle>
          <CardDescription>
            The follow-through half of the job — everything you said you’d do.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Next 7 days
          </h3>
          {PREVIEW.map((group) => (
            <div key={group.name} className="rounded border p-3">
              <p className="text-sm font-medium">{group.name}</p>
              <ul className="mt-1 space-y-2">
                {group.items.map((item) => (
                  <li
                    key={item.description}
                    className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm">{item.description}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.reason}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {item.due}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <span className={fakeButton("outline")}>Draft message</span>
                      <span className={fakeButton("default")}>Done</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </CardContent>
      </Card>
      <p className="mt-2 text-center text-xs text-muted-foreground">
        Home, once your AI knows a few people.
      </p>
    </div>
  );
}
