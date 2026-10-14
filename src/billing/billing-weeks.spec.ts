import { addDays, billingMonthOf, billingSpan, weekOf } from './billing-weeks';

describe('billing-weeks', () => {
  it('addDays works across month and year ends', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2026-03-08', 0)).toBe('2026-03-08');
  });

  it('weekOf runs Sunday to Saturday, whatever the day asked for', () => {
    // 2026-10-01 is a Thursday.
    expect(weekOf('2026-10-01')).toEqual({
      sunday: '2026-09-27',
      saturday: '2026-10-03',
    });
    expect(weekOf('2026-09-27')).toEqual({
      sunday: '2026-09-27',
      saturday: '2026-10-03',
    });
    expect(weekOf('2026-10-03')).toEqual({
      sunday: '2026-09-27',
      saturday: '2026-10-03',
    });
    expect(weekOf('2026-10-04')).toEqual({
      sunday: '2026-10-04',
      saturday: '2026-10-10',
    });
  });

  it('a straddling week belongs to the month with four or more of its days', () => {
    // Sept 27–Oct 3: 4 days in September.
    expect(billingMonthOf('2026-10-01')).toBe('2026-09');
    expect(billingMonthOf('2026-10-03')).toBe('2026-09');
    expect(billingMonthOf('2026-10-04')).toBe('2026-10');
    // Nov 29–Dec 5: 5 days in December.
    expect(billingMonthOf('2026-11-29')).toBe('2026-12');
    expect(billingMonthOf('2026-11-30')).toBe('2026-12');
    expect(billingMonthOf('2026-11-28')).toBe('2026-11');
    // Aug 30–Sep 5: 5 days in September.
    expect(billingMonthOf('2026-08-31')).toBe('2026-09');
    // Dec 27 2026–Jan 2 2027: 5 days in December.
    expect(billingMonthOf('2027-01-01')).toBe('2026-12');
    expect(billingMonthOf('2027-01-03')).toBe('2027-01');
    // A week entirely inside a month.
    expect(billingMonthOf('2026-10-14')).toBe('2026-10');
  });

  it('billingSpan covers exactly the weeks assigned to the month', () => {
    expect(billingSpan(2026, 8)).toEqual({
      from: '2026-08-30',
      to: '2026-10-03',
    });
    expect(billingSpan(2026, 9)).toEqual({
      from: '2026-10-04',
      to: '2026-10-31',
    });
    expect(billingSpan(2026, 10)).toEqual({
      from: '2026-11-01',
      to: '2026-11-28',
    });
    expect(billingSpan(2026, 11)).toEqual({
      from: '2026-11-29',
      to: '2027-01-02',
    });
    expect(billingSpan(2027, 0)).toEqual({
      from: '2027-01-03',
      to: '2027-01-30',
    });
    // February 2026 starts on a Sunday and ends on a Saturday.
    expect(billingSpan(2026, 1)).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
  });

  it('spans tile the year: each month starts the day after the previous one ends', () => {
    for (let m = 0; m < 11; m++) {
      expect(addDays(billingSpan(2026, m).to, 1)).toBe(
        billingSpan(2026, m + 1).from,
      );
    }
    expect(addDays(billingSpan(2026, 11).to, 1)).toBe(
      billingSpan(2027, 0).from,
    );
  });
});
