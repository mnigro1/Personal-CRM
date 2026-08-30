import Link from "next/link";
import { createIntroAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { repoFor } from "@/db/repo";
import { requireSession } from "@/lib/session";

function nameOf(c: {
  firstName: string;
  lastName: string | null;
  preferredName: string | null;
  currentCompany: string | null;
}) {
  const name = `${c.preferredName ?? c.firstName} ${c.lastName ?? ""}`.trim();
  return c.currentCompany ? `${name} — ${c.currentCompany}` : name;
}

/** Log a new intro between two existing contacts. Both must already exist. */
export default async function NewIntroPage() {
  const { workspace } = await requireSession();
  const repo = repoFor(workspace.id);
  const contacts = await repo.listContacts();
  const sorted = [...contacts].sort((a, b) =>
    nameOf(a).localeCompare(nameOf(b)),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">New intro</h1>
        <Button size="sm" variant="outline" nativeButton={false} render={<Link href="/intros" />}>
          Cancel
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Connect two people</CardTitle>
          <CardDescription>
            Both people need to already be contacts. Opt-ins, sending, and
            the outcome get recorded separately once this exists.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={createIntroAction} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-medium">
                Person A
                <select
                  name="personA"
                  required
                  defaultValue=""
                  className="mt-1 w-full rounded border px-2 py-2 text-sm"
                >
                  <option value="" disabled>
                    Select…
                  </option>
                  {sorted.map((c) => (
                    <option key={c.id} value={c.id}>
                      {nameOf(c)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium">
                Person B
                <select
                  name="personB"
                  required
                  defaultValue=""
                  className="mt-1 w-full rounded border px-2 py-2 text-sm"
                >
                  <option value="" disabled>
                    Select…
                  </option>
                  {sorted.map((c) => (
                    <option key={c.id} value={c.id}>
                      {nameOf(c)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="block text-sm font-medium">
              Why are you connecting them?
              <Textarea
                name="reason"
                rows={3}
                required
                placeholder="e.g. Both exploring healthcare entrepreneurship — thought they'd get value from comparing notes."
                className="mt-1"
              />
            </label>

            <Button type="submit" size="sm">
              Create intro
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
