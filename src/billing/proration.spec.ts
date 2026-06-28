import {
  countMissedSlots,
  proratedFirstMonthCost,
  semiMonthlySplit,
} from './proration';
import { PACKAGE_CONFIG } from './package-config';
import { Package } from './package.enum';
import { ScheduleSlot } from '../models/student.model';

// July 2026: the 1st is a Wednesday. Wednesdays 1,8,15,22,29; Mondays 6,13,20,27.
const slot = (weekday: string): ScheduleSlot =>
  ({ weekday, start_time: '15:00', end_time: '15:30' }) as ScheduleSlot;

describe('proration (service)', () => {
  it('counts missed slots before a mid-month start', () => {
    expect(countMissedSlots([slot('WEDNESDAY')], new Date(2026, 6, 15))).toBe(
      2,
    );
  });

  it('counts across multiple weekday slots', () => {
    expect(
      countMissedSlots(
        [slot('MONDAY'), slot('WEDNESDAY')],
        new Date(2026, 6, 9),
      ),
    ).toBe(3);
  });

  it('is zero on the 1st and for an empty schedule', () => {
    expect(countMissedSlots([slot('WEDNESDAY')], new Date(2026, 6, 1))).toBe(0);
    expect(countMissedSlots([], new Date(2026, 6, 15))).toBe(0);
  });

  it('prorates, charges full, and floors at zero', () => {
    const succeed = PACKAGE_CONFIG[Package.SUCCEED];
    expect(proratedFirstMonthCost(succeed, 2)).toBe(278.46);
    expect(proratedFirstMonthCost(succeed, 0)).toBe(362);
    expect(proratedFirstMonthCost(succeed, 1000)).toBe(0);
  });

  it('splits semi-monthly totals', () => {
    expect(semiMonthlySplit(278.46)).toEqual([139.23, 139.23]);
    const [a, b] = semiMonthlySplit(181.01);
    expect(a + b).toBeCloseTo(181.01, 2);
  });
});
