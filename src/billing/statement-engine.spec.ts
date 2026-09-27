import { Student } from '../models/student.model';
import { Contact } from '../models/contact.model';
import { BillingRecord } from '../models/billing-record.model';
import { PackageCatalog } from './package-config';
import { studentMonthlyCharge } from './billing-amount';
import {
  buildStatement,
  buildStatements,
  countSlotsBetween,
  dateKey,
  dayBefore,
  isBillableInMonth,
  keyOf,
  parseMonth,
  segmentLine,
  segmentsOf,
  splitKindOf,
  StatementLine,
  studentLines,
  studentNeedsAttention,
} from './statement-engine';

const catalog: PackageCatalog = {
  Start: { monthlyCost: 273, sessionsPerWeek: 1, sessionLengthMin: 45 },
  Succeed: { monthlyCost: 456, sessionsPerWeek: 2, sessionLengthMin: 45 },
};

// September 2026: the 1st is a Tuesday. Mondays 7, 14, 21, 28;
// Wednesdays 2, 9, 16, 23, 30; Fridays 4, 11, 18, 25.
const Y = 2026;
const SEP = 8;
const MONDAY = [{ weekday: 'MONDAY', start_time: '10:00', end_time: '10:45' }];
const WED_FRI = [
  { weekday: 'WEDNESDAY', start_time: '10:00', end_time: '10:45' },
  { weekday: 'FRIDAY', start_time: '10:00', end_time: '10:45' },
];

const student = (overrides: Partial<Student> = {}): Student =>
  ({
    id: 's-1',
    contact_id: 'c-1',
    name: 'Pat',
    status: 'Active Student',
    package: 'Start',
    package_start_date: '2026-05-01T00:00:00',
    schedule: MONDAY,
    ...overrides,
  }) as Student;

const contact = (overrides: Partial<Contact> = {}): Contact =>
  ({
    id: 'c-1',
    first_name: 'Robin',
    last_name: 'Reed',
    billing_cycle: 'monthly',
    ...overrides,
  }) as Contact;

const statementFor = (
  students: Student[],
  c: Contact = contact(),
  records: BillingRecord[] = [],
  month = SEP,
) => buildStatement(c, students, records, Y, month, catalog)!;

describe('date helpers', () => {
  it('dateKey pads a 0-indexed month and the day', () => {
    expect(dateKey(2026, 0, 5)).toBe('2026-01-05');
    expect(dateKey(2026, 11, 31)).toBe('2026-12-31');
  });

  it('keyOf keeps the date part and rejects junk', () => {
    expect(keyOf('2026-09-14T00:00:00')).toBe('2026-09-14');
    expect(keyOf('2026-09-14')).toBe('2026-09-14');
    expect(keyOf('2026-09')).toBeUndefined();
    expect(keyOf(undefined)).toBeUndefined();
    expect(keyOf(null)).toBeUndefined();
    expect(keyOf(5 as unknown as string)).toBeUndefined();
  });

  it('dayBefore crosses month and year boundaries', () => {
    expect(dayBefore('2026-09-14')).toBe('2026-09-13');
    expect(dayBefore('2026-10-01')).toBe('2026-09-30');
    expect(dayBefore('2027-01-01')).toBe('2026-12-31');
  });

  it('parseMonth accepts YYYY-MM only', () => {
    expect(parseMonth('2026-09')).toEqual({ year: 2026, month: 8 });
    expect(parseMonth('2026-01')).toEqual({ year: 2026, month: 0 });
    expect(parseMonth('2026-12')).toEqual({ year: 2026, month: 11 });
    expect(parseMonth('2026-13')).toBeNull();
    expect(parseMonth('2026-00')).toBeNull();
    expect(parseMonth('2026-9')).toBeNull();
    expect(parseMonth('x2026-09')).toBeNull();
    expect(parseMonth('2026-09-01')).toBeNull();
    expect(parseMonth(undefined as unknown as string)).toBeNull();
  });

  it('countSlotsBetween counts inclusive bounds', () => {
    expect(countSlotsBetween(MONDAY, Y, SEP, '2026-09-01', '2026-09-30')).toBe(
      4,
    );
    expect(countSlotsBetween(MONDAY, Y, SEP, '2026-09-14', '2026-09-30')).toBe(
      3,
    );
    expect(countSlotsBetween(MONDAY, Y, SEP, '2026-09-15', '2026-09-30')).toBe(
      2,
    );
    expect(countSlotsBetween(MONDAY, Y, SEP, '2026-09-01', '2026-09-14')).toBe(
      2,
    );
    expect(countSlotsBetween(MONDAY, Y, SEP, '2026-09-01', '2026-09-13')).toBe(
      1,
    );
    expect(countSlotsBetween(WED_FRI, Y, SEP, '2026-09-01', '2026-09-30')).toBe(
      9,
    );
    expect(countSlotsBetween([], Y, SEP, '2026-09-01', '2026-09-30')).toBe(0);
  });

  it('countSlotsBetween counts two slots on the same weekday twice', () => {
    expect(
      countSlotsBetween(
        [...MONDAY, ...MONDAY],
        Y,
        SEP,
        '2026-09-01',
        '2026-09-30',
      ),
    ).toBe(8);
  });
});

