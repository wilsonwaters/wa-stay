/**
 * The words for a `credentials` account's saved details (a member number), shared by Settings
 * → Accounts and the "Copy {label}" buttons beside a provider's booking and payment links. A
 * label is the provider's (`AccountFieldDescriptor.label`); nothing here ever has a value.
 */
import type { AccountFieldDescriptor } from '../../../shared/types/provider.types';

/** A label inside a sentence: "Member number" → "member number"; "RAC number" is kept. */
export function inSentence(label: string): string {
  return /^[A-Z][a-z]/.test(label) ? label.charAt(0).toLowerCase() + label.slice(1) : label;
}

/** A label at the start of a sentence: "member number" → "Member number". */
export function atStart(label: string): string {
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** "Copy RAC member number", "Copy member number": a button's whole name, never a value. */
export function copyCredentialLabel(field: Pick<AccountFieldDescriptor, 'label'>): string {
  return `Copy ${inSentence(field.label)}`;
}

/** Announced once a copy is on the clipboard: "RAC member number copied". */
export function credentialCopiedAnnouncement(field: Pick<AccountFieldDescriptor, 'label'>): string {
  return `${atStart(field.label)} copied`;
}

/** When main gives no reason for a failed copy. */
export const COPY_FAILED = "Couldn't copy it. Try again.";
