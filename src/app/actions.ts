"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { repoFor, type NewContact, type NewInteraction } from "@/db/repo";
import type { SentOutcome } from "@/db/repo-drafts";
import { CHANNELS, type Channel } from "@/lib/drafting";
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
  revalidatePath(`/contacts/${contactId}`);
  redirect(`/contacts/${contactId}`);
}

export async function deleteContactAction(contactId: string) {
  const { workspace } = await requireSession();
  await repoFor(workspace.id).softDeleteContact(contactId);
  revalidatePath("/");
  redirect("/contacts");
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
    extractionStatus:
      formData.get("skipExtraction") === "on" ? "skipped" : "pending",
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

/**
 * THE completion path — every Done in the app lands here (spec §1). One
 * required question: what actually happened? Only "as_written" on a written
 * draft, or text the user pasted themselves, ever reaches
 * interactions.raw_source (immutable Layer 1). Everything else completes the
 * follow-up and logs nothing.
 */
export async function resolveFollowUpAction(
  opts: {
    draftId: string | null;
    followUpId: string | null;
    contactId: string;
    returnTo: string;
  },
  formData: FormData,
) {
  const { workspace } = await requireSession();
  const repo = repoFor(workspace.id);

  const kind = str(formData, "outcome");
  if (kind !== "as_written" && kind !== "different" && kind !== "other_channel") {
    throw new Error("Tell us what happened");
  }

  if (opts.draftId) {
    // markDraftSent owns the whole close: the Layer 1 decision, the draft's
    // final status, and completing its follow-up.
    const outcome: SentOutcome =
      kind === "different"
        ? { kind, text: str(formData, "sentText") }
        : { kind };
    const result = await repo.markDraftSent(opts.draftId, outcome);
    if (!result) throw new Error("Draft not found");
  } else {
    if (!opts.followUpId) throw new Error("Nothing to complete");
    // No draft ever existed, so "as written" has nothing to describe.
    if (kind === "as_written") {
      throw new Error("No draft exists to have been sent as written");
    }
    const text = kind === "different" ? str(formData, "sentText") : null;
    if (text) {
      // Channel unknown here — the user sent it on their own. "other" is
      // honest; outbound text skips the extraction queue like all sends.
      await repo.createInteraction({
        type: "other",
        occurredAt: new Date(),
        rawSource: text,
        sourceType: "manual_note",
        extractionStatus: "skipped",
        contactIds: [opts.contactId],
      });
    }
    await repo.completeFollowUp(opts.followUpId);
  }

  revalidatePath("/");
  revalidatePath(`/contacts/${opts.contactId}`);
  // Stay where the user was. Relative paths only — never off-site.
  redirect(
    opts.returnTo.startsWith("/") && !opts.returnTo.startsWith("//")
      ? opts.returnTo
      : `/contacts/${opts.contactId}`,
  );
}

// ----------------------------------------------------------------- extraction

/** Parse the review-screen form into the Selections shape. */
function selectionsFromForm(formData: FormData) {
  const indices = (prefix: string) =>
    [...formData.keys()]
      .filter((k) => k.startsWith(`${prefix}-`) && !k.includes("-edit-"))
      .map((k) => Number(k.slice(prefix.length + 1)))
      .filter((n) => Number.isInteger(n));

  const bindingResolutions: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("bind::") && typeof value === "string" && value) {
      bindingResolutions[key.slice("bind::".length)] = value;
    }
  }

  const editRecord = (section: string, fields: string[]) => {
    const out: Record<string, Record<string, string>> = {};
    for (const field of fields) {
      for (const [key, value] of formData.entries()) {
        const prefix = `${section}-edit-${field}-`;
        if (key.startsWith(prefix) && typeof value === "string" && value.trim()) {
          const idx = key.slice(prefix.length);
          out[idx] = { ...out[idx], [field]: value.trim() };
        }
      }
    }
    return out;
  };

  return {
    binding_resolutions: bindingResolutions,
    interaction_meta: formData.get("meta") === "on",
    new_memories: indices("nm"),
    supersessions: indices("sup"),
    already_known: indices("ak"),
    tags: indices("tag"),
    follow_ups: indices("fu"),
    contact_field_updates: indices("cfu"),
    edits: {
      new_memories: editRecord("nm", ["text", "category"]),
      follow_ups: editRecord("fu", ["description"]),
    },
  };
}