describe('segmentsOf', () => {
  it('a plain student is one open segment from the start date', () => {
    expect(segmentsOf(student())).toEqual([
      expect.objectContaining({
        package: 'Start',
        start: '2026-05-01',
        schedule: MONDAY,
      }),
    ]);
    expect(segmentsOf(student())[0].end).toBeUndefined();
  });

  it('a student without a package has no current segment', () => {
    expect(segmentsOf(student({ package: '' }))).toEqual([]);
  });

  it('history comes first and malformed history is dropped', () => {
    const segments = segmentsOf(
      student({
        package_history: [
          { package: 'Succeed', start: '2026-01-01', end: '2026-04-30' },
          { package: '', start: '2026-01-01', end: '2026-04-30' },
          { package: 'Succeed', start: '', end: '2026-04-30' },
          { package: 'Succeed', start: '2026-01-01', end: '' },
          null as never,
        ],
      }),
    );
    expect(segments.map((s) => s.package)).toEqual(['Succeed', 'Start']);
  });

  it('scheduled changes close the segment before them', () => {
    const segments = segmentsOf(
      student({
        price_override: 250,
        discount_percent: 10,
        pending_changes: [
          { package: 'Succeed', effective: '2026-10-01', schedule: WED_FRI },
          { package: 'Start', effective: '2026-11-15', price_override: 200 },
        ],
      }),
    );
    expect(segments).toHaveLength(3);
    expect(segments[0]).toEqual(
      expect.objectContaining({
        package: 'Start',
        end: '2026-09-30',
        price_override: 250,
        discount_percent: 10,
      }),
    );
    expect(segments[1]).toEqual(
      expect.objectContaining({
        package: 'Succeed',
        start: '2026-10-01',
        end: '2026-11-14',
        schedule: WED_FRI,
        discount_percent: 10,
      }),
    );
    // The override resets on a change unless the change carries one.
    expect(segments[1].price_override).toBeUndefined();
    // A change without its own schedule inherits the one in force before it.
    expect(segments[2]).toEqual(
      expect.objectContaining({
        package: 'Start',
        start: '2026-11-15',
        schedule: WED_FRI,
        price_override: 200,
      }),
    );
    expect(segments[2].end).toBeUndefined();
  });

  it('a change with an empty schedule inherits the current one', () => {
    const segments = segmentsOf(
      student({
        pending_changes: [
          { package: 'Succeed', effective: '2026-10-01', schedule: [] },
        ],
      }),
    );
    expect(segments[1].schedule).toEqual(MONDAY);
  });

  it('the service end date cuts every segment off', () => {
    const segments = segmentsOf(
      student({
        service_end_date: '2026-10-20',
        package_history: [
          { package: 'Succeed', start: '2026-01-01', end: '2026-04-30' },
        ],
        pending_changes: [
          { package: 'Succeed', effective: '2026-10-01' },
          { package: 'Start', effective: '2026-11-01' },
        ],
      }),
    );
    expect(segments.map((s) => [s.package, s.start, s.end])).toEqual([
      ['Succeed', '2026-01-01', '2026-04-30'],
      ['Start', '2026-05-01', '2026-09-30'],
      ['Succeed', '2026-10-01', '2026-10-20'],
    ]);
  });

  it('a segment starting on the end date survives', () => {
    const segments = segmentsOf(
      student({
        service_end_date: '2026-10-01',
        pending_changes: [{ package: 'Succeed', effective: '2026-10-01' }],
      }),
    );
    expect(segments[1]).toEqual(
      expect.objectContaining({ start: '2026-10-01', end: '2026-10-01' }),
    );
  });

  it('a legacy student without a start date stays open at the start', () => {
    const segments = segmentsOf(
      student({
        package_start_date: undefined,
        service_end_date: '2026-09-18',
      }),
    );
    expect(segments).toHaveLength(1);
    expect(segments[0].start).toBeUndefined();
    expect(segments[0].end).toBe('2026-09-18');
  });
});

