import { Session } from '../models/session.model';
import { Student } from '../models/student.model';
import { MAKEUP_SET_MAX, planMakeupSet } from './makeup-set';

const NOW = new Date('2026-10-05T12:00:00.000Z');
const day = (offset: number, minutes: number, hour = 14) => {
  const start = new Date(Date.UTC(2026, 9, 5 + offset, hour, 0, 0));
  return {
    start_datetime: start.toISOString(),
    end_datetime: new Date(start.getTime() + minutes * 60000).toISOString(),
  };
};
const pending = (offset: number, minutes: number): Session =>
  day(offset, minutes) as unknown as Session;
const earned = (daysAgo: number, minutes: number) => ({
  minutes,
  earned_date: new Date(NOW.getTime() - daysAgo * 86400000).toISOString(),
});
const student = (over: Partial<Student> = {}): Student =>
  ({ id: 's-1', name: 'Pat', make_up_minutes: 0, ...over }) as Student;

describe('planMakeupSet', () => {
  it('holds at most 60 make-ups', () => {
    expect(MAKEUP_SET_MAX).toBe(60);
  });

  it('accepts everything the minutes cover', () => {
    const plan = planMakeupSet(
      student({ make_up_batches: [earned(1, 60)] }),
      [],
      [day(1, 15), day(8, 15), day(15, 15), day(22, 15)],
      NOW,
    );
    expect(plan).toEqual({
      accepted: [0, 1, 2, 3],
      skipped: [],
      minutes_used: 60,
      minutes_left: 0,
    });
  });

  it('stops where the minutes run out', () => {
    const plan = planMakeupSet(
      student({ make_up_batches: [earned(1, 40)] }),
      [],
      [day(1, 15), day(8, 15), day(15, 15)],
      NOW,
    );
    expect(plan).toEqual({
      accepted: [0, 1],
      skipped: [{ index: 2, reason: 'insufficient' }],
      minutes_used: 30,
      minutes_left: 10,
    });
  });

  it('works through the dates in order, whatever order they were sent in', () => {
    const plan = planMakeupSet(
      student({ make_up_batches: [earned(1, 30)] }),
      [],
      [day(15, 15), day(1, 15), day(8, 15)],
      NOW,
    );
    // The latest date (index 0) is the one that does not fit.
    expect(plan.accepted).toEqual([1, 2]);
    expect(plan.skipped).toEqual([{ index: 0, reason: 'insufficient' }]);
  });

  it('lets a make-up that is already scheduled take its minutes first', () => {
    const plan = planMakeupSet(
      student({ make_up_batches: [earned(1, 60)] }),
      [pending(10, 45)],
      [day(1, 15), day(8, 15), day(15, 15)],
      NOW,
    );
    // 60 - 45 already scheduled = 15 left for the set, used by the earliest.
    expect(plan.accepted).toEqual([0]);
    expect(plan.skipped).toEqual([
      { index: 1, reason: 'insufficient' },
      { index: 2, reason: 'insufficient' },
    ]);
    expect(plan.minutes_used).toBe(15);
    expect(plan.minutes_left).toBe(0);
  });

  it('puts an already scheduled make-up ahead of a new one at the same time', () => {
    const plan = planMakeupSet(
      student({ make_up_batches: [earned(1, 30)] }),
      [pending(3, 30)],
      [day(3, 30)],
      NOW,
    );
    expect(plan.accepted).toEqual([]);
    expect(plan.skipped).toEqual([{ index: 0, reason: 'insufficient' }]);
  });

  it('skips a date after the minutes have expired, and says so', () => {
    // 60 minutes earned 80 days ago lapse in 10 days.
    const plan = planMakeupSet(
      student({ make_up_batches: [earned(80, 60)] }),
      [],
      [day(2, 15), day(9, 15), day(16, 15)],
      NOW,
    );
    expect(plan.accepted).toEqual([0, 1]);
    expect(plan.skipped).toEqual([{ index: 2, reason: 'expired' }]);
    expect(plan.minutes_used).toBe(30);
  });

  it('uses the oldest minutes first, so newer ones are left for later dates', () => {
    const plan = planMakeupSet(
      student({ make_up_batches: [earned(85, 30), earned(5, 30)] }),
      [],
      [day(1, 30), day(20, 30), day(40, 30)],
      NOW,
    );
    // Day 1 takes the old batch; day 20 takes the new one; nothing is left.
    expect(plan.accepted).toEqual([0, 1]);
    expect(plan.skipped).toEqual([{ index: 2, reason: 'insufficient' }]);
  });

  it('says "insufficient" when even the lapsed minutes would not have covered it', () => {
    const plan = planMakeupSet(
      student({ make_up_batches: [earned(89, 10)] }),
      [],
      [day(5, 60)],
      NOW,
    );
    expect(plan.skipped).toEqual([{ index: 0, reason: 'insufficient' }]);
  });

  it('counts a lapse only once across several skipped dates', () => {
    const plan = planMakeupSet(
      student({ make_up_batches: [earned(89, 20)] }),
      [],
      [day(5, 20), day(6, 20), day(7, 45)],
      NOW,
    );
    expect(plan.skipped).toEqual([
      { index: 0, reason: 'expired' },
      { index: 1, reason: 'expired' },
      { index: 2, reason: 'insufficient' },
    ]);
  });

  it('never expires minutes for a student marked never-expire', () => {
    const plan = planMakeupSet(
      student({
        make_up_never_expire: true,
        make_up_batches: [earned(200, 45)],
      }),
      [],
      [day(30, 15), day(60, 15), day(85, 15)],
      NOW,
    );
    expect(plan.accepted).toEqual([0, 1, 2]);
  });

  it('skips dates after the last day of service', () => {
    const plan = planMakeupSet(
      student({
        service_end_date: '2026-10-10',
        make_up_batches: [earned(1, 60)],
      }),
      [],
      [day(2, 15), day(9, 15)],
      NOW,
    );
    expect(plan.accepted).toEqual([0]);
    expect(plan.skipped).toEqual([{ index: 1, reason: 'after_service_end' }]);
    expect(plan.minutes_left).toBe(45);
  });

  it('treats a legacy balance without batches as earned today', () => {
    const plan = planMakeupSet(
      student({ make_up_minutes: 30 }),
      [],
      [day(1, 15), day(60, 15), day(95, 15)],
      NOW,
    );
    expect(plan.accepted).toEqual([0, 1]);
    expect(plan.skipped).toEqual([{ index: 2, reason: 'insufficient' }]);
  });

  it('ignores minutes that have already expired today', () => {
    const plan = planMakeupSet(
      student({ make_up_batches: [earned(120, 60), earned(1, 15)] }),
      [],
      [day(1, 15), day(2, 15)],
      NOW,
    );
    expect(plan.accepted).toEqual([0]);
    // The 60 older minutes would have covered it, had they not lapsed.
    expect(plan.skipped).toEqual([{ index: 1, reason: 'expired' }]);
    expect(plan.minutes_left).toBe(0);
  });

  it('never takes minutes a later, already scheduled make-up needs', () => {
    // 60 minutes; 45 are promised to a make-up in ten days. Only 15 are free,
    // even though the new dates come first.
    const plan = planMakeupSet(
      student({ make_up_batches: [earned(1, 60)] }),
      [pending(10, 45)],
      [day(1, 30)],
      NOW,
    );
    expect(plan.accepted).toEqual([]);
    expect(plan.skipped).toEqual([{ index: 0, reason: 'insufficient' }]);
  });

  it('still schedules what it can when the existing make-ups already exceed the minutes', () => {
    // Someone over-scheduled before: 90 pending against 60. A new set cannot
    // make that worse, and gets nothing.
    const plan = planMakeupSet(
      student({ make_up_batches: [earned(1, 60)] }),
      [pending(5, 45), pending(6, 45)],
      [day(1, 15)],
      NOW,
    );
    expect(plan.accepted).toEqual([]);
    expect(plan.minutes_left).toBe(0);
  });

  it('skips a proposal with no length', () => {
    const plan = planMakeupSet(
      student({ make_up_batches: [earned(1, 60)] }),
      [],
      [{ start_datetime: day(1, 0).start_datetime, end_datetime: 'nope' }],
      NOW,
    );
    expect(plan.accepted).toEqual([]);
    expect(plan.skipped).toEqual([{ index: 0, reason: 'insufficient' }]);
  });

  it('has nothing to schedule for a student without minutes', () => {
    const plan = planMakeupSet(student(), [], [day(1, 15)], NOW);
    expect(plan).toEqual({
      accepted: [],
      skipped: [{ index: 0, reason: 'insufficient' }],
      minutes_used: 0,
      minutes_left: 0,
    });
  });

  it('defaults to the current time', () => {
    const soon = new Date(Date.now() + 86400000);
    const plan = planMakeupSet(
      student({
        make_up_batches: [
          { minutes: 30, earned_date: new Date().toISOString() },
        ],
      }),
      [],
      [
        {
          start_datetime: soon.toISOString(),
          end_datetime: new Date(soon.getTime() + 30 * 60000).toISOString(),
        },
      ],
    );
    expect(plan.accepted).toEqual([0]);
  });
});
