import { Student } from '../models/student.model';

/**
 * The fields a roster row needs (name, family, tutor, status, package,
 * schedule, scholarship mark, make-up balance), and nothing else: no
 * prices, discounts, pending changes or package history. Used for the Head
 * Tutor's organization-wide roster (client 2026-11-09).
 */
export const ROSTER_FIELDS = [
  'id',
  'contact_id',
  'name',
  'status',
  'package',
  'assigned_tutor_id',
  'schedule',
  'scholarship',
  'make_up_minutes',
  'make_up_batches',
  'make_up_never_expire',
] as const;

export function rosterProjection(student: Student): Student {
  const source = student as unknown as Record<string, unknown> & {
    toJSON?: () => Record<string, unknown>;
  };
  const plain =
    typeof source.toJSON === 'function' ? source.toJSON() : { ...source };
  const projected: Record<string, unknown> = {};
  for (const field of ROSTER_FIELDS) {
    if (plain[field] !== undefined) projected[field] = plain[field];
  }
  return projected as unknown as Student;
}
