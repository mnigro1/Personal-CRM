import { mergeTagsAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { repoFor } from "@/db/repo";
import { requireSession } from "@/lib/session";

export default async function TagsPage() {
  const { workspace } = await requireSession();
  const allTags = await repoFor(workspace.id).listTags();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Tags</h1>

      <Card>
        <CardHeader>
          <CardTitle>All tags</CardTitle>
        </CardHeader>
        <CardContent>
          {allTags.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No tags yet — add them from a contact.
            </p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {allTags.map((t) => (
                <li key={t.id} className="rounded-full border px-3 py-1 text-sm">
                  {t.name}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {allTags.length >= 2 && (
        <Card>
          <CardHeader>
            <CardTitle>Merge tags</CardTitle>
            <CardDescription>
              Merging moves every contact from the first tag onto the second and
              retires the first. Old references resolve to the target instead of
              coming back.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={mergeTagsAction} className="flex items-end gap-3">
              <label className="space-y-1 text-sm">
                <span>Merge</span>
                <select name="sourceTagId" className="block rounded border px-2 py-2 text-sm" required>
                  {allTags.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span>into</span>
                <select name="targetTagId" className="block rounded border px-2 py-2 text-sm" required>
                  {allTags.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </label>
              <Button type="submit" size="sm">Merge</Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