describe('segmentLine — the one proration rule', () => {
  const line = (segment: Parameters<typeof segmentLine>[0], month = SEP) =>
    segmentLine(segment, { id: 's-1', name: 'Pat' }, Y, month, catalog);

  it('a segment covering the month bills the full price', () => {
    expect(
      line({ package: 'Start', start: '2026-05-01', schedule: MONDAY }),
    ).toEqual({
      student_id: 's-1',
      student_name: 'Pat',
      kind: 'package',
      package: 'Start',
      from: '2026-09-01',
      to: '2026-09-30',
      sessions_billed: 4,
      sessions_in_month: 4,
      rate: 63,
      monthly_price: 273,
      amount: 273,
      discount_percent: 0,
      discount_amount: 0,
      net: 273,
      flags: [],
    });
  });

  it('a segment outside the month contributes nothing', () => {
    expect(
      line({ package: 'Start', start: '2026-10-01', schedule: MONDAY }),
    ).toBeNull();
    expect(
      line({
        package: 'Start',
        start: '2026-05-01',
        end: '2026-08-31',
        schedule: MONDAY,
      }),
    ).toBeNull();
  });

  it('a segment touching the month by one day is kept', () => {
    expect(
      line({ package: 'Start', start: '2026-09-30', schedule: MONDAY })!.from,
    ).toBe('2026-09-30');
    expect(
      line({
        package: 'Start',
        start: '2026-05-01',
        end: '2026-09-01',
        schedule: MONDAY,
      })!.to,
    ).toBe('2026-09-01');
  });

  it.each([
    ['2026-09-01', 4, 273, []],
    ['2026-09-07', 4, 273, []],
    ['2026-09-08', 3, 189, ['prorated_start']],
    ['2026-09-14', 3, 189, ['prorated_start']],
    ['2026-09-29', 0, 0, ['prorated_start']],
  ])('start %s bills %i session(s) = $%d', (start, sessions, amount, flags) => {
    const l = line({ package: 'Start', start, schedule: MONDAY })!;
    expect(l.sessions_billed).toBe(sessions);
    expect(l.amount).toBe(amount);
    expect(l.flags).toEqual(flags);
  });

  it.each([
    ['2026-09-18', 2, 126, ['prorated_end']],
    ['2026-09-27', 3, 189, ['prorated_end']],
    // Mirror rule: an end on or after the last session is a full month.
    ['2026-09-28', 4, 273, []],
    ['2026-09-30', 4, 273, []],
    ['2026-09-06', 0, 0, ['prorated_end']],
  ])('end %s bills %i session(s) = $%d', (end, sessions, amount, flags) => {
    const l = line({
      package: 'Start',
      start: '2026-05-01',
      end,
      schedule: MONDAY,
    })!;
    expect(l.sessions_billed).toBe(sessions);
    expect(l.amount).toBe(amount);
    expect(l.flags).toEqual(flags);
  });

  it('a start and an end in the same month carry both flags', () => {
    const l = line({
      package: 'Start',
      start: '2026-09-08',
      end: '2026-09-22',
      schedule: MONDAY,
    })!;
    expect(l.sessions_billed).toBe(2);
    expect(l.amount).toBe(126);
    expect(l.flags).toEqual(['prorated_start', 'prorated_end']);
  });

  it('a partial month is capped at the monthly price', () => {
    // March 2027 has five Mondays (1, 8, 15, 22, 29): ending on the 23rd
    // leaves 4 sessions x $63 = $252 (under), but a $200 price caps it.
    const l = segmentLine(
      {
        package: 'Start',
        start: '2026-05-01',
        end: '2027-03-23',
        schedule: MONDAY,
        price_override: 200,
      },
      { id: 's-1', name: 'Pat' },
      2027,
      2,
      catalog,
    )!;
    // $200 x 12 / 52 = $46.15 per session; 4 sessions = $184.60.
    expect(l.rate).toBe(46.15);
    expect(l.amount).toBe(184.6);
    const capped = segmentLine(
      {
        package: 'Custom',
        custom_monthly_cost: 100,
        custom_sessions_per_week: 1,
        custom_session_length_min: 45,
        start: '2027-03-02',
        schedule: [...MONDAY, ...MONDAY, ...MONDAY],
        first_week_sessions: [],
      },
      { id: 's-1', name: 'Pat' },
      2027,
      2,
      catalog,
    )!;
    // 12 of 15 sessions x $23.08 = $276.96, capped at the $100 monthly price.
    expect(capped.sessions_billed).toBe(12);
    expect(capped.amount).toBe(100);
  });

  it('without a schedule the full month is billed', () => {
    const l = line({ package: 'Start', start: '2026-09-14' })!;
    expect(l.amount).toBe(273);
    expect(l.sessions_billed).toBe(0);
    expect(l.sessions_in_month).toBe(0);
    expect(l.flags).toEqual([]);
    expect(
      line({ package: 'Start', start: '2026-09-14', schedule: [] })!.amount,
    ).toBe(273);
  });

  it('an unpriced package is shown at $0 and flagged', () => {
    const l = line({ package: 'Custom', start: '2026-05-01' })!;
    expect(l.amount).toBe(0);
    expect(l.net).toBe(0);
    expect(l.flags).toEqual(['unpriced']);
    expect(line({ package: 'Gone', start: '2026-05-01' })!.flags).toEqual([
      'unpriced',
    ]);
  });

  it('a Custom package uses its own price', () => {
    const l = line({
      package: 'Custom',
      custom_monthly_cost: 410.4,
      custom_sessions_per_week: 2,
      custom_session_length_min: 45,
      start: '2026-05-01',
      schedule: WED_FRI,
    })!;
    expect(l.monthly_price).toBe(410.4);
    expect(l.rate).toBe(47.36);
    expect(l.flags).toEqual([]);
  });

  it('a price override replaces the package price and its rate', () => {
    const l = line({
      package: 'Succeed',
      start: '2026-09-11',
      schedule: WED_FRI,
      price_override: 410.4,
    })!;
    expect(l.monthly_price).toBe(410.4);
    expect(l.rate).toBe(47.36);
    expect(l.sessions_billed).toBe(6);
    expect(l.amount).toBe(284.16);
    expect(l.flags).toEqual(['prorated_start', 'price_override']);
  });

  it('a $0 override is honoured and junk overrides are ignored', () => {
    const zero = line({
      package: 'Start',
      start: '2026-05-01',
      schedule: MONDAY,
      price_override: 0,
    })!;
    expect(zero.amount).toBe(0);
    expect(zero.flags).toEqual(['price_override']);
    for (const bad of [-1, NaN, Infinity, '5' as unknown as number]) {
      const l = line({
        package: 'Start',
        start: '2026-05-01',
        schedule: MONDAY,
        price_override: bad,
      })!;
      expect(l.amount).toBe(273);
      expect(l.flags).toEqual([]);
    }
  });

  describe('first-week sessions', () => {
    it('no one-off session: 6 of 9', () => {
      const l = line({
        package: 'Succeed',
        start: '2026-09-11',
        schedule: WED_FRI,
      })!;
      expect(l.sessions_billed).toBe(6);
      expect(l.sessions_in_month).toBe(9);
      expect(l.rate).toBe(52.62);
      expect(l.amount).toBe(315.72);
    });

    it('a one-off session counts toward proration', () => {
      const l = line({
        package: 'Succeed',
        start: '2026-09-11',
        schedule: WED_FRI,
        first_week_sessions: [
          { date: '2026-09-12', start_time: '10:00', end_time: '10:45' },
        ],
      })!;
      expect(l.sessions_billed).toBe(7);
      expect(l.amount).toBe(368.34);
      expect(l.flags).toEqual(['prorated_start']);
    });

    it('reaching the full count bills the full month', () => {
      const l = line({
        package: 'Succeed',
        start: '2026-09-04',
        schedule: WED_FRI,
        first_week_sessions: [
          { date: '2026-09-05', start_time: '10:00', end_time: '10:45' },
        ],
      })!;
      expect(l.sessions_billed).toBe(9);
      expect(l.amount).toBe(456);
      expect(l.flags).toEqual([]);
    });

    it('ignores one-off sessions outside the billed days', () => {
      const l = line({
        package: 'Succeed',
        start: '2026-09-11',
        end: '2026-09-20',
        schedule: WED_FRI,
        first_week_sessions: [
          { date: '2026-09-10', start_time: '10:00', end_time: '10:45' },
          { date: '2026-09-11', start_time: '10:00', end_time: '10:45' },
          { date: '2026-09-20', start_time: '10:00', end_time: '10:45' },
          { date: '2026-09-21', start_time: '10:00', end_time: '10:45' },
          { date: '2026-08-30', start_time: '10:00', end_time: '10:45' },
          null as never,
          { date: 5 as unknown as string, start_time: '', end_time: '' },
        ],
      })!;
      // Regular: Fri 11, Wed 16, Fri 18 = 3; one-offs on the 11th and 20th.
      expect(l.sessions_billed).toBe(5);
    });
  });

  describe('student discount', () => {
    it('takes the percent off the line', () => {
      const l = line({
        package: 'Succeed',
        start: '2026-05-01',
        schedule: WED_FRI,
        discount_percent: 10,
      })!;
      expect(l.amount).toBe(456);
      expect(l.discount_percent).toBe(10);
      expect(l.discount_amount).toBe(45.6);
      expect(l.net).toBe(410.4);
      expect(l.flags).toEqual(['discount']);
    });

    it('caps at 100 percent and ignores junk', () => {
      const l = line({
        package: 'Start',
        start: '2026-05-01',
        schedule: MONDAY,
        discount_percent: 150,
      })!;
      expect(l.discount_percent).toBe(100);
      expect(l.net).toBe(0);
      for (const bad of [0, -5, NaN, Infinity, '10' as unknown as number]) {
        const plain = line({
          package: 'Start',
          start: '2026-05-01',
          schedule: MONDAY,
          discount_percent: bad,
        })!;
        expect(plain.net).toBe(273);
        expect(plain.discount_percent).toBe(0);
        expect(plain.flags).toEqual([]);
      }
    });

    it('a discount on a $0 line is not flagged', () => {
      const l = line({
        package: 'Start',
        start: '2026-09-29',
        schedule: MONDAY,
        discount_percent: 10,
      })!;
      expect(l.discount_amount).toBe(0);
      expect(l.discount_percent).toBe(0);
      expect(l.flags).toEqual(['prorated_start']);
    });
  });

  it('a missing student name becomes blank', () => {
    const l = segmentLine(
      { package: 'Start', schedule: MONDAY },
      { id: 's-1', name: undefined as unknown as string },
      Y,
      SEP,
      catalog,
    )!;
    expect(l.student_name).toBe('');
    expect(l.from).toBe('2026-09-01');
  });
});

