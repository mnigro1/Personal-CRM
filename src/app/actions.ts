"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { repoFor, type NewContact, type NewInteraction } from "@/db/repo";
import { requireSession } from "@/lib/session";

function str(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed === "" ? null : trimmed;
}

function contactFromForm(formData: FormData): NewContact {
  const firstName = str(formData, "firstName");
  if (!firstName) throw new Error("First name is required");
  return {
    firstName,
    lastName: str(formData, "lastName"),
    preferredName: str(formData, "preferredName"),
    emails: (str(formData, "emails") ?? "")
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean),
    phone: str(formData, "phone"),
    currentCompany: str(formData, "currentCompany"),
    currentRole: str(formData, "currentRole"),
    location: str(formData, "location"),
    linkedinUrl: str(formData, "linkedinUrl"),
    website: str(formData, "website"),
    howWeMet: str(formData, "howWeMet"),
    dateFirstMet: str(formData, "dateFirstMet"),
    relationshipCategory: str(formData, "relationshipCategory"),
    notes: str(formData, "notes"),
  };
}

// ------------------------------------------------------------------- contacts

export async function createContactAction(formData: FormData) {
  const { workspace } = await requireSession();
  const repo = repoFor(workspace.id);
  const contact = await repo.createContact(contactFromForm(formData));
  const tagsCsv = str(formData, "tags");
  if (tagsCsv) {
    await repo.setContactTags(contact.id, tagsCsv.split(","));
  }
  revalidatePath("/");
  redirect(`/contacts/${contact.id}`);
}

export async function updateContactAction(
  contactId: string,
  formData: FormData,
) {
  const { workspace } = await requireSession();
  const repo = repoFor(workspace.id);
  await repo.updateContact(contactId, contactFromForm(formData));
  const tagsCsv = formData.get("tags");
  if (typeof tagsCsv === "string") {
    await repo.setContactTags(
      contactId,
      tagsCsv.split(",").filter((t) => t.trim()),
    );
  }
  revalidatePath(`/contacts/${contactId}`);
  redirect(`/contacts/${contactId}`);
}

export async function deleteContactAction(contactId: string) {
  const { workspace } = await requireSession();
  await repoFor(workspace.id).softDeleteContact(contactId);
  revalidatePath("/");
  redirect("/");
}

// --------------------------------------------------------------- interactions

export async function createInteractionAction(formData: FormData) {
  const { workspace } = await requireSession();
  const repo = repoFor(workspace.id);

  const rawSource = str(formData, "rawSource");
  if (!rawSource) throw new Error("Notes are required");
  const contactIds = formData.getAll("contactIds").map(String).filter(Boolean);
  const occurredAtRaw = str(formData, "occurredAt");

  const result = await repo.createInteraction({
    type: (str(formData, "type") ?? "other") as NewInteraction["type"],
    occurredAt: occurredAtRaw ? new Date(occurredAtRaw) : new Date(),
    location: str(formData, "location"),
    rawSource,
    sourceType: (str(formData, "sourceType") ??
      "manual_note") as NewInteraction["sourceType"],
    contactIds,
  });

  revalidatePath("/");
  if (result.duplicate) {
    redirect(`/interactions/${result.interaction.id}?duplicate=1`);
  }
  redirect(`/interactions/${result.interaction.id}`);
}

export async function updateInteractionAction(
  interactionId: string,
  formData: FormData,
) {
  const { workspace } = await requireSession();
  const repo = repoFor(workspace.id);
  const occurredAtRaw = str(formData, "occurredAt");
  await repo.updateInteractionMeta(interactionId, {
    type: (str(formData, "type") ?? "other") as NewInteraction["type"],
    occurredAt: occurredAtRaw ? new Date(occurredAtRaw) : undefined,
    location: str(formData, "location"),
    contactIds: formData.getAll("contactIds").map(String).filter(Boolean),
  });
  revalidatePath(`/interactions/${interactionId}`);
  redirect(`/interactions/${interactionId}`);
}

export async function deleteInteractionAction(interactionId: string) {
  const { workspace } = await requireSession();
  await repoFor(workspace.id).deleteInteraction(interactionId);
  revalidatePath("/");
  redirect("/interactions");
}

// ------------------------------------------------------------------- memories

export async function addMemoryAction(contactId: string, formData: FormData) {
  const { workspace } = await requireSession();
  const text = str(formData, "text");
  if (!text) throw new Error("Memory text is required");
  await repoFor(workspace.id).addMemory({
    contactId,
    text,
    category: (str(formData, "category") ?? "other") as never,
    eventDate: str(formData, "eventDate"),
    eventDatePrecision: (str(formData, "eventDatePrecision") ?? "none") as never,
  });
  revalidatePath(`/contacts/${contactId}`);
}

export async function deleteMemoryAction(contactId: string, memoryId: string) {
  const { workspace } = await requireSession();
  await repoFor(workspace.id).deleteMemory(memoryId);
  revalidatePath(`/contacts/${contactId}`);
}

// ----------------------------------------------------------------- follow-ups

export async function addFollowUpAction(contactId: string, formData: FormData) {
  const { workspace } = await requireSession();
  const description = str(formData, "description");
  if (!description) throw new Error("Description is required");
  await repoFor(workspace.id).addFollowUp({
    contactId,
    description,
    reason: str(formData, "reason") ?? "Added manually",
    dueDate: str(formData, "dueDate"),
    priority: (str(formData, "priority") ?? "medium") as never,
  });
  revalidatePath(`/contacts/${contactId}`);
}

export async function completeFollowUpAction(
  contactId: string,
  followUpId: string,
) {
  const { workspace } = await requireSession();
  await repoFor(workspace.id).completeFollowUp(followUpId);
  revalidatePath(`/contacts/${contactId}`);
}

// ----------------------------------------------------------------------- tags

export async function mergeTagsAction(formData: FormData) {
  const { workspace } = await requireSession();
  const sourceTagId = str(formData, "sourceTagId");
  const targetTagId = str(formData, "targetTagId");
  if (!sourceTagId || !targetTagId)
    throw new Error("Both source and target tags are required");
  await repoFor(workspace.id).mergeTags(sourceTagId, targetTagId);
  revalidatePath("/tags");
}

// ------------------------------------------------------------------- settings

export async function createInviteAction(formData: FormData) {
  const { user, workspace } = await requireSession();
  const email = str(formData, "email");
  if (!email) throw new Error("Email is required");
  await repoFor(workspace.id).createInvite(email, user.id);
  revalidatePath("/settings");
}

export async function updateTimezoneAction(formData: FormData) {
  const { user } = await requireSession();
  const timezone = str(formData, "timezone");
  if (!timezone) throw new Error("Timezone is required");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    throw new Error(`Invalid IANA timezone: ${timezone}`);
  }
  await db.update(users).set({ timezone }).where(eq(users.id, user.id));
  revalidatePath("/settings");
}
