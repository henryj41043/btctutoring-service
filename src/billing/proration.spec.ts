import {
  countRemainingSlots,
  proratedFirstMonthCost,
  semiMonthlySplit,
} from './proration';
import { TEST_CATALOG } from '../../test/package-catalog.fixture';
import { ScheduleSlot } from '../models/student.model';

// July 2026: the 1st is a Wednesday. Wednesdays 1,8,15,22,29; Mondays 6,13,20,27.
const slot = (weekday: string): ScheduleSlot =>
  ({ weekday, start_time: '15:00', end_time: '15:30' }) as ScheduleSlot;

describe('proration (service)', () => {
  it('counts remaining slots from a mid-month start through month end', () => {
    // Wednesdays on/after the 15th: 15, 22, 29.
    expect(
      countRemainingSlots([slot('WEDNESDAY')], new Date(2026, 6, 15)),
    ).toBe(3);
  });

  it('counts across multiple weekday slots, including the start date', () => {
    // On/after the 9th: Wednesdays 15,22,29 + Mondays 13,20,27.
    expect(
      countRemainingSlots(
        [slot('MONDAY'), slot('WEDNESDAY')],
        new Date(2026, 6, 9),
      ),
    ).toBe(6);
    // Starting ON a scheduled Wednesday counts that day.
    expect(
      countRemainingSlots([slot('WEDNESDAY')], new Date(2026, 6, 29)),
    ).toBe(1);
  });

  it('is zero when no scheduled days remain and for an empty schedule', () => {
    expect(
      countRemainingSlots([slot('WEDNESDAY')], new Date(2026, 6, 30)),
    ).toBe(0);
    expect(countRemainingSlots([], new Date(2026, 6, 15))).toBe(0);
  });

  it('charges per-session cost × remaining sessions, capped at the monthly cost', () => {
    const succeed = TEST_CATALOG['Succeed']; // $362, perSession $41.77
    expect(proratedFirstMonthCost(succeed, 1)).toBe(41.77);
    expect(proratedFirstMonthCost(succeed, 2)).toBe(83.54);
    expect(proratedFirstMonthCost(succeed, 0)).toBe(0);
    // 9 × 41.77 = 375.93 > 362 → capped at the flat monthly price.
    expect(proratedFirstMonthCost(succeed, 9)).toBe(362);
  });

  it('splits semi-monthly totals', () => {
    expect(semiMonthlySplit(278.46)).toEqual([139.23, 139.23]);
    const [a, b] = semiMonthlySplit(181.01);
    expect(a + b).toBeCloseTo(181.01, 2);
  });
});
