import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createClient } from './client.mjs';

const { values } = parseArgs({
  options: {
    apply: { type: 'boolean', default: false },
    report: { type: 'string' },
  },
});
const {
  TWENTY_BASE_URL: baseUrl,
  TWENTY_API_KEY: token,
  TWENTY_WORKSPACE_ID: workspaceId,
} = process.env;
if (
  !baseUrl ||
  !token ||
  !workspaceId ||
  JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
    .workspaceId !== workspaceId
)
  throw new Error('Pinned demo workspace credentials required');
const client = createClient({ baseUrl, token });
const plans = [
  ['opportunities', 'opportunities'],
  ['people', 'people'],
  ['companies', 'companies'],
  ['dashboards', 'dashboards'],
];
const report = {
  workspaceId,
  verifiedAt: new Date().toISOString(),
  applied: values.apply,
  removed: [],
  before: {},
  after: {},
};
for (const [plural, sourceName] of plans) {
  const source = await readFile(
    new URL(
      `../../packages/twenty-server/src/engine/workspace-manager/standard-objects-prefill-data/utils/prefill-${sourceName}.util.ts`,
      import.meta.url,
    ),
    'utf8',
  );
  const known = new Map(
    [
      ...source.matchAll(/export const ([A-Z0-9_]+)\s*=\s*'([0-9a-f-]{36})'/g),
    ].map((match) => [match[2], match[1]]),
  );
  if (!known.size)
    throw new Error(`No upstream sample allowlist in ${sourceName}`);
  const response = await client.request(`/rest/${plural}?limit=100&depth=0`);
  report.before[plural] = response.totalCount;
  for (const record of response.data[plural]) {
    if (!known.has(record.id)) continue;
    if (record.createdBy?.source !== 'SYSTEM')
      throw new Error(
        `Refusing to remove non-system record ${plural}/${record.id}`,
      );
    if (values.apply)
      await client.request(`/rest/${plural}/${record.id}?soft_delete=false`, {
        method: 'DELETE',
      });
    report.removed.push({
      object: plural,
      id: record.id,
      upstreamConstant: known.get(record.id),
    });
  }
  const after = await client.request(`/rest/${plural}?limit=1&depth=0`);
  report.after[plural] = after.totalCount;
}
for (const plural of ['tasks', 'notes']) {
  const response = await client.request(`/rest/${plural}?limit=1&depth=0`);
  report.before[plural] = response.totalCount;
  report.after[plural] = response.totalCount;
}
console.log(JSON.stringify(report, null, 2));
if (values.report) {
  const path = resolve(values.report);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(report, null, 2));
}
