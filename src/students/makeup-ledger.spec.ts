import { Student } from '../models/student.model';
import {
  availableMakeupMinutes,
  bankMakeupMinutes,
  consumeMakeupMinutes,
  isExpired,
  MAKEUP_EXPIRY_DAYS,
  serviceEndInstant,
  unbankMakeupMinutes,
} from './makeup-ledger';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-07-01T00:00:00.000Z');
const daysAgo = (n: number): string =>
  new Date(NOW.getTime() - n * DAY).toISOString();
const student = (over: Partial<Student> = {}): Student =>
  ({ id: 's-1', make_up_minutes: 0, ...over }) as Student;
const batches = (s: Student) =>
  (s.make_up_batches ?? []).map((b) => [b.minutes, b.earned_date]);

describe('make-up ledger', () => {
  it('expires minutes after 90 days', () => {
    expect(MAKEUP_EXPIRY_DAYS).toBe(90);
    const s = student();
    expect(isExpired({ minutes: 1, earned_date: daysAgo(89) }, s, NOW)).toBe(
      false,
    );
    expect(isExpired({ minutes: 1, earned_date: daysAgo(90) }, s, NOW)).toBe(
      true,
    );
    expect(isExpired({ minutes: 1, earned_date: daysAgo(91) }, s, NOW)).toBe(
      true,
    );
    expect(
      isExpired(
        { minutes: 1, earned_date: daysAgo(400) },
        student({ make_up_never_expire: true }),
        NOW,
      ),
    ).toBe(false);
  });

  describe('serviceEndInstant', () => {
    it('is the last millisecond of the last Eastern day', () => {
      expect(
        serviceEndInstant(student({ service_end_date: '2026-07-10' })),
      ).toEqual(new Date('2026-07-11T03:59:59.999Z'));
      // Winter: Eastern standard time.
      expect(
        serviceEndInstant(student({ service_end_date: '2026-12-31T00:00:00' })),
      ).toEqual(new Date('2027-01-01T04:59:59.999Z'));
    });

    it('is null without a usable end date', () => {
      expect(serviceEndInstant(student())).toBeNull();
      expect(serviceEndInstant(student({ service_end_date: null }))).toBeNull();
      expect(
        serviceEndInstant(student({ service_end_date: 'soon-enough' })),
      ).toBeNull();
      expect(
        serviceEndInstant(student({ service_end_date: '2026-07' })),
      ).toBeNull();
    });
  });

  describe('availableMakeupMinutes', () => {
    it('sums unexpired batches', () => {
      expect(
        availableMakeupMinutes(
          student({
            make_up_batches: [
              { minutes: 30, earned_date: daysAgo(10) },
              { minutes: 45, earned_date: daysAgo(89) },
              { minutes: 60, earned_date: daysAgo(90) },
            ],
          }),
          NOW,
        ),
      ).toBe(75);
    });

    it('falls back to the legacy scalar without batches', () => {
      expect(
        availableMakeupMinutes(student({ make_up_minutes: 120 }), NOW),
      ).toBe(120);
      expect(
        availableMakeupMinutes(
          student({ make_up_minutes: 120, make_up_batches: [] }),
          NOW,
        ),
      ).toBe(120);
      expect(
        availableMakeupMinutes(
          student({ make_up_minutes: undefined as unknown as number }),
          NOW,
        ),
      ).toBe(0);
    });

    it('is zero once service has ended, exempt or not', () => {
      const ended = {
        service_end_date: '2026-06-20',
        make_up_batches: [{ minutes: 45, earned_date: daysAgo(5) }],
      };
      expect(availableMakeupMinutes(student(ended), NOW)).toBe(0);
      expect(
        availableMakeupMinutes(
          student({ ...ended, make_up_never_expire: true }),
          NOW,
        ),
      ).toBe(0);
      expect(
        availableMakeupMinutes(
          student({ service_end_date: '2026-06-20', make_up_minutes: 60 }),
          NOW,
        ),
      ).toBe(0);
      // Still in service on the last day.
      expect(
        availableMakeupMinutes(
          student({ ...ended, service_end_date: '2026-07-01' }),
          NOW,
        ),
      ).toBe(45);
    });

    it('defaults to the current time', () => {
      expect(
        availableMakeupMinutes(
          student({
            make_up_batches: [
              { minutes: 30, earned_date: new Date().toISOString() },
            ],
          }),
        ),
      ).toBe(30);
    });
  });

  describe('bankMakeupMinutes', () => {
    it('adds a dated batch, drops expired ones and refreshes the snapshot', () => {
      const before = student({
        make_up_minutes: 999,
        make_up_batches: [
          { minutes: 30, earned_date: daysAgo(100) },
          { minutes: 45, earned_date: daysAgo(10) },
        ],
      });
      const after = bankMakeupMinutes(before, 60, daysAgo(1), NOW);
      expect(batches(after)).toEqual([
        [45, daysAgo(10)],
        [60, daysAgo(1)],
      ]);
      expect(after.make_up_minutes).toBe(105);
      // The input is never mutated.
      expect(before.make_up_batches).toHaveLength(2);
      expect(before.make_up_minutes).toBe(999);
    });

    it('folds a legacy scalar into a batch so it is not lost', () => {
      const after = bankMakeupMinutes(
        student({ make_up_minutes: 120 }),
        60,
        daysAgo(1),
        NOW,
      );
      expect(batches(after)).toEqual([
        [120, NOW.toISOString()],
        [60, daysAgo(1)],
      ]);
      expect(after.make_up_minutes).toBe(180);
    });

    it('ignores malformed stored batches', () => {
      const after = bankMakeupMinutes(
        student({
          make_up_batches: [
            null as never,
            { minutes: '5' as unknown as number, earned_date: daysAgo(1) },
            { minutes: 5, earned_date: '' },
            { minutes: 20, earned_date: daysAgo(3) },
          ],
        }),
        60,
        daysAgo(1),
        NOW,
      );
      expect(after.make_up_minutes).toBe(80);
    });
  });

  describe('consumeMakeupMinutes', () => {
    const three = () =>
      student({
        make_up_batches: [
          { minutes: 60, earned_date: daysAgo(5) },
          { minutes: 30, earned_date: daysAgo(50) },
          { minutes: 45, earned_date: daysAgo(20) },
        ],
      });

    it('takes the oldest minutes first', () => {
      const { student: after, unrecovered } = consumeMakeupMinutes(
        three(),
        40,
        NOW,
      );
      expect(batches(after)).toEqual([
        [35, daysAgo(20)],
        [60, daysAgo(5)],
      ]);
      expect(after.make_up_minutes).toBe(95);
      expect(unrecovered).toBe(0);
    });

    it('drops a batch that is used up exactly', () => {
      const { student: after } = consumeMakeupMinutes(three(), 30, NOW);
      expect(batches(after)).toEqual([
        [45, daysAgo(20)],
        [60, daysAgo(5)],
      ]);
    });

    it('never goes below zero and reports the shortfall', () => {
      const { student: after, unrecovered } = consumeMakeupMinutes(
        three(),
        200,
        NOW,
      );
      expect(after.make_up_batches).toEqual([]);
      expect(after.make_up_minutes).toBe(0);
      expect(unrecovered).toBe(65);
    });

    it('never draws on expired minutes', () => {
      const { student: after, unrecovered } = consumeMakeupMinutes(
        student({
          make_up_batches: [
            { minutes: 100, earned_date: daysAgo(95) },
            { minutes: 20, earned_date: daysAgo(5) },
          ],
        }),
        30,
        NOW,
      );
      expect(after.make_up_minutes).toBe(0);
      expect(unrecovered).toBe(10);
    });

    it('taking nothing changes nothing', () => {
      const { student: after, unrecovered } = consumeMakeupMinutes(
        three(),
        0,
        NOW,
      );
      expect(after.make_up_minutes).toBe(135);
      expect(unrecovered).toBe(0);
    });
  });

  describe('unbankMakeupMinutes', () => {
    const SESSION = daysAgo(10);

    it('removes the untouched batch of that session', () => {
      const { student: after, unrecovered } = unbankMakeupMinutes(
        student({
          make_up_batches: [
            { minutes: 30, earned_date: daysAgo(40) },
            { minutes: 60, earned_date: SESSION },
          ],
        }),
        60,
        SESSION,
        NOW,
      );
      expect(batches(after)).toEqual([[30, daysAgo(40)]]);
      expect(after.make_up_minutes).toBe(30);
      expect(unrecovered).toBe(0);
    });

    it('matches the batch by instant, whatever the timestamp format', () => {
      const { student: after } = unbankMakeupMinutes(
        student({
          make_up_batches: [
            { minutes: 60, earned_date: '2026-06-21T00:00:00Z' },
          ],
        }),
        60,
        '2026-06-21T00:00:00.000Z',
        NOW,
      );
      expect(after.make_up_batches).toEqual([]);
    });

    it('takes used minutes from the other batches, oldest first', () => {
      // 40 of the session's 60 minutes were already used.
      const { student: after, unrecovered } = unbankMakeupMinutes(
        student({
          make_up_batches: [
            { minutes: 20, earned_date: SESSION },
            { minutes: 45, earned_date: daysAgo(5) },
            { minutes: 30, earned_date: daysAgo(30) },
          ],
        }),
        60,
        SESSION,
        NOW,
      );
      // 20 from its own batch, 30 + 10 from the others.
      expect(batches(after)).toEqual([[35, daysAgo(5)]]);
      expect(unrecovered).toBe(0);
    });

    it('takes everything from the others when the batch is fully used', () => {
      const { student: after, unrecovered } = unbankMakeupMinutes(
        student({
          make_up_batches: [{ minutes: 100, earned_date: daysAgo(5) }],
        }),
        60,
        SESSION,
        NOW,
      );
      expect(batches(after)).toEqual([[40, daysAgo(5)]]);
      expect(unrecovered).toBe(0);
    });

    it('never goes below zero and reports what it could not take back', () => {
      const { student: after, unrecovered } = unbankMakeupMinutes(
        student({
          make_up_batches: [
            { minutes: 10, earned_date: SESSION },
            { minutes: 15, earned_date: daysAgo(5) },
          ],
        }),
        60,
        SESSION,
        NOW,
      );
      expect(after.make_up_batches).toEqual([]);
      expect(after.make_up_minutes).toBe(0);
      expect(unrecovered).toBe(35);
    });

    it('leaves the other minutes alone when the session minutes had lapsed', () => {
      const old = daysAgo(120);
      const lapsed = unbankMakeupMinutes(
        student({
          make_up_batches: [
            { minutes: 60, earned_date: old },
            { minutes: 45, earned_date: daysAgo(5) },
          ],
        }),
        60,
        old,
        NOW,
      );
      expect(batches(lapsed.student)).toEqual([[45, daysAgo(5)]]);
      expect(lapsed.unrecovered).toBe(0);
      // Already pruned away: still nothing else is touched.
      const pruned = unbankMakeupMinutes(
        student({
          make_up_batches: [{ minutes: 45, earned_date: daysAgo(5) }],
        }),
        60,
        old,
        NOW,
      );
      expect(pruned.student.make_up_minutes).toBe(45);
      expect(pruned.unrecovered).toBe(0);
    });

    it('an exempt student has no lapse: used minutes are always taken back', () => {
      const old = daysAgo(120);
      const { student: after, unrecovered } = unbankMakeupMinutes(
        student({
          make_up_never_expire: true,
          make_up_batches: [{ minutes: 45, earned_date: daysAgo(200) }],
        }),
        60,
        old,
        NOW,
      );
      expect(after.make_up_minutes).toBe(0);
      expect(unrecovered).toBe(15);
    });

    it('drops other batches that expired meanwhile', () => {
      const { student: after } = unbankMakeupMinutes(
        student({
          make_up_batches: [
            { minutes: 60, earned_date: SESSION },
            { minutes: 99, earned_date: daysAgo(100) },
          ],
        }),
        60,
        SESSION,
        NOW,
      );
      expect(after.make_up_batches).toEqual([]);
    });

    it('keeps the rest of a batch larger than the session', () => {
      const { student: after } = unbankMakeupMinutes(
        student({ make_up_batches: [{ minutes: 90, earned_date: SESSION }] }),
        60,
        SESSION,
        NOW,
      );
      expect(batches(after)).toEqual([[30, SESSION]]);
    });

    it('works on a legacy scalar balance', () => {
      const { student: after, unrecovered } = unbankMakeupMinutes(
        student({ make_up_minutes: 100 }),
        60,
        SESSION,
        NOW,
      );
      expect(after.make_up_minutes).toBe(40);
      expect(unrecovered).toBe(0);
    });
  });
});