describe('studentLines', () => {
  it('a package change month has one line per segment', () => {
    const lines = studentLines(
      student({
        pending_changes: [
          { package: 'Succeed', effective: '2026-09-14', schedule: WED_FRI },
        ],
      }),
      Y,
      SEP,
      catalog,
    );
    expect(lines).toHaveLength(2);
    // Old: Monday the 7th only. New: Wed 16, 23, 30 + Fri 18, 25.
    expect(lines[0]).toEqual(
      expect.objectContaining({
        package: 'Start',
        to: '2026-09-13',
        sessions_billed: 1,
        amount: 63,
        flags: ['package_change'],
      }),
    );
    expect(lines[1]).toEqual(
      expect.objectContaining({
        package: 'Succeed',
        from: '2026-09-14',
        sessions_billed: 5,
        amount: 263.1,
        flags: ['package_change'],
      }),
    );
  });

  it('only the outer boundaries keep their prorated flags', () => {
    const lines = studentLines(
      student({
        package_start_date: '2026-09-08T00:00:00',
        service_end_date: '2026-09-24',
        pending_changes: [
          { package: 'Succeed', effective: '2026-09-14', schedule: WED_FRI },
        ],
      }),
      Y,
      SEP,
      catalog,
    );
    expect(lines[0].flags).toEqual(['prorated_start', 'package_change']);
    expect(lines[1].flags).toEqual(['prorated_end', 'package_change']);
  });

  it('a single line keeps its flags untouched', () => {
    const lines = studentLines(
      student({ package_start_date: '2026-09-14T00:00:00' }),
      Y,
      SEP,
      catalog,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].flags).toEqual(['prorated_start']);
  });

  it('history keeps a past month on its old package', () => {
    const s = student({
      package: 'Succeed',
      package_start_date: '2026-09-01T00:00:00',
      schedule: WED_FRI,
      package_history: [
        {
          package: 'Start',
          start: '2026-05-01',
          end: '2026-08-31',
          schedule: MONDAY,
        },
      ],
    });
    const august = studentLines(s, Y, 7, catalog);
    expect(august).toHaveLength(1);
    expect(august[0]).toEqual(
      expect.objectContaining({ package: 'Start', amount: 273, flags: [] }),
    );
    expect(studentLines(s, Y, SEP, catalog)[0].package).toBe('Succeed');
  });

  describe('legacy mid-month change', () => {
    const rj = student({
      name: 'Robbie',
      package: 'Custom',
      custom_monthly_cost: 410.4,
      custom_sessions_per_week: 2,
      custom_session_length_min: 45,
      package_start_date: '2026-09-14T00:00:00',
      mid_month_change_period: '2026-09',
      mid_month_prior_charge: 189,
      schedule: [
        { weekday: 'MONDAY', start_time: '10:00', end_time: '10:45' },
        { weekday: 'SATURDAY', start_time: '10:00', end_time: '10:45' },
      ],
    });

    it('matches the September amount already billed ($425.80)', () => {
      const lines = studentLines(rj, Y, SEP, catalog);
      expect(lines).toHaveLength(2);
      expect(lines[0]).toEqual(
        expect.objectContaining({
          kind: 'prior_package',
          package: 'Previous package',
          from: '2026-09-01',
          to: '2026-09-13',
          amount: 189,
          net: 189,
          flags: ['package_change'],
        }),
      );
      expect(lines[1]).toEqual(
        expect.objectContaining({
          kind: 'package',
          sessions_billed: 5,
          rate: 47.36,
          amount: 236.8,
          flags: ['package_change'],
        }),
      );
      expect(statementFor([rj]).total).toBe(425.8);
      expect(studentMonthlyCharge(rj, Y, SEP, catalog)).toBe(425.8);
    });

    it('applies to its own month only', () => {
      const october = studentLines(rj, Y, 9, catalog);
      expect(october).toHaveLength(1);
      expect(october[0].amount).toBe(410.4);
    });

    it('needs both the period and a charge', () => {
      expect(
        studentLines({ ...rj, mid_month_prior_charge: 0 }, Y, SEP, catalog),
      ).toHaveLength(1);
      expect(
        studentLines(
          { ...rj, mid_month_prior_charge: undefined },
          Y,
          SEP,
          catalog,
        ),
      ).toHaveLength(1);
    });

    it('a change on the 1st keeps the prior line on the 1st', () => {
      const lines = studentLines(
        { ...rj, package_start_date: '2026-09-01T00:00:00' },
        Y,
        SEP,
        catalog,
      );
      expect(lines[0].to).toBe('2026-09-01');
      const noStart = studentLines(
        { ...rj, package_start_date: undefined },
        Y,
        SEP,
        catalog,
      );
      expect(noStart[0].to).toBe('2026-09-01');
    });

    it('takes the student discount and rounds the stored charge', () => {
      const lines = studentLines(
        {
          ...rj,
          name: undefined as unknown as string,
          mid_month_prior_charge: 189.004,
          discount_percent: 10,
        },
        Y,
        SEP,
        catalog,
      );
      expect(lines[0].student_name).toBe('');
      expect(lines[0].amount).toBe(189);
      expect(lines[0].discount_amount).toBe(18.9);
      expect(lines[0].net).toBe(170.1);
      expect(lines[0].flags).toEqual(['discount', 'package_change']);
    });
  });
});

