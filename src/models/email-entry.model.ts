/**
 * One parsed inbound email (Email-to-Contact pipeline).
 *
 * Written by the infra repo's parser Lambda; this service only reads and
 * moderates (assign/discard). `id` is a content hash of the ORIGINAL email
 * (normalized subject + sender + date-to-minute + body fingerprint), so a
 * re-forwarded email dedups by construction — which is also why discard
 * keeps the row: the resident hash stops discarded content resurfacing.
 * A conversation hashes its whole text, so a longer re-forward is a new entry.
 */
export class EmailEntry {
  id?: string;
  /** matched = filed on a contact; unmatched = awaiting admin review. */
  status?: 'matched' | 'unmatched' | 'discarded';
  contact_id?: string;
  /** The ORIGINAL (parent) sender, parsed out of the forward. */
  from_email?: string;
  from_name?: string;
  subject?: string;
  /** When the parent sent the original (ISO); absent when unparseable. */
  sent_at?: string;
  /** When the pipeline received the forward (ISO). */
  received_at?: string;
  /**
   * A single email: the newest message with the quoted history stripped.
   * A conversation: every message, oldest first, under sender/date lines.
   */
  body_text?: string;
  /** Raw MIME object in the inbound bucket — the "view original" target. */
  s3_key?: string;
  /** The admin inbox that forwarded it to the pipeline. */
  forwarded_by?: string;
  /** How the original was recovered: rfc822 attachment, inline heuristics, or not. */
  match_method?: 'rfc822' | 'inline' | 'none';
  assigned_by?: string;
  assigned_at?: string;
  created_at?: string;
  /** True when the forward held a conversation (more than one message). */
  is_thread?: boolean;
  message_count?: number;
  /** Everyone found in the conversation's From/To/Cc lines. */
  participants?: EmailParticipant[];
}

export class EmailParticipant {
  email: string;
  name?: string;
}
