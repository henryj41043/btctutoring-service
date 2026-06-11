/**
 * Test helpers for mocking dynamoose models.
 *
 * The data services use module-level dynamoose model singletons directly
 * (e.g. `ContactsModel.scan(...)`, `new ContactsModel(...).save()`), so we
 * replace the whole model module with a jest mock. `makeModelMock` builds a
 * constructor mock that also exposes the static query methods.
 */

export interface ModelMock extends jest.Mock {
  scan: jest.Mock;
  update: jest.Mock;
  delete: jest.Mock;
  batchPut: jest.Mock;
  /** The shared `save` mock returned by every `new Model(...)` instance. */
  __save: jest.Mock;
}

/**
 * Build a dynamoose-model mock. Use inside a `jest.mock` factory via require so
 * it survives jest's hoisting, e.g.:
 *
 *   jest.mock('../models/contacts.model', () => ({
 *     ContactsModel: require('../../test/model-mock').makeModelMock(),
 *   }));
 */
export function makeModelMock(): ModelMock {
  const save = jest.fn();
  const ctor = jest.fn(() => ({ save })) as unknown as ModelMock;
  ctor.scan = jest.fn();
  ctor.update = jest.fn();
  ctor.delete = jest.fn();
  ctor.batchPut = jest.fn();
  ctor.__save = save;
  return ctor;
}

/** Make `Model.scan(...).exec()` resolve with `value`. */
export function scanResolves(model: ModelMock, value: unknown): void {
  model.scan.mockReturnValue({ exec: jest.fn().mockResolvedValue(value) });
}

/** Make `Model.scan(...).exec()` reject with `error`. */
export function scanRejects(model: ModelMock, error: Error): void {
  model.scan.mockReturnValue({ exec: jest.fn().mockRejectedValue(error) });
}