describe('splitKindOf', () => {
  const l = (overrides: Partial<StatementLine>): StatementLine =>
    ({
      from: '2026-09-01',
      to: '2026-09-30',
      flags: [],
      ...overrides,
    }) as StatementLine;

  it('no lines or a full month split evenly', () => {
    expect(splitKindOf([])).toBe('split');
    expect(splitKindOf([l({})])).toBe('split');
  });

  it('a prorated start on or after the 15th lands on the 15th', () => {
    expect(
      splitKindOf([l({ from: '2026-09-15', flags: ['prorated_start'] })]),
    ).toBe('fifteenth');
    expect(
      splitKindOf([l({ from: '2026-09-14', flags: ['prorated_start'] })]),
    ).toBe('split');
    // A full month that merely starts late is not prorated.
    expect(splitKindOf([l({ from: '2026-09-15' })])).toBe('split');
  });

  it('a prorated ending before the 15th lands on the 1st', () => {
    expect(
      splitKindOf([l({ to: '2026-09-14', flags: ['prorated_end'] })]),
    ).toBe('first');
    expect(
      splitKindOf([l({ to: '2026-09-15', flags: ['prorated_end'] })]),
    ).toBe('split');
    expect(splitKindOf([l({ to: '2026-09-14' })])).toBe('split');
  });

  it('reads the first line for starts and the last for endings', () => {
    expect(
      splitKindOf([
        l({ from: '2026-09-02', flags: ['prorated_start'] }),
        l({ from: '2026-09-20', to: '2026-09-30' }),
      ]),
    ).toBe('split');
    expect(
      splitKindOf([
        l({ to: '2026-09-05' }),
        l({ from: '2026-09-06', to: '2026-09-10', flags: ['prorated_end'] }),
      ]),
    ).toBe('first');
    expect(
      splitKindOf([
        l({ to: '2026-09-05', flags: ['prorated_end'] }),
        l({ from: '2026-09-06' }),
      ]),
    ).toBe('split');
  });
});

