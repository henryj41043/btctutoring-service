import {
  CUSTOM_PACKAGE,
  perSessionCost,
  resolvePackageDef,
  weeklyCost,
} from './package-config';
import { TEST_CATALOG } from '../../test/package-catalog.fixture';

describe('package-config (service)', () => {
  it('resolves a named package from the catalog', () => {
    expect(resolvePackageDef('Apex', TEST_CATALOG)).toEqual({
      monthlyCost: 1820,
      sessionsPerWeek: 5,
      sessionLengthMin: 60,
    });
  });

  it('resolves a RETIRED package (students on it keep billing)', () => {
    const catalog = {
      Legacy: {
        monthlyCost: 300,
        sessionsPerWeek: 1,
        sessionLengthMin: 30,
        retired: true,
      },
    };
    expect(resolvePackageDef('Legacy', catalog)).toEqual({
      monthlyCost: 300,
      sessionsPerWeek: 1,
      sessionLengthMin: 30,
    });
  });

  it('derives Succeed weekly and per-session costs', () => {
    const def = TEST_CATALOG['Succeed'];
    expect(weeklyCost(def)).toBe(83.54);
    expect(perSessionCost(def)).toBe(41.77);
  });

  it('returns null for undefined, unknown, empty catalog, or unconfigured custom', () => {
    expect(resolvePackageDef(undefined, TEST_CATALOG)).toBeNull();
    expect(resolvePackageDef('Nonexistent', TEST_CATALOG)).toBeNull();
    expect(resolvePackageDef('Apex', {})).toBeNull();
    expect(resolvePackageDef(CUSTOM_PACKAGE, TEST_CATALOG)).toBeNull();
    expect(
      resolvePackageDef(CUSTOM_PACKAGE, TEST_CATALOG, { monthlyCost: 400 }),
    ).toBeNull();
  });

  it('returns the override for a configured custom package (catalog ignored)', () => {
    const override = {
      monthlyCost: 400,
      sessionsPerWeek: 2,
      sessionLengthMin: 50,
    };
    expect(resolvePackageDef(CUSTOM_PACKAGE, {}, override)).toEqual(override);
  });
});
