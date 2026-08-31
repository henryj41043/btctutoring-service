import { Test, TestingModule } from '@nestjs/testing';
import { PackagesService } from './packages.service';
import { PackagesModel } from '../models/packages.model';
import { ModelMock, scanRejects, scanResolves } from '../../test/model-mock';
import { PackageRow } from '../models/package-row.model';

jest.mock('../models/packages.model', () => ({
  PackagesModel: require('../../test/model-mock').makeModelMock(),
}));
const Model = PackagesModel as unknown as ModelMock;

const conditionalFailure = (): Error => {
  const err = new Error('The conditional request failed');
  err.name = 'ConditionalCheckFailedException';
  return err;
};

const row = (overrides: Partial<PackageRow> = {}): PackageRow =>
  ({
    id: 'Zenith',
    monthlyCost: 2000,
    sessionsPerWeek: 5,
    sessionLengthMin: 60,
    ...overrides,
  }) as PackageRow;

describe('PackagesService', () => {
  let service: PackagesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PackagesService],
    }).compile();
    service = module.get(PackagesService);
  });

  it('getPackages scans the whole table', async () => {
    const rows = [row(), row({ id: 'Old', retired: true })];
    const chain = scanResolves(Model, rows);
    await expect(service.getPackages()).resolves.toEqual(rows);
    expect(chain.all).toHaveBeenCalled();
  });

  it('getCatalog folds rows by name, keeping retired entries', async () => {
    scanResolves(Model, [
      row(),
      row({ id: 'Old', monthlyCost: 300, retired: true }),
    ]);
    await expect(service.getCatalog()).resolves.toEqual({
      Zenith: {
        monthlyCost: 2000,
        sessionsPerWeek: 5,
        sessionLengthMin: 60,
        retired: false,
      },
      Old: {
        monthlyCost: 300,
        sessionsPerWeek: 5,
        sessionLengthMin: 60,
        retired: true,
      },
    });
  });

  it('createPackage writes an active row with a trimmed name', async () => {
    Model.create.mockResolvedValue(undefined);
    await expect(
      service.createPackage(row({ id: '  Zenith  ' })),
    ).resolves.toEqual({ id: 'Zenith', message: 'Package created.' });
    expect(Model.create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'Zenith',
        monthlyCost: 2000,
        sessionsPerWeek: 5,
        sessionLengthMin: 60,
        retired: false,
      }),
    );
  });

  it('createPackage maps a duplicate name to a 409', async () => {
    Model.create.mockRejectedValue(conditionalFailure());
    await expect(service.createPackage(row())).rejects.toThrow(
      'already exists',
    );
  });

  it("createPackage rejects an empty or reserved 'Custom' name", async () => {
    await expect(service.createPackage(row({ id: '   ' }))).rejects.toThrow(
      'needs a name',
    );
    await expect(service.createPackage(row({ id: 'Custom' }))).rejects.toThrow(
      'reserved',
    );
    await expect(service.createPackage(row({ id: 'cUsToM' }))).rejects.toThrow(
      'reserved',
    );
    expect(Model.create).not.toHaveBeenCalled();
  });

  it('createPackage rejects each non-positive number separately', async () => {
    await expect(
      service.createPackage(row({ monthlyCost: 0 })),
    ).rejects.toThrow('monthly cost');
    await expect(
      service.createPackage(row({ sessionsPerWeek: -1 })),
    ).rejects.toThrow('sessions per week');
    await expect(
      service.createPackage(
        row({ sessionLengthMin: undefined as unknown as number }),
      ),
    ).rejects.toThrow('session length');
    expect(Model.create).not.toHaveBeenCalled();
  });

  it('retirePackage sets retired=true; restorePackage sets it back', async () => {
    Model.update.mockResolvedValue(undefined);
    await expect(service.retirePackage('Zenith')).resolves.toEqual({
      id: 'Zenith',
      message: 'Package retired.',
    });
    expect(Model.update).toHaveBeenCalledWith(
      { id: 'Zenith' },
      expect.objectContaining({ retired: true }),
      expect.anything(),
    );
    await expect(service.restorePackage('Zenith')).resolves.toEqual({
      id: 'Zenith',
      message: 'Package restored.',
    });
    expect(Model.update).toHaveBeenCalledWith(
      { id: 'Zenith' },
      expect.objectContaining({ retired: false }),
      expect.anything(),
    );
  });

  it('retiring a missing package is a 404', async () => {
    Model.update.mockRejectedValue(conditionalFailure());
    await expect(service.retirePackage('Ghost')).rejects.toThrow(
      'No package named Ghost',
    );
  });

  it('getPackages propagates scan failures', async () => {
    scanRejects(Model, new Error('scan failed'));
    await expect(service.getPackages()).rejects.toThrow('scan failed');
  });

  it('unexpected storage errors propagate', async () => {
    Model.create.mockRejectedValue(new Error('boom'));
    await expect(service.createPackage(row())).rejects.toThrow('boom');
    Model.update.mockRejectedValue(new Error('bang'));
    await expect(service.retirePackage('Zenith')).rejects.toThrow('bang');
  });
});