describe('isBillableInMonth', () => {
  it('needs a contact and an enrollment', () => {
    expect(isBillableInMonth(student(), Y, SEP)).toBe(true);
    expect(isBillableInMonth(student({ contact_id: '' }), Y, SEP)).toBe(false);
    expect(isBillableInMonth(student({ package: '' }), Y, SEP)).toBe(false);
    expect(
      isBillableInMonth(student({ package: '', btc_and_me: true }), Y, SEP),
    ).toBe(true);
  });

  it('without an end date only Active students bill', () => {
    expect(isBillableInMonth(student({ status: 'Past Student' }), Y, SEP)).toBe(
      false,
    );
    expect(isBillableInMonth(student({ status: 'Onboarding' }), Y, SEP)).toBe(
      false,
    );
  });

  it('an end date keeps a departed student on the months served', () => {
    const past = student({
      status: 'Past Student',
      service_end_date: '2026-09-18',
    });
    expect(isBillableInMonth(past, Y, 7)).toBe(true);
    expect(isBillableInMonth(past, Y, SEP)).toBe(true);
    expect(isBillableInMonth(past, Y, 9)).toBe(false);
    expect(
      isBillableInMonth(
        student({ status: 'Past Student', service_end_date: '2026-09-01' }),
        Y,
        SEP,
      ),
    ).toBe(true);
    // Still Active but already past the end date: not billable.
    expect(
      isBillableInMonth(student({ service_end_date: '2026-08-31' }), Y, SEP),
    ).toBe(false);
  });
});

describe('studentNeedsAttention', () => {
  it('flags what cannot be priced or prorated', () => {
    expect(studentNeedsAttention(student(), catalog)).toBe(false);
    expect(studentNeedsAttention(student({ package: 'Custom' }), catalog)).toBe(
      true,
    );
    expect(
      studentNeedsAttention(
        student({ package_start_date: undefined }),
        catalog,
      ),
    ).toBe(true);
    expect(
      studentNeedsAttention(student({ schedule: undefined }), catalog),
    ).toBe(true);
    expect(studentNeedsAttention(student({ schedule: [] }), catalog)).toBe(
      true,
    );
  });
});

