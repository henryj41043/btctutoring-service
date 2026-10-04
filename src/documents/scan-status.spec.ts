import {
  INFECTED_MESSAGE,
  SCAN_TAG,
  SCAN_TIMEOUT_MS,
  SCANNING_MESSAGE,
  UNSCANNED_MESSAGE,
  scanBlockMessage,
  scanStatusOfTag,
  scanTimedOut,
} from './scan-status';

describe('scan-status', () => {
  it('reads the GuardDuty tag and waits fifteen minutes for a verdict', () => {
    expect(SCAN_TAG).toBe('GuardDutyMalwareScanStatus');
    expect(SCAN_TIMEOUT_MS).toBe(900000);
  });

  it.each([
    [undefined, 'scanning'],
    ['NO_THREATS_FOUND', 'clean'],
    ['THREATS_FOUND', 'infected'],
    ['UNSUPPORTED', 'unscanned'],
    ['ACCESS_DENIED', 'unscanned'],
    ['FAILED', 'unscanned'],
    ['', 'unscanned'],
  ])('maps the tag %s to %s', (tag, status) => {
    expect(scanStatusOfTag(tag)).toBe(status);
  });

  it('only lets clean and never-scanned documents through', () => {
    expect(scanBlockMessage(undefined)).toBeNull();
    expect(scanBlockMessage('clean')).toBeNull();
    expect(scanBlockMessage('scanning')).toBe(SCANNING_MESSAGE);
    expect(scanBlockMessage('infected')).toBe(INFECTED_MESSAGE);
    expect(scanBlockMessage('unscanned')).toBe(UNSCANNED_MESSAGE);
    expect(SCANNING_MESSAGE).toBe(
      'This file is still being checked for malware. Try again in a moment.',
    );
    expect(INFECTED_MESSAGE).toBe(
      'This file was blocked: the malware scan found a threat in it.',
    );
    expect(UNSCANNED_MESSAGE).toBe(
      'This file could not be checked for malware, so it cannot be opened. Delete it and upload it again without password protection.',
    );
  });

  it('times out only after the full wait', () => {
    const now = new Date('2026-10-04T12:15:00.000Z');
    expect(scanTimedOut('2026-10-04T12:00:00.000Z', now)).toBe(false);
    expect(scanTimedOut('2026-10-04T11:59:59.999Z', now)).toBe(true);
    expect(scanTimedOut('2026-10-04T12:14:00.000Z', now)).toBe(false);
    expect(scanTimedOut(undefined, now)).toBe(false);
    expect(scanTimedOut('not a date', now)).toBe(false);
  });
});
