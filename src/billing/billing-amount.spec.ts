import { studentMonthlyCharge } from './billing-amount';
import { Student } from '../models/student.model';
import { Package } from './package.enum';

const succeed = (over: Partial<Student> = {}): Student =>
  ({ package: Package.SUCCEED, ...over }) as Student;

describe('studentMonthlyCharge (service)', () => {
  it('charges the full monthly cost for an ongoing month', () => {
    expect(
      studentMonthlyCharge(
        succeed({ package_start_date: '2026-05-01T00:00:00' }),
        2026,
        6,
      ),
    ).toBe(362);
  });

  it('charges full when started on the 1st', () => {
    expect(
      studentMonthlyCharge(
        succeed({ package_start_date: '2026-07-01T00:00:00' }),
        2026,
        6,
      ),
    ).toBe(362);
  });

  it('charges zero before the package starts', () => {
    expect(
      studentMonthlyCharge(
        succeed({ package_start_date: '2026-08-01T00:00:00' }),
        2026,
        6,
      ),
    ).toBe(0);
  });

  it('charges full for a legacy student with no start date', () => {
    expect(studentMonthlyCharge(succeed(), 2026, 6)).toBe(362);
  });

  it('charges zero for an unconfigured custom package', () => {
    expect(
      studentMonthlyCharge(succeed({ package: Package.CUSTOM }), 2026, 6),
    ).toBe(0);
  });

  it('prorates the first partial month', () => {
    const student = {
      package: Package.CUSTOM,
      custom_monthly_cost: 400,
      custom_sessions_per_week: 1,
      custom_session_length_min: 45,
      package_start_date: '2026-07-15T00:00:00',
      schedule: [
        { weekday: 'WEDNESDAY', start_time: '10:00', end_time: '10:45' },
      ],
    } as Student;
    expect(studentMonthlyCharge(student, 2026, 6)).toBe(215.38);
  });
});
