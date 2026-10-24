import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const versionSource = readFileSync('packages/twenty-server/src/engine/core-modules/upgrade/constants/twenty-current-version.constant.ts', 'utf8');
const upstreamVersion = versionSource.match(/TWENTY_CURRENT_VERSION = '(\d+\.\d+\.\d+)'/)?.[1];
assert.ok(upstreamVersion, 'Cannot resolve the upstream Twenty version');
assert.match(process.env.GITHUB_SHA ?? '', /^[a-f0-9]{40}$/, 'GITHUB_SHA must be a full commit SHA');
console.log(`${upstreamVersion}+materic.${process.env.GITHUB_SHA}`);
