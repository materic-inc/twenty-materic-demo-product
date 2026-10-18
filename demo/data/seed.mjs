import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import {
  buildDataset,
  summarizeDataset,
  DEFAULT_AS_OF,
  teamDirectory,
} from './dataset.mjs';
import { createClient, listMetadata } from './client.mjs';

const { values } = parseArgs({
  options: {
    profile: { type: 'string', default: 'full' },
    'as-of': { type: 'string', default: DEFAULT_AS_OF },
    apply: { type: 'boolean', default: false },
    'state-dir': {
      type: 'string',
      default: join(homedir(), '.local', 'share', 'twenty-stuard-demo-product'),
    },
    'batch-size': { type: 'string', default: '100' },
    'delay-ms': { type: 'string', default: '700' },
    'from-kind': { type: 'string' },
    'skip-checkpoint': { type: 'boolean', default: false },
  },
});
const stateDirectory = resolve(values['state-dir']);
const baseUrl = process.env.TWENTY_BASE_URL;
const token = process.env.TWENTY_API_KEY;
let memberIds = (process.env.TWENTY_MEMBER_IDS || '')
  .split(',')
  .filter(Boolean);
let client;
let metadata;
let memberNames = {};
if (values.apply) {
  if (!baseUrl || !token)
    throw new Error(
      'TWENTY_BASE_URL and TWENTY_API_KEY are required for --apply',
    );
  const expectedWorkspace = process.env.TWENTY_WORKSPACE_ID;
  if (!expectedWorkspace)
    throw new Error(
      'TWENTY_WORKSPACE_ID is required to pin the target workspace',
    );
  const jwt = JSON.parse(
    Buffer.from(token.split('.')[1], 'base64url').toString(),
  );
  if (jwt.workspaceId !== expectedWorkspace)
    throw new Error('API credential belongs to a different workspace');
  client = createClient({
    baseUrl,
    token,
    delayMilliseconds: Number(values['delay-ms']),
  });
  metadata = await listMetadata(client);
  {
    const response = await client.request(
      '/rest/workspaceMembers?limit=100&depth=0',
    );
    const members = (response.data?.workspaceMembers || []).sort(
      (left, right) =>
        (left.userEmail || '').localeCompare(right.userEmail || ''),
    );
    memberNames = Object.fromEntries(
      members.map((member) => [
        member.id,
        `${member.name?.firstName || ''} ${member.name?.lastName || ''}`.trim(),
      ]),
    );
    if (!memberIds.length)
      memberIds = members
        .filter((member) => member.userEmail?.endsWith('@meridian.example'))
        .map((member) => member.id);
    if (!memberIds.length) memberIds = members.map((member) => member.id);
    if (memberIds.some((id) => !memberNames[id]))
      throw new Error(
        'Every selected owner must have a complete real workspace member profile',
      );
  }
  if (!memberIds.length)
    throw new Error(
      'Provision workspace members before importing business records',
    );
}
const dataset = buildDataset({
  profile: values.profile,
  asOf: values['as-of'],
  memberIds,
  memberNames,
});
console.log(
  JSON.stringify(
    {
      profile: values.profile,
      asOf: values['as-of'],
      staff: teamDirectory().length,
      ...summarizeDataset(dataset),
    },
    null,
    2,
  ),
);
if (values.apply) {
  const batchSize = Number(values['batch-size']);
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100)
    throw new Error('Batch size must be 1..100');
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  const checkpointPath = join(
    stateDirectory,
    `checkpoint-${values.profile}.json`,
  );
  let checkpoint = {
    target: baseUrl,
    workspace: process.env.TWENTY_WORKSPACE_ID,
    batches: {},
  };
  try {
    const stored = JSON.parse(await readFile(checkpointPath, 'utf8'));
    if (
      stored.target !== checkpoint.target ||
      stored.workspace !== checkpoint.workspace
    )
      throw new Error('Checkpoint belongs to a different target');
    checkpoint = stored;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  let reachedStart = !values['from-kind'];
  for (const [plural, rows] of Object.entries(dataset)) {
    if (plural === values['from-kind']) reachedStart = true;
    if (!reachedStart) continue;
    if (!metadata[plural])
      throw new Error(`Object ${plural} missing from target workspace`);
    const missingFields = Object.keys(rows[0]).filter(
      (name) =>
        rows[0][name] !== undefined &&
        !metadata[plural].fields[name] &&
        !(name.endsWith('Id') && metadata[plural].fields[name.slice(0, -2)]) &&
        !Object.values(metadata[plural].fields).some((field) => field.type === 'MORPH_RELATION' && name.startsWith(field.name) && /^[A-Z][A-Za-z0-9]*Id$/.test(name.slice(field.name.length))),
    );
    if (missingFields.length)
      throw new Error(
        `${plural} missing fields: ${missingFields.join(', ')}. Run configure.mjs first.`,
      );
    for (let offset = 0; offset < rows.length; offset += batchSize) {
      const batch = rows.slice(offset, offset + batchSize);
      const hash = createHash('sha256')
        .update(JSON.stringify(batch))
        .digest('hex');
      const key = `${plural}:${offset}:${batchSize}`;
      if (!values['skip-checkpoint'] && checkpoint.batches[key] === hash)
        continue;
      await client.upsert(plural, batch);
      checkpoint.batches[key] = hash;
      await writeFile(checkpointPath, JSON.stringify(checkpoint), {
        mode: 0o600,
      });
      if (
        offset === 0 ||
        offset + batchSize >= rows.length ||
        offset % 1000 === 0
      )
        console.log(
          `${plural}: ${Math.min(offset + batchSize, rows.length)}/${rows.length}`,
        );
    }
  }
  await writeFile(
    join(stateDirectory, 'seed-summary.json'),
    JSON.stringify(
      {
        url: baseUrl,
        workspace: process.env.TWENTY_WORKSPACE_ID,
        asOf: values['as-of'],
        profile: values.profile,
        completedAt: new Date().toISOString(),
        ...summarizeDataset(dataset),
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(
    'Seed complete. Run verify.mjs for independent server-side counts and relationships.',
  );
}
