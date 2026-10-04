import { Session } from '../models/session.model';
import { Student } from '../models/student.model';
import {
  availableMakeupMinutes,
  consumeMakeupMinutes,
  serviceEndInstant,
} from '../students/makeup-ledger';
import { sessionMinutes } from './attendance';

/**
 * Plans a set of make-up sessions against a student's make-up minutes (pure).
 *
 * A scheduled make-up does not leave the balance until attendance is taken,
 * and minutes expire 90 days after they were earned. So "does the balance
 * cover it today" is not enough for a set that runs for months: this walks
 * the minutes through time. Every pending make-up the student already has,
 * and each proposed one, takes the minutes that are still unexpired on ITS
 * date, oldest first. A proposed make-up that cannot be covered is skipped,
 * with the reason.
 */

/** A set may hold at most this many make-ups. */
export const MAKEUP_SET_MAX = 60;

export interface MakeupCandidate {
  start_datetime: string;
  end_datetime: string;
}

/**
 * Why a proposed make-up cannot be scheduled: the minutes are used up; they
 * exist today but lapse before that date; or the date is after the student's
 * last day of service.
 */
export type MakeupSkipReason = 'insufficient' | 'expired' | 'after_service_end';

export interface MakeupSetPlan {
  /** Indexes (into the candidates given) that the minutes cover. */
  accepted: number[];
  skipped: { index: number; reason: MakeupSkipReason }[];
  /** Minutes the accepted make-ups commit. */
  minutes_used: number;
  /** Left to schedule afterwards: today's balance less everything pending. */
  minutes_left: number;
}

interface Step {
  at: Date;
  minutes: number;
  /** Candidate index; undefined for a make-up that is already scheduled. */
  index?: number;
}

/**
 * Runs the steps through the ledger in date order (a make-up already
 * scheduled goes before a new one at the same instant). Returns the minutes
 * the already scheduled make-ups could NOT get, and whether every new step
 * was fully covered.
 */
function simulate(
  student: Student,
  steps: Step[],
  now: Date,
): { existingShortfall: number; newCovered: boolean } {
  const ordered = steps
    .map((step, order) => ({ step, order }))
    .sort(
      (a, b) =>
        a.step.at.getTime() - b.step.at.getTime() ||
        Number(a.step.index !== undefined) -
          Number(b.step.index !== undefined) ||
        a.order - b.order,
    )
    .map(({ step }) => step);
  // Taking nothing folds a legacy balance (no batches yet) into one batch
  // dated now and drops what has already expired.
  let ledger = consumeMakeupMinutes(student, 0, now).student;
  let existingShortfall = 0;
  let newCovered = true;
  for (const step of ordered) {
    const taken = consumeMakeupMinutes(ledger, step.minutes, step.at);
    ledger = taken.student;
    if (step.index === undefined) {
      existingShortfall += taken.unrecovered;
    } else if (taken.unrecovered > 0) {
      newCovered = false;
    }
  }
  return { existingShortfall, newCovered };
}

export function planMakeupSet(
  student: Student,
  existingPending: Session[],
  candidates: MakeupCandidate[],
  now: Date = new Date(),
): MakeupSetPlan {
  const existing: Step[] = existingPending.map((session) => ({
    at: new Date(session.start_datetime),
    minutes: sessionMinutes(session),
  }));
  const proposed: Step[] = candidates
    .map((candidate, index) => ({
      at: new Date(candidate.start_datetime),
      minutes: sessionMinutes(candidate as Session),
      index,
    }))
    .sort((a, b) => a.at.getTime() - b.at.getTime() || a.index - b.index);

  const serviceEnd = serviceEndInstant(student);
  // The same student if minutes never lapsed: tells "expired" from "used up".
  const unexpiring: Student = { ...student, make_up_never_expire: true };
  /**
   * A new make-up fits when it is fully covered and takes nothing from a
   * make-up that is already scheduled, on whatever date that one falls.
   */
  const fits = (who: Student, kept: Step[], step: Step): boolean => {
    const baseline = simulate(who, [...existing, ...kept], now);
    const withStep = simulate(who, [...existing, ...kept, step], now);
    return (
      withStep.newCovered &&
      withStep.existingShortfall <= baseline.existingShortfall
    );
  };

  const kept: Step[] = [];
  const skipped: MakeupSetPlan['skipped'] = [];
  for (const step of proposed) {
    if (serviceEnd && step.at.getTime() > serviceEnd.getTime()) {
      skipped.push({ index: step.index!, reason: 'after_service_end' });
    } else if (step.minutes > 0 && fits(student, kept, step)) {
      kept.push(step);
    } else {
      skipped.push({
        index: step.index!,
        reason:
          step.minutes > 0 && fits(unexpiring, kept, step)
            ? 'expired'
            : 'insufficient',
      });
    }
  }

  const minutesUsed = kept.reduce((sum, step) => sum + step.minutes, 0);
  const existingMinutes = existing.reduce((sum, step) => sum + step.minutes, 0);
  return {
    accepted: kept.map((step) => step.index!).sort((a, b) => a - b),
    skipped: skipped.sort((a, b) => a.index - b.index),
    minutes_used: minutesUsed,
    minutes_left: Math.max(
      0,
      availableMakeupMinutes(student, now) - existingMinutes - minutesUsed,
    ),
  };
}
