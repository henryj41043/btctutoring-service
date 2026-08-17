import { nextOccurrence } from './recurrence';

describe('nextOccurrence', () => {
  describe('weekly', () => {
    it('advances one week from the anchor', () => {
      expect(nextOccurrence('2026-08-05', 'weekly', '2026-08-05')).toBe('2026-08-12');
    });

    it('is strictly after — a candidate equal to `after` is skipped', () => {
      expect(nextOccurrence('2026-08-05', 'weekly', '2026-08-12')).toBe('2026-08-19');
    });

    it('jumps a stale anchor to the first future date, preserving day-of-week', () => {
      // 2026-07-15 is a Wednesday; first Wednesday after 2026-08-05 is 08-12.
      expect(nextOccurrence('2026-07-15', 'weekly', '2026-08-05')).toBe('2026-08-12');
    });

    it('crosses year boundaries', () => {
      expect(nextOccurrence('2026-12-30', 'weekly', '2026-12-30')).toBe('2027-01-06');
    });
  });

  describe('monthly', () => {
    it('advances one month, same day', () => {
      expect(nextOccurrence('2026-07-15', 'monthly', '2026-07-15')).toBe('2026-08-15');
    });

    it('clamps to the end of shorter months', () => {
      expect(nextOccurrence('2026-01-31', 'monthly', '2026-01-31')).toBe('2026-02-28');
      expect(nextOccurrence('2026-03-31', 'monthly', '2026-03-31')).toBe('2026-04-30');
    });

    it('respects leap years', () => {
      expect(nextOccurrence('2028-01-31', 'monthly', '2028-01-31')).toBe('2028-02-29');
    });

    it('rolls over the year', () => {
      expect(nextOccurrence('2026-12-15', 'monthly', '2026-12-15')).toBe('2027-01-15');
    });

    it('jumps a stale anchor to the first future month, preserving day-of-month', () => {
      // First day-10 strictly after 2026-08-05 is 2026-08-10.
      expect(nextOccurrence('2026-03-10', 'monthly', '2026-08-05')).toBe('2026-08-10');
    });

    it('is strictly after — same-day `after` skips to the following month', () => {
      expect(nextOccurrence('2026-07-15', 'monthly', '2026-08-15')).toBe('2026-09-15');
    });
  });
});
