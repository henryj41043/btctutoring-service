import { Student } from '../models/student.model';
import { ROSTER_FIELDS, rosterProjection } from './roster-projection';

describe('rosterProjection', () => {
  const full = {
    id: 's-1',
    contact_id: 'fam-1',
    name: 'Charlotte',
    status: 'Active Student',
    package: 'Succeed',
    assigned_tutor_id: 't-1',
    schedule: [{ weekday: 'TUESDAY', start_time: '16:00', end_time: '16:45' }],
    scholarship: true,
    make_up_minutes: 30,
    make_up_batches: [{ minutes: 30, earned_date: '2026-11-01' }],
    make_up_never_expire: false,
    price_override: 400,
    discount_percent: 15,
    discount_reason: 'staff',
    pending_changes: [{ package: 'Thrive', effective: '2026-12-01' }],
    package_history: [{}],
    custom_monthly_cost: 500,
  } as unknown as Student;

  it('keeps the roster fields only', () => {
    expect(Object.keys(rosterProjection(full)).sort()).toEqual(
      [...ROSTER_FIELDS].sort(),
    );
  });

  it('reads a dynamoose document through toJSON and drops absent fields', () => {
    const doc = {
      toJSON: () => ({ id: 's-2', price_override: 1 }),
      price_override: 1,
    } as unknown as Student;
    expect(rosterProjection(doc)).toEqual({ id: 's-2' });
  });
});
