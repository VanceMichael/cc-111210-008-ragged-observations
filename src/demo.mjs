import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFixture } from '../fixtures/source.mjs';
import { startService } from './service.mjs';

const directory = await mkdtemp(join(tmpdir(), 'capture-demo-'));
const source = await startFixture();
let service;
try {
  service = await startService({ source: source.url, directory });
  const collect = async kind => (await fetch(`${service.url}/collect?kind=${kind}&chunkSize=2`)).json();
  const [contiguous, indexed, broken] = await Promise.all([collect('contiguous'), collect('indexed'), collect('broken')]);
  const identical = JSON.stringify(contiguous.observations) === JSON.stringify(indexed.observations);
  const receipt = await (await fetch(`${service.url}/receive?key=demo&kind=contiguous`)).json();
  console.log(JSON.stringify({
    来源: source.url,
    两种表示采成同一业务结构: identical,
    观测条数: contiguous.observations.length,
    首条观测: contiguous.observations[0],
    缺测观测: contiguous.observations[2],
    时间序列: contiguous.observations.map(record => record.time),
    切片读取痕迹: contiguous.reads,
    损坏关系隔离: { complete: broken.complete, 观测条数: broken.observations.length, errors: broken.errors },
    台账回执: { key: receipt.key, digest: receipt.digest },
  }, null, 2));
  if (!identical || broken.complete) process.exitCode = 1;
} finally {
  await service?.close();
  await source.close();
  await rm(directory, { recursive: true, force: true });
}
