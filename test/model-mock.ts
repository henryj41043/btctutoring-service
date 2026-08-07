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
  get: jest.Mock;
  update: jest.Mock;
  delete: jest.Mock;
  batchPut: jest.Mock;
  batchGet: jest.Mock;
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
  ctor.get = jest.fn();
  ctor.update = jest.fn();
  ctor.delete = jest.fn();
  ctor.batchPut = jest.fn();
  ctor.batchGet = jest.fn();
  ctor.__save = save;
  return ctor;
}

/**
 * A self-returning scan chain stub covering the fluent scan API the services
 * use: `.where(...)`, range/prefix conditions, `.all()`, then `.exec()`. Tests
 * can assert on the chain's method mocks (e.g. `chain.between`).
 */
export interface ScanChainMock {
  where: jest.Mock;
  attributes: jest.Mock;
  between: jest.Mock;
  ge: jest.Mock;
  le: jest.Mock;
  beginsWith: jest.Mock;
  in: jest.Mock;
  all: jest.Mock;
  exec: jest.Mock;
}

function makeScanChain(exec: jest.Mock): ScanChainMock {
  const chain = { exec } as ScanChainMock;
  chain.where = jest.fn(() => chain);
  chain.attributes = jest.fn(() => chain);
  chain.between = jest.fn(() => chain);
  chain.ge = jest.fn(() => chain);
  chain.le = jest.fn(() => chain);
  chain.beginsWith = jest.fn(() => chain);
  chain.in = jest.fn(() => chain);
  chain.all = jest.fn(() => chain);
  return chain;
}

/** Make `Model.scan(...)...exec()` resolve with `value`; returns the chain for assertions. */
export function scanResolves(model: ModelMock, value: unknown): ScanChainMock {
  const chain = makeScanChain(jest.fn().mockResolvedValue(value));
  model.scan.mockReturnValue(chain);
  return chain;
}

/** Make `Model.scan(...)...exec()` reject with `error`; returns the chain for assertions. */
export function scanRejects(model: ModelMock, error: Error): ScanChainMock {
  const chain = makeScanChain(jest.fn().mockRejectedValue(error));
  model.scan.mockReturnValue(chain);
  return chain;
}
