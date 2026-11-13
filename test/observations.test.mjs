import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readDataset } from '../src/connector.mjs';
import { collectObservations, decodeSampled, decodeTime, detectRagged } from '../src/observations.mjs';
import { startFixture } from '../fixtures/source.mjs';

const source = await startFixture();
after(() => source.close());
async function collect(kind, chunkSize) {
  const bytes = Buffer.from(await (await fetch(`${source.url}/file?kind=${kind}`)).arrayBuffer());
  return collectObservations(readDataset(bytes), { chunkSize });
}

test('按CF约定识别连续与索引两种ragged表示', async () => {
  const contiguous = await collect('contiguous');
  const indexed = await collect('indexed');
  assert.equal(contiguous.representation, 'contiguous');
  assert.equal(contiguous.raggedVariable, 'rowSize');
  assert.equal(indexed.representation, 'indexed');
  assert.equal(indexed.raggedVariable, 'stationIndex');
  assert.equal(contiguous.instanceDimension, 'profile');
  assert.equal(indexed.sampleDimension, 'obs');
});

test('两种表示的等价观测采成同一业务结构', async () => {
  const contiguous = await collect('contiguous');
  const indexed = await collect('indexed');
  assert.equal(contiguous.complete, true);
  assert.equal(indexed.complete, true);
  assert.deepEqual(indexed.observations, contiguous.observations);
  assert.equal(contiguous.observations.length, 5);
  const [first, , third] = contiguous.observations;
  assert.equal(first.profile, 101);
  assert.equal(first.station, 1);
  assert.equal(first.latitude, 30);
  assert.equal(first.longitude, 120);
  assert.equal(first.depth, 0);
  assert.deepEqual(first.quality, { flag: 0, meaning: 'good' });
  assert.deepEqual(first.provenance.temperature, { variable: 'temperature', index: 0 });
  assert.deepEqual(first.provenance.profile, { variable: 'profileId', index: 0 });
  assert.equal(third.profile, 102);
  assert.deepEqual(third.provenance.profile, { variable: 'profileId', index: 1 });
  assert.deepEqual(third.provenance.depth, { variable: 'depth', index: 2 });
  assert.deepEqual(contiguous.profiles, [
    { profile: 101, station: 1, latitude: 30, longitude: 120, observations: 2 },
    { profile: 102, station: 2, latitude: 31, longitude: 121, observations: 3 },
  ]);
});

test('先判填充值和有效范围再缩放，缺测码不缩成正常值', async () => {
  const { observations } = await collect('contiguous');
  assert.deepEqual(observations.map(record => record.temperature), [283.15, 284.15, null, 285.15, 286.15]);
  const missing = observations[2];
  assert.equal(missing.temperature, null);
  assert.notEqual(missing.temperature, -999 * 0.1 + 273.15);
  assert.deepEqual(missing.missing, ['temperature']);
  assert.deepEqual(missing.quality, { flag: 1, meaning: 'missing' });
});

test('360_day时间保留原日历与数值，不硬转公历', async () => {
  const { observations } = await collect('contiguous');
  const times = observations.map(record => record.time);
  assert.deepEqual(times.map(time => time.date), ['2000-01-01', '2000-02-30', '2000-03-01', '2000-12-30', '2001-01-01']);
  const raw = [0, 59, 60, 359, 360];
  times.forEach((time, index) => {
    assert.equal(time.calendar, '360_day');
    assert.equal(time.value, raw[index]);
    assert.equal(time.iso, undefined);
  });
});

test('计数不守恒被隔离为可定位错误，不错位发布', async () => {
  const broken = await collect('broken');
  assert.equal(broken.complete, false);
  assert.deepEqual(broken.observations, []);
  assert.equal(broken.errors.length, 1);
  const [error] = broken.errors;
  assert.equal(error.code, 'count-overflow');
  assert.equal(error.variable, 'rowSize');
  assert.equal(error.index, 1);
  assert.equal(error.value, 4);
  assert.equal(error.declared, 6);
  assert.equal(error.sampleSize, 5);
});

