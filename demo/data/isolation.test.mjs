import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir, chmod, symlink, stat, realpath, access } from 'node:fs/promises';
import { readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateIsolation, isolationFromEnvironment, inspectIsolationState, initializeIsolationState } from './isolation.mjs';
import { runIsolatedSeed } from './isolated-seed.mjs';
import { persistDemoSecrets } from './secrets.mjs';
import { createClient } from './client.mjs';

const projectId = 'f1000000-0000-4000-8000-000000000001';
const secretPath = '/twenty-stuard-demo-product-isolated/test-run';
const targetOrigin = 'http://127.0.0.1:3000';

async function fixture(context) {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'twenty-isolation-test-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  return { projectId, environment: 'dev', secretPath, targetOrigin,
    stateDirectory: join(root, 'state'), databaseUrl: 'postgres://127.0.0.1:5432/twenty', cacheUrl: 'redis://127.0.0.1:6379' };
}

function environment(config) {
  return {
    TWENTY_ISOLATED: '1', TWENTY_ISOLATED_PROJECT_ID: config.projectId,
    TWENTY_ISOLATED_ENVIRONMENT: config.environment, TWENTY_ISOLATED_SECRET_PATH: config.secretPath,
    TWENTY_ISOLATED_TARGET_ORIGIN: config.targetOrigin, TWENTY_ISOLATED_STATE_DIRECTORY: config.stateDirectory,
    TWENTY_BASE_URL: config.targetOrigin, TWENTY_AUTH_ORIGIN: config.targetOrigin, SERVER_URL: config.targetOrigin,
    PG_DATABASE_URL: config.databaseUrl, REDIS_URL: config.cacheUrl,
    TWENTY_OWNER_PASSWORD: 'FAKE-owner-only-123', TWENTY_DEMO_PASSWORD_SEED: 'FAKE-isolated-password-seed-0000000000000000',
  };
}

async function withEnvironment(values, callback) {
  const names = new Set([...Object.keys(process.env).filter((name) => /^(TWENTY_|PG_DATABASE_URL$|REDIS_URL$|SERVER_URL$)/.test(name)), ...Object.keys(values)]);
  const prior = Object.fromEntries([...names].map((name) => [name, process.env[name]]));
  for (const name of names) delete process.env[name];
  Object.assign(process.env, values);
  try { return await callback(); }
  finally { for (const name of names) delete process.env[name]; for (const [name, value] of Object.entries(prior)) if (value !== undefined) process.env[name] = value; }
}

test('dry run creates no state, reads no secret and invokes no subprocess', async (context) => {
  const input = await fixture(context);
  const noSecrets = {};
  for (const name of ['TWENTY_OWNER_PASSWORD', 'TWENTY_DEMO_PASSWORD_SEED', 'INFISICAL_TOKEN'])
    Object.defineProperty(noSecrets, name, { get() { throw new Error('Secret read'); } });
  const result = await runIsolatedSeed(input, noSecrets, { run() { assert.fail('subprocess'); }, load() { assert.fail('file read'); } });
  assert.equal(result.mode, 'dry-run');
  assert.equal(result.commands.length, 7);
  assert.match(result.warning, /independently verify/);
  await assert.rejects(access(input.stateDirectory), { code: 'ENOENT' });
});

