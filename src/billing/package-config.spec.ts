import {
  PACKAGE_CONFIG,
  perSessionCost,
  resolvePackageDef,
  weeklyCost,
} from './package-config';
import { Package } from './package.enum';

describe('package-config (service)', () => {
  it('defines every package except CUSTOM', () => {
    for (const pkg of Object.values(Package)) {
      if (pkg === Package.CUSTOM) continue;
      const def = PACKAGE_CONFIG[pkg];
      expect(def.monthlyCost).toBeGreaterThan(0);
      expect(def.sessionsPerWeek).toBeGreaterThan(0);
      expect(def.sessionLengthMin).toBeGreaterThan(0);
    }
  });

  it('derives Succeed weekly and per-session costs', () => {
    const def = PACKAGE_CONFIG[Package.SUCCEED];
    expect(weeklyCost(def)).toBe(83.54);
    expect(perSessionCost(def)).toBe(41.77);
  });

  it('resolves a standard package', () => {
    expect(resolvePackageDef(Package.THRIVE)).toEqual({
      monthlyCost: 181,
      sessionsPerWeek: 1,
      sessionLengthMin: 30,
    });
  });

  it('returns null for undefined, unknown, or unconfigured custom', () => {
    expect(resolvePackageDef(undefined)).toBeNull();
    expect(resolvePackageDef('Nonexistent')).toBeNull();
    expect(resolvePackageDef(Package.CUSTOM)).toBeNull();
    expect(resolvePackageDef(Package.CUSTOM, { monthlyCost: 400 })).toBeNull();
  });

  it('returns the override for a configured custom package', () => {
    const override = {
      monthlyCost: 400,
      sessionsPerWeek: 2,
      sessionLengthMin: 50,
    };
    expect(resolvePackageDef(Package.CUSTOM, override)).toEqual(override);
  });
});