test('越界索引隔离到具体观测元素，其余观测不受影响', async () => {
  const result = await collect('indexed-broken');
  assert.equal(result.complete, false);
  assert.equal(result.observations.length, 4);
  assert.deepEqual(result.observations.map(record => record.profile), [101, 101, 102, 102]);
  assert.equal(result.errors.length, 1);
  const [error] = result.errors;
  assert.equal(error.code, 'index-out-of-range');
  assert.equal(error.variable, 'stationIndex');
  assert.equal(error.index, 4);
  assert.equal(error.value, 7);
  assert.equal(error.instanceSize, 2);
});

test('零次观测剖面合法，不算错误', async () => {
  const sparse = await collect('sparse');
  assert.equal(sparse.complete, true);
  assert.deepEqual(sparse.errors, []);
  assert.equal(sparse.observations.length, 5);
  assert.ok(sparse.observations.every(record => record.profile === 102));
  assert.equal(sparse.profiles[0].observations, 0);
  assert.equal(sparse.profiles[1].observations, 5);
});

test('按变量切片受控读取，结果与整块读取一致', async () => {
  const whole = await collect('contiguous');
  const sliced = await collect('contiguous', 2);
  assert.deepEqual(sliced.observations, whole.observations);
  assert.ok(sliced.reads.length > whole.reads.length);
  assert.deepEqual(sliced.reads.filter(read => read.variable === 'temperature'), [
    { variable: 'temperature', start: 0, count: 2 },
    { variable: 'temperature', start: 2, count: 2 },
    { variable: 'temperature', start: 4, count: 1 },
  ]);
  const bytes = Buffer.from(await (await fetch(`${source.url}/file?kind=contiguous`)).arrayBuffer());
  assert.throws(() => collectObservations(readDataset(bytes), { chunkSize: 0 }), /chunkSize/);
});

test('decodeTime按日历分别处理', () => {
  assert.deepEqual(
    decodeTime('days since 2000-01-01', '360_day', 59),
    { value: 59, units: 'days since 2000-01-01', calendar: '360_day', date: '2000-02-30' },
  );
  const gregorian = decodeTime('days since 2000-01-01', 'standard', 59);
  assert.equal(gregorian.iso, '2000-02-29T00:00:00.000Z');
  const negative = decodeTime('days since 2000-01-01', '360_day', -1);
  assert.equal(negative.date, '1999-12-30');
  const inexpressible = decodeTime('fortnights since 2000-01-01', '360_day', 3);
  assert.equal(inexpressible.date, undefined);
  assert.equal(inexpressible.calendar, '360_day');
  assert.equal(inexpressible.value, 3);
  assert.ok(inexpressible.error);
  const badUnits = decodeTime('距今若干天', '360_day', 1);
  assert.equal(badUnits.value, 1);
  assert.ok(badUnits.error);
});

test('decodeSampled先判填充与有效范围再缩放', () => {
  const variable = {
    name: 'temperature',
    attributes: {
      _FillValue: { type: 3, value: [-999] },
      scale_factor: { type: 6, value: [0.1] },
      add_offset: { type: 6, value: [273.15] },
      valid_range: { type: 3, value: [0, 1000] },
    },
  };
  assert.deepEqual(decodeSampled(variable, -999), { value: null, raw: -999, missing: true });
  assert.deepEqual(decodeSampled(variable, 100), { value: 283.15, raw: 100 });
  const outOfRange = decodeSampled(variable, 1001);
  assert.equal(outOfRange.value, null);
  assert.equal(outOfRange.invalid, true);
  assert.equal(outOfRange.raw, 1001);
});

test('detectRagged拒绝无ragged属性的文件', () => {
  assert.throws(() => detectRagged({ dimensions: [{ name: 'x', size: 1 }], variables: [] }), /ragged/);
});