test('unsafe scopes, origins, endpoints and overrides fail before secrets or any mutation', async (context) => {
  const input = await fixture(context);
  const noSecrets = {};
  Object.defineProperty(noSecrets, 'TWENTY_OWNER_PASSWORD', { get() { assert.fail('secret read before validation'); } });
  const rejected = [
    { projectId: '' }, { environment: 'prod' }, { secretPath: '/twenty-stuard-demo-product' },
    { secretPath: `${secretPath}/../hosted` }, { secretPath: `${secretPath}%2fhosted` },
    { targetOrigin: 'https://twenty-stuard-demo-product.materic.inc' },
    { targetOrigin: 'http://localhost:3000' }, { targetOrigin: 'http://127.1:3000' },
    { targetOrigin: 'http://2130706433:3000' }, { targetOrigin: 'http://0x7f000001:3000' },
    { targetOrigin: 'http://127.0.0.1.evil.example:3000' }, { targetOrigin: 'http://user:pass@127.0.0.1:3000' },
    { targetOrigin: `${targetOrigin}/metadata` }, { targetOrigin: `${targetOrigin}?next=hosted` },
    { databaseUrl: 'postgres://postgres:5432/twenty' }, { databaseUrl: 'postgres://10.0.0.2/twenty' },
    { databaseUrl: 'postgres://127.0.0.1/twenty?host=hosted.example' },
    { cacheUrl: 'redis://redis:6379' }, { cacheUrl: 'redis://metadata.google.internal' },
    { stateDirectory: 'relative-state' },
  ];
  for (const changed of rejected)
    await assert.rejects(runIsolatedSeed({ ...input, ...changed, apply: true }, noSecrets, { run() { assert.fail('mutation'); } }));
  for (const changed of [
    { TWENTY_TRANSPORT_URL: 'http://127.0.0.1:3000' }, { TWENTY_TRANSPORT_URL: '' },
    { SERVER_URL: 'https://twenty-stuard-demo-product.materic.inc' },
    { TWENTY_AUTH_ORIGIN: 'http://127.0.0.1:4000' }, { TWENTY_BASE_URL: 'http://[::1]:3000' },
    { PG_DATABASE_URL: 'postgres://hosted/twenty' }, { REDIS_URL: 'redis://10.0.0.1:6379' },
  ]) await assert.rejects(runIsolatedSeed({ ...input, apply: true }, Object.assign(Object.create(noSecrets), changed)));
  await assert.rejects(access(input.stateDirectory), { code: 'ENOENT' });
  assert.equal(validateIsolation({ ...input, targetOrigin: 'http://[::1]:3000' }).targetOrigin, 'http://[::1]:3000');
});

test('state binds the exact run, secret scope and service endpoints; unsafe files fail before credentials', async (context) => {
  const input = await fixture(context);
  const config = validateIsolation(input);
  await initializeIsolationState(config);
  assert.equal((await stat(config.stateDirectory)).mode & 0o777, 0o700);
  assert.equal((await stat(join(config.stateDirectory, 'isolation.json'))).mode & 0o777, 0o600);
  assert.equal(await inspectIsolationState(config), true);
  for (const changed of [{ secretPath: '/twenty-stuard-demo-product-isolated/another' }, { targetOrigin: 'http://127.0.0.1:3001' }, { cacheEndpoint: 'redis://127.0.0.1:6380' }])
    await assert.rejects(inspectIsolationState({ ...config, ...changed }), /different run/);
  const legacy = join(config.stateDirectory, 'bootstrap-secrets.json');
  await writeFile(legacy, '{}', { mode: 0o644 });
  await assert.rejects(inspectIsolationState(config), /private/);
  await chmod(legacy, 0o600);
  await rm(legacy);
  await symlink(join(config.stateDirectory, 'isolation.json'), legacy);
  await assert.rejects(inspectIsolationState(config), /symlinks/);
  await rm(legacy);
  await writeFile(join(config.stateDirectory, 'seed.lock'), '', { mode: 0o600 });
  await assert.rejects(runIsolatedSeed({ ...input, apply: true }, environment(input)), /Another isolated seed/);
  const unmarked = join(config.stateDirectory, '..', 'unmarked');
  await mkdir(unmarked, { mode: 0o700 });
  await writeFile(join(unmarked, 'bootstrap-secrets.json'), '{}', { mode: 0o600 });
  const noSecrets = {};
  Object.defineProperty(noSecrets, 'TWENTY_OWNER_PASSWORD', { get() { assert.fail('secret read'); } });
  await assert.rejects(runIsolatedSeed({ ...input, stateDirectory: unmarked, apply: true }, noSecrets), /Unmarked/);
});

