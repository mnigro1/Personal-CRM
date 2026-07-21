import { notFound } from "next/navigation";
import { updateContactAction } from "@/app/actions";
import { ContactForm } from "@/components/contact-form";
import { repoFor } from "@/db/repo";
import { requireSession } from "@/lib/session";

export default async function EditContactPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { workspace } = await requireSession();
  const contact = await repoFor(workspace.id).getContact(id);
  if (!contact) notFound();

  const action = updateContactAction.bind(null, id);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">
        Edit {contact.preferredName ?? contact.firstName}
      </h1>
      <ContactForm action={action} contact={contact} submitLabel="Save changes" />
    </div>
  );
}
