import { PackagePromotionService } from './package-promotion.service';
import { Student } from '../models/student.model';

describe('PackagePromotionService', () => {
  let service: PackagePromotionService;
  const students = { getStudents: jest.fn(), promotePendingChanges: jest.fn() };

  const student = (over: Partial<Student> = {}): Student =>
    ({
      id: 's-1',
      status: 'Active Student',
      package: 'Thrive',
      pending_changes: [{ package: 'Excel', effective: '2026-10-14' }],
      ...over,
    }) as Student;

  // 07:00 UTC Oct 14 2026 = 3am Eastern on the 14th.
  const now = new Date('2026-10-14T07:00:00Z');

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    service = new PackagePromotionService(students as any);
    students.getStudents.mockResolvedValue([student()]);
    students.promotePendingChanges.mockResolvedValue(undefined);
  });

  it('promotes a change on its effective date', async () => {
    const res = await service.promoteDueChanges(now);
    expect(students.promotePendingChanges).toHaveBeenCalledWith(
      student(),
      '2026-10-14',
    );
    expect(res).toEqual({ studentsPromoted: 1 });
  });

  it('leaves a change that is not due yet', async () => {
    const res = await service.promoteDueChanges(
      new Date('2026-10-13T07:00:00Z'),
    );
    expect(students.promotePendingChanges).not.toHaveBeenCalled();
    expect(res.studentsPromoted).toBe(0);
  });

  it('uses the Eastern date, not the UTC one', async () => {
    // 03:00 UTC on the 14th is still the 13th in New York.
    await service.promoteDueChanges(new Date('2026-10-14T03:00:00Z'));
    expect(students.promotePendingChanges).not.toHaveBeenCalled();
    await service.promoteDueChanges(new Date('2026-10-14T04:00:00Z'));
    expect(students.promotePendingChanges).toHaveBeenCalledTimes(1);
  });

  it('catches up after missed runs', async () => {
    await service.promoteDueChanges(new Date('2026-11-02T07:00:00Z'));
    expect(students.promotePendingChanges).toHaveBeenCalledWith(
      student(),
      '2026-11-02',
    );
  });

  it('reads a datetime-shaped effective by its date', async () => {
    students.getStudents.mockResolvedValue([
      student({
        pending_changes: [
          { package: 'Excel', effective: '2026-10-14T00:00:00' },
        ],
      }),
    ]);
    const res = await service.promoteDueChanges(now);
    expect(res.studentsPromoted).toBe(1);
  });

  it('promotes when any of several changes is due', async () => {
    students.getStudents.mockResolvedValue([
      student({
        pending_changes: [
          { package: 'Apex', effective: '2026-12-01' },
          { package: 'Excel', effective: '2026-10-01' },
        ],
      }),
    ]);
    const res = await service.promoteDueChanges(now);
    expect(res.studentsPromoted).toBe(1);
  });

  it('only touches Active students with an id and a change', async () => {
    students.getStudents.mockResolvedValue([
      student({ status: 'Past Student' }),
      student({ status: 'Onboarding' }),
      student({ id: undefined }),
      student({ pending_changes: undefined }),
      student({ pending_changes: [] }),
    ]);
    const res = await service.promoteDueChanges(now);
    expect(students.promotePendingChanges).not.toHaveBeenCalled();
    expect(res.studentsPromoted).toBe(0);
  });

  it('one student failing never stops the others', async () => {
    students.getStudents.mockResolvedValue([
      student({ id: 's-1' }),
      student({ id: 's-2' }),
      student({ id: 's-3' }),
    ]);
    students.promotePendingChanges
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(undefined);
    const res = await service.promoteDueChanges(now);
    expect(students.promotePendingChanges).toHaveBeenCalledTimes(3);
    expect(res.studentsPromoted).toBe(2);
  });

  it('rejects when the students cannot be loaded', async () => {
    students.getStudents.mockRejectedValue(new Error('down'));
    await expect(service.promoteDueChanges(now)).rejects.toThrow('down');
  });
});