test('mock apply uses generated local credentials only and preserves exact state on retry', async (context) => {
  const input = await fixture(context);
  const supplied = { ...environment(input), TWENTY_API_KEY: 'DO-NOT-USE-INHERITED', TWENTY_WORKSPACE_ID: 'HOSTED-WORKSPACE', NODE_OPTIONS: '--malicious', HTTP_PROXY: 'http://hosted' };
  const seen = [];
  const run = async (script, arguments_, child) => {
    seen.push(script);
    assert.equal(child.NODE_OPTIONS, undefined);
    assert.equal(child.HTTP_PROXY, undefined);
    assert.equal(child.TWENTY_BASE_URL, targetOrigin);
    assert.equal(child.TWENTY_ISOLATED_SECRET_PATH, secretPath);
    if (script === 'bootstrap.mjs') {
      assert.equal(child.TWENTY_API_KEY, undefined);
      assert.equal(child.TWENTY_WORKSPACE_ID, undefined);
      await writeFile(join(input.stateDirectory, 'bootstrap-secrets.json'), JSON.stringify({ target: targetOrigin, TWENTY_API_KEY: 'FAKE-LOCAL-KEY', TWENTY_WORKSPACE_ID: 'FAKE-LOCAL-WORKSPACE' }), { mode: 0o600 });
    } else {
      assert.equal(child.TWENTY_API_KEY, 'FAKE-LOCAL-KEY');
      assert.equal(child.TWENTY_WORKSPACE_ID, 'FAKE-LOCAL-WORKSPACE');
    }
    if (script === 'team.mjs') {
      assert.deepEqual(arguments_.slice(0, 2), ['--count', '2']);
      await writeFile(join(input.stateDirectory, 'team-credentials.json'), JSON.stringify({ target: targetOrigin, workspaceId: 'FAKE-LOCAL-WORKSPACE', members: [{ completed: true, email: 'fake@meridian.example', password: 'FAKE-MEMBER' }] }), { mode: 0o600 });
    }
    if (script === 'audit-team.mjs') assert.equal(child.DEMO_SMOKE_PASSWORD, 'FAKE-MEMBER');
    if (script === 'seed.mjs') assert.equal(arguments_[1], 'smoke');
  };
  assert.equal((await runIsolatedSeed({ ...input, apply: true }, supplied, { run })).mode, 'complete');
  assert.deepEqual(seen, ['bootstrap.mjs', 'team.mjs', 'audit-team.mjs', 'configure.mjs', 'cleanup-upstream-samples.mjs', 'seed.mjs', 'verify.mjs']);
  assert.equal(await inspectIsolationState(validateIsolation(input)), true);
  await assert.rejects(access(join(input.stateDirectory, 'seed.lock')), { code: 'ENOENT' });
  await runIsolatedSeed({ ...input, apply: true }, supplied, { run });
  assert.equal(seen.length, 14);
  await assert.rejects(runIsolatedSeed({ ...input, apply: true }, supplied, { run() { throw new Error('mock failure'); } }), /mock failure/);
  await assert.rejects(access(join(input.stateDirectory, 'seed.lock')), { code: 'ENOENT' });
});

test('secret persistence receives explicit isolated CLI scope, uses private temporary file and cleans failures', async (context) => {
  const input = await fixture(context);
  const config = validateIsolation(input);
  await initializeIsolationState(config);
  let temporary;
  const store = (command, arguments_) => {
    assert.equal(command, 'infisical');
    assert.equal(arguments_[arguments_.indexOf('--projectId') + 1], projectId);
    assert.equal(arguments_[arguments_.indexOf('--env') + 1], 'dev');
    assert.equal(arguments_[arguments_.indexOf('--path') + 1], secretPath);
    temporary = arguments_[arguments_.indexOf('--file') + 1];
    assert.equal(statSync(temporary).mode & 0o777, 0o600);
    assert.equal(readFileSync(temporary, 'utf8'), `TWENTY_BASE_URL="${targetOrigin}"\nTWENTY_API_KEY="FAKE-ONLY"\n`);
    return { status: 1 };
  };
  await assert.rejects(persistDemoSecrets({ TWENTY_BASE_URL: targetOrigin, TWENTY_API_KEY: 'FAKE-ONLY' }, config, { store }), /Infisical persistence failed/);
  await assert.rejects(access(temporary), { code: 'ENOENT' });
  await assert.rejects(persistDemoSecrets({}, { ...config, secretPath: '/twenty-stuard-demo-product' }, { store() { assert.fail('unsafe scope write'); } }), /dedicated/);
  await withEnvironment({}, async () => {
    assert.equal(isolationFromEnvironment(), null);
    await persistDemoSecrets({ TEST: 'FAKE' }, undefined, { store(_command, arguments_) {
      assert.equal(arguments_[arguments_.indexOf('--path') + 1], '/twenty-stuard-demo-product');
      return { status: 0 };
    } });
  });
});

