import { easternSlotToUtc, easternWallTimeToUtc } from './eastern-time';

describe('easternWallTimeToUtc', () => {
  it('converts an EDT (summer) wall time at UTC-4', () => {
    // The Cameron Carson regression: Tue Jul 7 2026, 11:30 AM Eastern.
    expect(easternWallTimeToUtc(2026, 6, 7, 11, 30).toISOString()).toBe(
      '2026-07-07T15:30:00.000Z',
    );
  });

  it('converts an EST (winter) wall time at UTC-5', () => {
    expect(easternWallTimeToUtc(2026, 0, 7, 11, 30).toISOString()).toBe(
      '2026-01-07T16:30:00.000Z',
    );
  });

  it('handles the spring-forward day on both sides of the switch', () => {
    // US DST 2026 begins Sun Mar 8. 1:30 AM is still EST (UTC-5)...
    expect(easternWallTimeToUtc(2026, 2, 8, 1, 30).toISOString()).toBe(
      '2026-03-08T06:30:00.000Z',
    );
    // ...and 3:30 AM is EDT (UTC-4).
    expect(easternWallTimeToUtc(2026, 2, 8, 3, 30).toISOString()).toBe(
      '2026-03-08T07:30:00.000Z',
    );
  });

  it('handles the fall-back day on both sides of the switch', () => {
    // US DST 2026 ends Sun Nov 1. 0:30 AM is still EDT (UTC-4)...
    expect(easternWallTimeToUtc(2026, 10, 1, 0, 30).toISOString()).toBe(
      '2026-11-01T04:30:00.000Z',
    );
    // ...and 2:30 AM is EST (UTC-5).
    expect(easternWallTimeToUtc(2026, 10, 1, 2, 30).toISOString()).toBe(
      '2026-11-01T07:30:00.000Z',
    );
  });

  it('handles midnight (the ICU hour-24 edge)', () => {
    expect(easternWallTimeToUtc(2026, 6, 10, 0, 0).toISOString()).toBe(
      '2026-07-10T04:00:00.000Z',
    );
  });

  it('is stable regardless of the host timezone (pins Eastern, not ambient-local)', () => {
    // The same wall time yields the same instant whether the host runs UTC
    // (Fargate) or Eastern (a dev laptop) — the conversion never consults the
    // ambient zone. 6:00 PM EDT = 22:00Z.
    expect(easternWallTimeToUtc(2026, 6, 20, 18, 0).getTime()).toBe(
      Date.UTC(2026, 6, 20, 22, 0),
    );
  });
});

describe('easternSlotToUtc', () => {
  it('parses an HH:mm slot on a calendar date', () => {
    expect(easternSlotToUtc(2026, 6, 7, '11:30').toISOString()).toBe(
      '2026-07-07T15:30:00.000Z',
    );
  });

  it('treats a missing or malformed time as midnight Eastern', () => {
    expect(easternSlotToUtc(2026, 6, 10, '').toISOString()).toBe(
      '2026-07-10T04:00:00.000Z',
    );
    expect(
      easternSlotToUtc(2026, 6, 10, undefined as never).toISOString(),
    ).toBe('2026-07-10T04:00:00.000Z');
    expect(easternSlotToUtc(2026, 6, 10, 'garbage').toISOString()).toBe(
      '2026-07-10T04:00:00.000Z',
    );
  });
});