export async function applyExtractionAction(
  extractionId: string,
  formData: FormData,
) {
  const { user, workspace } = await requireSession();
  const repo = repoFor(workspace.id);
  const found = await repo.getExtraction(extractionId);
  if (!found) throw new Error("Extraction not found");

  let result;
  try {
    result = await repo.applyExtraction(
      extractionId,
      selectionsFromForm(formData),
      user.id,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Apply failed";
    redirect(`/review/${extractionId}?error=${encodeURIComponent(message)}`);
  }
  revalidatePath("/");
  redirect(
    `/interactions/${found.interaction.id}?applied=${result.batchId}`,
  );
}

export async function undoBatchAction(
  batchId: string,
  interactionId: string,
) {
  const { user, workspace } = await requireSession();
  const result = await repoFor(workspace.id).undoBatch(batchId, user.id);
  revalidatePath("/");
  redirect(
    `/interactions/${interactionId}?undone=${result.reverted}&skipped=${result.skipped}`,
  );
}

export async function reRunExtractionAction(interactionId: string) {
  const { workspace } = await requireSession();
  await repoFor(workspace.id).reRunExtraction(interactionId);
  revalidatePath(`/interactions/${interactionId}`);
  revalidatePath("/review");
  redirect(`/interactions/${interactionId}?rerun=1`);
}

// ------------------------------------------------------------------- settings

export async function createInviteAction(formData: FormData) {
  const { user, workspace } = await requireSession();
  const email = str(formData, "email");
  if (!email) throw new Error("Email is required");
  await repoFor(workspace.id).createInvite(email, user.id);
  revalidatePath("/settings");
}

export async function createMcpTokenAction(formData: FormData) {
  const { user } = await requireSession();
  const { createMcpToken } = await import("@/db/tokens");
  const label = str(formData, "label") ?? "My AI";
  const token = await createMcpToken(user.id, label);
  revalidatePath("/settings");
  // The token is shown once, as part of the connector URL it belongs in.
  redirect(`/settings?newToken=${encodeURIComponent(token)}`);
}

export async function revokeMcpTokenAction(tokenId: string) {
  const { user } = await requireSession();
  const { revokeMcpToken } = await import("@/db/tokens");
  await revokeMcpToken(user.id, tokenId);
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

// ------------------------------------------------------------------- drafting

export async function createDraftAction(
  contactId: string,
  followUpId: string | null,
  formData: FormData,
) {
  const { workspace } = await requireSession();
  const channel = str(formData, "channel");
  if (!channel || !CHANNELS.includes(channel as Channel)) {
    throw new Error("Pick a channel");
  }
  const draft = await repoFor(workspace.id).createDraft({
    contactId,
    followUpId,
    channel: channel as Channel,
    channelLabel: str(formData, "channelLabel"),
    createdBy: "user",
  });
  revalidatePath("/");
  revalidatePath(`/contacts/${contactId}`);
  redirect(`/drafts/${draft.id}`);
}

/**
 * Autosave from the editor. Deliberately does not revalidate or redirect —
 * it fires on debounce/blur while typing, and it must never advance status.
 * Returns false when the write matched nothing (draft no longer editable),
 * so the editor can warn instead of lying "Saved".
 */
export async function saveDraftTextAction(
  draftId: string,
  body: string,
  subject: string | null,
): Promise<boolean> {
  const { workspace } = await requireSession();
  const row = await repoFor(workspace.id).updateDraftText(draftId, {
    body,
    subject,
  });
  return row !== null;
}

export async function regenerateDraftAction(
  draftId: string,
  formData: FormData,
) {
  const { workspace } = await requireSession();
  await repoFor(workspace.id).regenerateDraft(draftId, str(formData, "instruction"));
  revalidatePath(`/drafts/${draftId}`);
}

export async function discardDraftAction(draftId: string) {
  const { workspace } = await requireSession();
  const repo = repoFor(workspace.id);
  const row = await repo.getDraft(draftId);
  await repo.discardDraft(draftId);
  revalidatePath("/");
  if (row) redirect(`/contacts/${row.contact.id}`);
  redirect("/");
}