test('isolated client pins every request and rejects redirects without revealing server diagnostics', async (context) => {
  const input = await fixture(context);
  const originalFetch = globalThis.fetch;
  try {
    await withEnvironment(environment(input), async () => {
      const calls = [];
      globalThis.fetch = async (url, options) => { calls.push({ url: String(url), options }); return new Response('{"data":{"ok":true}}', { status: 200 }); };
      const client = createClient({ baseUrl: targetOrigin, token: 'FAKE-KEY', delayMilliseconds: 0 });
      await client.graphql('query Test { ok }');
      assert.equal(calls[0].url, `${targetOrigin}/metadata`);
      assert.equal(calls[0].options.redirect, 'error');
      for (const path of ['https://hosted.example/metadata', '//127.0.0.1:4000/metadata', 'http://user:pass@127.0.0.1:3000/metadata'])
        await assert.rejects(client.request(path), /exact target origin/);
      assert.equal(calls.length, 1);
      globalThis.fetch = async () => new Response(null, { status: 307, headers: { location: 'https://hosted.example' } });
      await assert.rejects(client.request('/metadata'), /redirect rejected/);
      globalThis.fetch = async () => new Response('{"errors":[{"message":"FAKE-OWNER-PASSWORD"}]}', { status: 200 });
      await assert.rejects(client.request('/metadata'), (error) => !error.message.includes('FAKE-OWNER-PASSWORD') && /withheld/.test(error.message));
      globalThis.fetch = async () => { throw new Error('FAKE-SECRET-in-transport-error'); };
      await assert.rejects(client.request('/metadata'), (error) => !error.message.includes('FAKE-SECRET') && /transport failed/.test(error.message));
      process.env.TWENTY_TRANSPORT_URL = 'http://127.0.0.1:4000';
      await assert.rejects(client.request('/metadata'), /Unset TWENTY_TRANSPORT_URL/);
    });
  } finally { globalThis.fetch = originalFetch; }
});

test('real bootstrap and team entry points reject invalid isolation before state or network access', async (context) => {
  const input = await fixture(context);
  for (const script of ['bootstrap.mjs', 'team.mjs']) {
    const child = spawnSync(process.execPath, [
      '--import', 'data:text/javascript,globalThis.fetch=()=>{throw new Error("NETWORK_WAS_CALLED")}',
      new URL(script, import.meta.url).pathname, '--state-dir', input.stateDirectory,
    ], { env: { ...environment(input), TWENTY_ISOLATED_SECRET_PATH: '/twenty-stuard-demo-product' }, encoding: 'utf8' });
    assert.notEqual(child.status, 0);
    assert.match(child.stderr, /dedicated/);
    assert.doesNotMatch(child.stderr, /NETWORK_WAS_CALLED/);
    await assert.rejects(access(input.stateDirectory), { code: 'ENOENT' });
  }
});

function mockedScript(script, arguments_, values, responses) {
  const preload = `globalThis.fetch=async(url,options)=>{
    const query=JSON.parse(options.body).query;
    const operation=query.match(/(?:query|mutation)\\s+(\\w+)/)?.[1];
    process.stdout.write('MOCK-CALL '+operation+'\\n');
    const responses=JSON.parse(process.env.FAKE_RESPONSES);
    if(!Object.hasOwn(responses,operation))throw new Error('Unexpected mocked operation');
    return new Response(JSON.stringify({data:responses[operation]}),{status:200});
  };`;
  return spawnSync(process.execPath, [
    '--import', `data:text/javascript,${encodeURIComponent(preload)}`,
    new URL(script, import.meta.url).pathname, ...arguments_,
  ], { env: { ...values, FAKE_RESPONSES: JSON.stringify(responses) }, encoding: 'utf8', timeout: 20000 });
}