describe('buildStatement', () => {
  it('a monthly family owes the total on the 1st', () => {
    expect(statementFor([student()])).toEqual({
      contact_id: 'c-1',
      contact_name: 'Robin Reed',
      month: '2026-09',
      cycle: 'monthly',
      lines: [expect.objectContaining({ student_name: 'Pat', amount: 273 })],
      package_gross: 273,
      package_subtotal: 273,
      sibling_discount_percent: 0,
      sibling_discount_amount: 0,
      group_fee: 0,
      group_students: [],
      total: 273,
      dues: [
        {
          day: 1,
          period_start: '2026-09-01',
          derived: 273,
          override: null,
          amount: 273,
          paid: false,
        },
      ],
      total_due: 273,
      flags: [],
      needs_attention: false,
    });
  });

  it('returns null when nobody is billable', () => {
    expect(buildStatement(contact(), [], [], Y, SEP, catalog)).toBeNull();
    expect(
      buildStatement(
        contact(),
        [student({ contact_id: 'c-2' })],
        [],
        Y,
        SEP,
        catalog,
      ),
    ).toBeNull();
    expect(
      buildStatement(
        contact(),
        [student({ status: 'Past Student' })],
        [],
        Y,
        SEP,
        catalog,
      ),
    ).toBeNull();
  });

  it('returns null when the month bills nothing', () => {
    expect(
      buildStatement(
        contact(),
        [student({ package_start_date: '2026-10-01T00:00:00' })],
        [],
        Y,
        SEP,
        catalog,
      ),
    ).toBeNull();
    expect(
      buildStatement(
        contact(),
        [student({ package: 'Custom' })],
        [],
        Y,
        SEP,
        catalog,
      ),
    ).toBeNull();
  });

  it('a fully discounted family still gets a statement', () => {
    const s = statementFor([student({ discount_percent: 100 })]);
    expect(s.package_gross).toBe(273);
    expect(s.total).toBe(0);
  });

  it('trims a partial contact name', () => {
    expect(
      statementFor([student()], contact({ last_name: undefined })).contact_name,
    ).toBe('Robin');
    expect(
      statementFor([student()], contact({ first_name: undefined }))
        .contact_name,
    ).toBe('Reed');
  });

  it('applies the student discount, then the sibling discount', () => {
    const family = [
      student({
        id: 's-1',
        package: 'Succeed',
        schedule: WED_FRI,
        discount_percent: 10,
      }),
      student({ id: 's-2', name: 'Sam' }),
      student({ id: 's-3', name: 'Sky' }),
    ];
    const s = statementFor(family, contact({ sibling_discount: 5 }));
    expect(s.package_gross).toBe(1002);
    // 410.40 + 273 + 273
    expect(s.package_subtotal).toBe(956.4);
    expect(s.sibling_discount_percent).toBe(5);
    expect(s.sibling_discount_amount).toBe(47.82);
    expect(s.total).toBe(908.58);
    expect(s.flags).toEqual(['discount']);
  });

  it('one student: $456 less 10% less 5% sibling is $389.88', () => {
    const family = [
      student({
        package: 'Succeed',
        schedule: WED_FRI,
        discount_percent: 10,
        price_override: undefined,
      }),
      student({ id: 's-2', package_start_date: '2026-12-01T00:00:00' }),
      student({ id: 's-3', package_start_date: '2026-12-01T00:00:00' }),
    ];
    const s = statementFor(family, contact({ sibling_discount: 5 }));
    expect(s.total).toBe(389.88);
  });

  it('the sibling discount needs three packaged students', () => {
    const two = statementFor(
      [student(), student({ id: 's-2' })],
      contact({ sibling_discount: 5 }),
    );
    expect(two.sibling_discount_amount).toBe(0);
    expect(two.sibling_discount_percent).toBe(0);
    expect(two.total).toBe(546);
    // A group-only student never counts toward the threshold.
    const withGroup = statementFor(
      [
        student(),
        student({ id: 's-2' }),
        student({ id: 's-3', package: '', btc_and_me: true }),
      ],
      contact({ sibling_discount: 5 }),
    );
    expect(withGroup.sibling_discount_amount).toBe(0);
    expect(withGroup.total).toBe(621);
  });

  it('the group fee is flat and never discounted', () => {
    const s = statementFor([
      student({ btc_and_me: true, discount_percent: 50 }),
      student({ id: 's-2', name: 'Sam', package: '', btc_and_me: true }),
    ]);
    expect(s.group_fee).toBe(150);
    expect(s.group_students).toEqual(['Pat', 'Sam']);
    expect(s.package_subtotal).toBe(136.5);
    expect(s.total).toBe(286.5);
  });

  it('a group-only family owes just the fee', () => {
    const s = statementFor([
      student({
        package: '',
        btc_and_me: true,
        name: undefined as unknown as string,
      }),
    ]);
    expect(s.lines).toEqual([]);
    expect(s.group_students).toEqual(['']);
    expect(s.total).toBe(75);
    expect(s.dues.map((d) => d.amount)).toEqual([75]);
  });

  it('a departed student stays on the final month, prorated', () => {
    const s = statementFor([
      student({ status: 'Past Student', service_end_date: '2026-09-18' }),
    ]);
    expect(s.total).toBe(126);
    expect(s.flags).toEqual(['prorated_end']);
  });

  it('flags a student that needs attention', () => {
    expect(statementFor([student({ schedule: [] })]).needs_attention).toBe(
      true,
    );
    expect(
      statementFor([
        student(),
        student({ id: 's-2', package: '', btc_and_me: true }),
      ]).needs_attention,
    ).toBe(false);
  });

  it('collects each flag once', () => {
    const s = statementFor([
      student({ package_start_date: '2026-09-14T00:00:00' }),
      student({ id: 's-2', package_start_date: '2026-09-21T00:00:00' }),
    ]);
    expect(s.flags).toEqual(['prorated_start']);
  });

  describe('semi-monthly', () => {
    const semi = contact({ billing_cycle: 'semi_monthly' });
    const dues = (students: Student[], c: Contact = semi) =>
      statementFor(students, c).dues.map((d) => [d.day, d.derived]);

    it('a full month splits evenly, odd pennies on the 15th', () => {
      expect(dues([student()])).toEqual([
        [1, 136.5],
        [15, 136.5],
      ]);
      expect(dues([student({ price_override: 100.01 })])).toEqual([
        [1, 50.01],
        [15, 50],
      ]);
      expect(statementFor([student()], semi).cycle).toBe('semi_monthly');
    });

    it('treats the legacy biweekly cycle as semi-monthly', () => {
      expect(
        dues([student()], contact({ billing_cycle: 'biweekly' })),
      ).toHaveLength(2);
    });

    it('a prorated start before the 15th splits evenly', () => {
      expect(
        dues([student({ package_start_date: '2026-09-14T00:00:00' })]),
      ).toEqual([
        [1, 94.5],
        [15, 94.5],
      ]);
    });

    it('a prorated start on or after the 15th lands on the 15th', () => {
      expect(
        dues([student({ package_start_date: '2026-09-15T00:00:00' })]),
      ).toEqual([
        [1, 0],
        [15, 126],
      ]);
    });

    it('a prorated ending before the 15th lands on the 1st', () => {
      expect(dues([student({ service_end_date: '2026-09-14' })])).toEqual([
        [1, 126],
        [15, 0],
      ]);
    });

    it('a prorated ending on or after the 15th splits evenly', () => {
      expect(dues([student({ service_end_date: '2026-09-18' })])).toEqual([
        [1, 63],
        [15, 63],
      ]);
    });

    it('mixes students and puts the group fee on the 1st', () => {
      expect(
        dues([
          student({ btc_and_me: true }),
          student({ id: 's-2', package_start_date: '2026-09-15T00:00:00' }),
        ]),
      ).toEqual([
        [1, 211.5],
        [15, 262.5],
      ]);
    });

    it('discounts the month total before the split', () => {
      const family = [
        student({ id: 's-1' }),
        student({ id: 's-2' }),
        student({ id: 's-3', package_start_date: '2026-09-15T00:00:00' }),
      ];
      const s = statementFor(
        family,
        contact({ billing_cycle: 'semi_monthly', sibling_discount: 10 }),
      );
      // Subtotal 273 + 273 + 126 = 672; less 10% = 604.80.
      expect(s.total).toBe(604.8);
      // The 1st carries 273 of 672 of the discounted total.
      expect(s.dues.map((d) => d.derived)).toEqual([245.7, 359.1]);
    });

    it('a group-only family owes the fee on the 1st and $0 on the 15th', () => {
      expect(dues([student({ package: '', btc_and_me: true })])).toEqual([
        [1, 75],
        [15, 0],
      ]);
    });
  });

  describe('per-date records', () => {
    const semi = contact({ billing_cycle: 'semi_monthly' });
    const record = (overrides: Partial<BillingRecord>): BillingRecord => ({
      contact_id: 'c-1',
      period_start: '2026-09-01',
      cycle: 'semi_monthly',
      amount: 136.5,
      paid: false,
      ...overrides,
    });

    it('carries paid state, dates and invoice numbers', () => {
      const s = statementFor([student()], semi, [
        record({
          paid: true,
          paid_date: '2026-09-02T12:00:00.000Z',
          invoice_number: 'INV-7',
        }),
      ]);
      expect(s.dues[0]).toEqual({
        day: 1,
        period_start: '2026-09-01',
        derived: 136.5,
        override: null,
        amount: 136.5,
        paid: true,
        paid_date: '2026-09-02T12:00:00.000Z',
        invoice_number: 'INV-7',
      });
      expect(s.dues[1].paid).toBe(false);
      expect(s.dues[1]).not.toHaveProperty('paid_date');
      expect(s.dues[1]).not.toHaveProperty('invoice_number');
    });

    it('an override replaces that date only', () => {
      const s = statementFor([student()], semi, [
        record({ period_start: '2026-09-15', amount_override: 0 }),
      ]);
      expect(s.dues[1]).toEqual(
        expect.objectContaining({ derived: 136.5, override: 0, amount: 0 }),
      );
      expect(s.dues[0].amount).toBe(136.5);
      expect(s.total).toBe(273);
      expect(s.total_due).toBe(136.5);
    });

    it('ignores other families, other dates and junk overrides', () => {
      const s = statementFor([student()], contact(), [
        record({ contact_id: 'c-2', amount_override: 1, paid: true }),
        record({ period_start: '2026-09-15', amount_override: 1 }),
        record({
          period_start: '2026-08-01',
          amount_override: 1,
          paid: true,
        }),
      ]);
      expect(s.dues).toHaveLength(1);
      expect(s.dues[0].override).toBeNull();
      expect(s.dues[0].paid).toBe(false);
      const junk = statementFor([student()], contact(), [
        record({ amount_override: '5' as unknown as number }),
      ]);
      expect(junk.dues[0].override).toBeNull();
    });
  });
});

