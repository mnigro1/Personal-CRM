import { createContactAction } from "@/app/actions";
import { ContactForm } from "@/components/contact-form";

export default function NewContactPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Add contact</h1>
      <ContactForm action={createContactAction} submitLabel="Create contact" />
    </div>
  );
}