test('bootstrap never replaces a saved workspace with a same-name different workspace', async (context) => {
  const input = await fixture(context);
  await initializeIsolationState(validateIsolation(input));
  const path = join(input.stateDirectory, 'bootstrap-secrets.json');
  const original = JSON.stringify({ target: targetOrigin, ownerEmail: 'alex.morgan@meridian-cloud.example', TWENTY_WORKSPACE_ID: 'original-isolated-workspace' });
  await writeFile(path, original, { mode: 0o600 });
  const result = mockedScript('bootstrap.mjs', ['--state-dir', input.stateDirectory], environment(input), {
    DemoOwnerExists: { checkUserExists: { exists: true } },
    DemoOwnerAuthentication: { signIn: { availableWorkspaces: { availableWorkspacesForSignIn: [{ id: 'different-workspace', displayName: 'Meridian Cloud', loginToken: 'FAKE' }] } } },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /refusing name-based recovery/);
  assert.equal(result.stdout.trim(), 'MOCK-CALL DemoOwnerExists\nMOCK-CALL DemoOwnerAuthentication');
  assert.equal(await readFile(path, 'utf8'), original);
});

test('isolated team refuses wrong owner session before invitation recovery and wrong Member before profile writes', async (context) => {
  const input = await fixture(context);
  await initializeIsolationState(validateIsolation(input));
  const ownerPath = join(input.stateDirectory, 'bootstrap-secrets.json');
  await writeFile(ownerPath, JSON.stringify({ target: targetOrigin, TWENTY_WORKSPACE_ID: 'local-workspace', TWENTY_OWNER_ACCESS_TOKEN: 'FAKE-OWNER' }), { mode: 0o600 });
  const values = { ...environment(input), TWENTY_WORKSPACE_ID: 'local-workspace', TWENTY_API_KEY: `fake.${Buffer.from(JSON.stringify({ workspaceId: 'local-workspace' })).toString('base64url')}.fake` };
  const arguments_ = ['--state-dir', input.stateDirectory, '--owner-state', ownerPath, '--count', '1'];
  const recoveryPath = join(input.stateDirectory, 'invitation-state.json');
  await writeFile(recoveryPath, JSON.stringify({ target: targetOrigin, workspaceId: 'local-workspace', original: {} }), { mode: 0o600 });
  const owner = mockedScript('team.mjs', arguments_, values, {
    DemoOwnerWorkspace: { currentWorkspace: { id: 'foreign-workspace' } },
  });
  assert.equal(owner.status, 1);
  assert.match(owner.stderr, /owner session belongs to another/);
  assert.equal(owner.stdout.trim(), 'MOCK-CALL DemoOwnerWorkspace');
  await access(recoveryPath);
  await rm(recoveryPath);
  const member = mockedScript('team.mjs', arguments_, values, {
    DemoOwnerWorkspace: { currentWorkspace: { id: 'local-workspace' } },
    DemoInviteState: { currentWorkspace: { id: 'local-workspace', inviteHash: 'FAKE', isPublicInviteLinkEnabled: false } },
    DemoEnableInvite: { updateWorkspace: { id: 'local-workspace' } },
    DemoStaffExists: { checkUserExists: { exists: true } },
    DemoStaffLogin: { getLoginTokenFromCredentials: { loginToken: { token: 'FAKE' } } },
    DemoTeamTokens: { getAuthTokensFromLoginToken: { tokens: { accessOrWorkspaceAgnosticToken: { token: 'FAKE' } } } },
    DemoTeamWorkspace: { currentWorkspace: { id: 'foreign-workspace' } },
    DemoRestoreInvite: { updateWorkspace: { id: 'local-workspace' } },
  });
  assert.equal(member.status, 1);
  assert.match(member.stderr, /Member session belongs to another/);
  assert.doesNotMatch(member.stdout, /DemoTeamProfile|DemoTeamOnboarding/);
  assert.match(member.stdout, /DemoRestoreInvite/);
  await assert.rejects(access(recoveryPath), { code: 'ENOENT' });
});

async function auditFixture(context) {
  const input = await fixture(context);
  await initializeIsolationState(validateIsolation(input));
  const ownerPath = join(input.stateDirectory, 'bootstrap-secrets.json');
  const ownerEmail = 'alex.morgan@meridian-cloud.example';
  const members = [1, 2].map((index) => ({
    id: `member-${index}`, userEmail: `member-${index}@meridian.example`,
    roles: [{ label: 'Member', canUpdateAllSettings: false }],
  }));
  await writeFile(ownerPath, JSON.stringify({
    target: targetOrigin, ownerEmail, ownerWorkspaceMemberId: 'owner',
    TWENTY_WORKSPACE_ID: 'local-workspace', TWENTY_API_KEY: 'FAKE-LOCAL-KEY', TWENTY_OWNER_ACCESS_TOKEN: 'FAKE-OWNER',
  }), { mode: 0o600 });
  await writeFile(join(input.stateDirectory, 'team-credentials.json'), JSON.stringify({
    target: targetOrigin, workspaceId: 'local-workspace',
    members: members.map((member) => ({ completed: true, workspaceMemberId: member.id, email: member.userEmail, password: 'FAKE-MEMBER-ONLY' })),
  }), { mode: 0o600 });
  return {
    input,
    arguments_: ['--owner-state', ownerPath, '--expected-members', '3'],
    values: { ...environment(input), TWENTY_WORKSPACE_ID: 'local-workspace', DEMO_SMOKE_EMAIL: members[0].userEmail, DEMO_SMOKE_PASSWORD: 'FAKE-MEMBER-ONLY' },
    responses: {
      DemoMemberRoles: {
        currentWorkspace: { id: 'local-workspace' },
        currentUser: { onboardingStatus: 'COMPLETED', workspaceMember: { id: 'owner', userEmail: ownerEmail }, workspaceMembers: [
          { id: 'owner', userEmail: ownerEmail, roles: [{ label: 'Admin', canUpdateAllSettings: true }] }, ...members,
        ] },
      },
      DemoAuditMemberLogin: { getLoginTokenFromCredentials: { loginToken: { token: 'FAKE' } } },
      DemoAuditMemberToken: { getAuthTokensFromLoginToken: { tokens: { accessOrWorkspaceAgnosticToken: { token: 'FAKE' } } } },
      DemoAuditMemberState: { currentWorkspace: { id: 'local-workspace' }, currentUser: { onboardingStatus: 'COMPLETED', workspaceMember: structuredClone(members[0]) } },
    },
  };
}

test('final isolated audit proves exact owner and completed Member session identity on a valid rerun', async (context) => {
  const data = await auditFixture(context);
  const result = mockedScript('audit-team.mjs', data.arguments_, data.values, data.responses);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"ownerSessionWorkspaceId": "local-workspace"/);
  assert.match(result.stdout, /"memberSessionWorkspaceId": "local-workspace"/);
  assert.match(result.stdout, /"memberWorkspaceMemberId": "member-1"/);
  assert.match(result.stdout, /"memberPasswordLogin": "passed"/);
  assert.doesNotMatch(result.stdout, /FAKE-MEMBER-ONLY|FAKE-OWNER/);
});

