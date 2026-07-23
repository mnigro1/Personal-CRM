import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { contacts } from "@/db/schema";

type Contact = typeof contacts.$inferSelect;

export function ContactForm({
  action,
  contact,
  submitLabel,
  hiddenFields,
}: {
  action: (formData: FormData) => Promise<void>;
  contact?: Partial<Contact>;
  submitLabel: string;
  /** Carried through the duplicate-confirmation round trip. */
  hiddenFields?: Record<string, string>;
}) {
  const field = (
    name: string,
    label: string,
    defaultValue?: string | null,
    type = "text",
  ) => (
    <div className="space-y-1">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} type={type} defaultValue={defaultValue ?? ""} />
    </div>
  );

  return (
    <form action={action} className="max-w-2xl space-y-4">
      {Object.entries(hiddenFields ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="firstName">First name *</Label>
          <Input id="firstName" name="firstName" required defaultValue={contact?.firstName ?? ""} />
        </div>
        {field("lastName", "Last name", contact?.lastName)}
        {field("preferredName", "Preferred name", contact?.preferredName)}
        {field("emails", "Emails (comma-separated)", contact?.emails?.join(", "))}
        {field("phone", "Phone", contact?.phone)}
        {field("currentCompany", "Company", contact?.currentCompany)}
        {field("currentRole", "Role", contact?.currentRole)}
        {field("location", "Location", contact?.location)}
        {field("linkedinUrl", "LinkedIn URL", contact?.linkedinUrl)}
        {field("website", "Website", contact?.website)}
        {field("dateFirstMet", "Date first met", contact?.dateFirstMet, "date")}
        {field("relationshipCategory", "Relationship category", contact?.relationshipCategory)}
      </div>
      <div className="space-y-1">
        <Label htmlFor="howWeMet">How we met</Label>
        <Textarea id="howWeMet" name="howWeMet" defaultValue={contact?.howWeMet ?? ""} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" name="notes" defaultValue={contact?.notes ?? ""} />
      </div>
      <Button type="submit">{submitLabel}</Button>
    </form>
  );
}
