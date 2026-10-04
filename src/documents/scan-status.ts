/** Where a stored document stands with the malware scan. */
export type ScanStatus = 'scanning' | 'clean' | 'infected' | 'unscanned';

/** The tag the scanner puts on every file it has looked at. */
export const SCAN_TAG = 'GuardDutyMalwareScanStatus';
/** A scan takes seconds; with no verdict after this long it is not coming. */
export const SCAN_TIMEOUT_MS = 15 * 60 * 1000;

export const SCANNING_MESSAGE =
  'This file is still being checked for malware. Try again in a moment.';
export const INFECTED_MESSAGE =
  'This file was blocked: the malware scan found a threat in it.';
export const UNSCANNED_MESSAGE =
  'This file could not be checked for malware, so it cannot be opened. Delete it and upload it again without password protection.';

/** The scanner's verdict as a status; no tag yet means it is still working. */
export function scanStatusOfTag(value: string | undefined): ScanStatus {
  if (value === undefined) {
    return 'scanning';
  }
  if (value === 'NO_THREATS_FOUND') {
    return 'clean';
  }
  if (value === 'THREATS_FOUND') {
    return 'infected';
  }
  // UNSUPPORTED (password protected), ACCESS_DENIED, FAILED.
  return 'unscanned';
}

/**
 * Why a document may not be opened, or null when it may. A document stored
 * before scanning existed carries no status and stays openable.
 */
export function scanBlockMessage(
  status: ScanStatus | undefined,
): string | null {
  if (status === 'scanning') {
    return SCANNING_MESSAGE;
  }
  if (status === 'infected') {
    return INFECTED_MESSAGE;
  }
  if (status === 'unscanned') {
    return UNSCANNED_MESSAGE;
  }
  return null;
}

/** True once a scan has had its time and still gave no verdict. */
export function scanTimedOut(
  uploadedAt: string | undefined,
  now: Date,
): boolean {
  const started = Date.parse(uploadedAt ?? '');
  return !Number.isNaN(started) && now.getTime() - started > SCAN_TIMEOUT_MS;
}