describe('buildStatements', () => {
  it('returns one statement per billable family, sorted by name', () => {
    const contacts = [
      contact({ id: 'c-1', first_name: 'Zed', last_name: 'Young' }),
      contact({ id: 'c-2', first_name: 'Amy', last_name: 'Adams' }),
      contact({ id: 'c-3', first_name: 'No', last_name: 'Students' }),
      contact({ id: undefined, first_name: 'No', last_name: 'Id' }),
    ];
    const students = [
      student({ id: 's-1', contact_id: 'c-1' }),
      student({ id: 's-2', contact_id: 'c-2' }),
      student({ id: 's-3', contact_id: '' }),
      student({ id: 's-4', contact_id: 'c-9' }),
    ];
    const statements = buildStatements(contacts, students, [], Y, SEP, catalog);
    expect(statements.map((s) => s.contact_name)).toEqual([
      'Amy Adams',
      'Zed Young',
    ]);
  });

  it('skips a family that owes nothing', () => {
    expect(
      buildStatements(
        [contact()],
        [student({ status: 'Past Student' })],
        [],
        Y,
        SEP,
        catalog,
      ),
    ).toEqual([]);
  });
});

describe('parity with the v1 formulas', () => {
  const cases: [string, Partial<Student>][] = [
    ['ongoing', {}],
    ['legacy, no start date', { package_start_date: undefined }],
    ['starts on the 1st', { package_start_date: '2026-09-01T00:00:00' }],
    ['starts in the first week', { package_start_date: '2026-09-04T00:00:00' }],
    ['starts mid-month', { package_start_date: '2026-09-14T00:00:00' }],
    [
      'starts after the last slot',
      { package_start_date: '2026-09-29T00:00:00' },
    ],
    ['starts next month', { package_start_date: '2026-10-05T00:00:00' }],
    [
      'no schedule',
      { package_start_date: '2026-09-14T00:00:00', schedule: [] },
    ],
    ['two sessions a week', { package: 'Succeed', schedule: WED_FRI }],
    [
      'two a week, mid-month',
      {
        package: 'Succeed',
        schedule: WED_FRI,
        package_start_date: '2026-09-11T00:00:00',
      },
    ],
    [
      'custom',
      {
        package: 'Custom',
        custom_monthly_cost: 410.4,
        custom_sessions_per_week: 2,
        custom_session_length_min: 45,
        schedule: WED_FRI,
        package_start_date: '2026-09-16T00:00:00',
      },
    ],
    ['unconfigured custom', { package: 'Custom' }],
    [
      'scheduled change next month',
      { pending_changes: [{ package: 'Succeed', effective: '2026-10-01' }] },
    ],
    [
      'scheduled change this month',
      { pending_changes: [{ package: 'Succeed', effective: '2026-09-01' }] },
    ],
    [
      'mid-month change',
      {
        package: 'Succeed',
        schedule: WED_FRI,
        package_start_date: '2026-09-14T00:00:00',
        mid_month_change_period: '2026-09',
        mid_month_prior_charge: 63,
      },
    ],
  ];

  it.each(cases)('%s', (_name, overrides) => {
    const s = student(overrides);
    for (const month of [7, 8, 9, 10]) {
      const lines = studentLines(s, Y, month, catalog);
      const total =
        Math.round(lines.reduce((sum, l) => sum + l.amount, 0) * 100) / 100;
      expect([month, total]).toEqual([
        month,
        studentMonthlyCharge(s, Y, month, catalog),
      ]);
    }
  });
});