test('final audit rejects foreign owner workspace or identity before Member login', async (context) => {
  const data = await auditFixture(context);
  for (const field of ['workspace', 'identity']) {
    const responses = structuredClone(data.responses);
    if (field === 'workspace') responses.DemoMemberRoles.currentWorkspace.id = 'foreign-workspace';
    else responses.DemoMemberRoles.currentUser.workspaceMember.id = 'foreign-owner';
    const result = mockedScript('audit-team.mjs', data.arguments_, data.values, responses);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Owner session (workspace|identity) differs/);
    assert.equal(result.stdout.trim(), 'MOCK-CALL DemoMemberRoles');
  }
});

test('completed-member rerun cannot reach configure or seed after foreign workspace or wrong identity audit', async (context) => {
  const data = await auditFixture(context);
  for (const field of ['workspace', 'identity', 'email']) {
    const responses = structuredClone(data.responses);
    if (field === 'workspace') responses.DemoAuditMemberState.currentWorkspace.id = 'foreign-workspace';
    if (field === 'identity') responses.DemoAuditMemberState.currentUser.workspaceMember.id = 'foreign-member';
    if (field === 'email') responses.DemoAuditMemberState.currentUser.workspaceMember.userEmail = 'someone-else@meridian.example';
    const commands = [];
    await assert.rejects(runIsolatedSeed({ ...data.input, apply: true }, environment(data.input), {
      run(script, arguments_, child) {
        commands.push(script);
        if (script !== 'audit-team.mjs') return;
        const result = mockedScript(script, arguments_, child, responses);
        assert.equal(result.status, 1);
        assert.match(result.stderr, /Member session (workspace|identity|email) differs/);
        assert.doesNotMatch(result.stdout, /memberPasswordLogin/);
        throw new Error('Final account audit rejected');
      },
    }), /Final account audit rejected/);
    assert.deepEqual(commands, ['bootstrap.mjs', 'team.mjs', 'audit-team.mjs']);
    await assert.rejects(access(join(data.input.stateDirectory, 'seed.lock')), { code: 'ENOENT' });
  }
});
