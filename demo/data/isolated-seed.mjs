import { readFile, open, unlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { validateIsolation, inspectIsolationState, initializeIsolationState } from './isolation.mjs';

const scriptsDirectory = fileURLToPath(new URL('.', import.meta.url));

function commandPlan(config) {
  const ownerState = join(config.stateDirectory, 'bootstrap-secrets.json');
  return [
    ['bootstrap.mjs', '--state-dir', config.stateDirectory],
    ['team.mjs', '--count', '2', '--owner-state', ownerState, '--state-dir', config.stateDirectory],
    ['audit-team.mjs', '--owner-state', ownerState, '--expected-members', '3'],
    ['configure.mjs'],
    ['cleanup-upstream-samples.mjs', '--apply', '--report', join(config.stateDirectory, 'upstream-cleanup.json')],
    ['seed.mjs', '--profile', 'smoke', '--apply', '--state-dir', config.stateDirectory],
    ['verify.mjs', '--profile', 'smoke', '--samples', '4', '--report', join(config.stateDirectory, 'verification.json')],
  ];
}

function childEnvironment(config, environment) {
  const child = {};
  for (const name of ['PATH', 'HOME', 'TMPDIR', 'SSL_CERT_FILE', 'NODE_EXTRA_CA_CERTS', 'INFISICAL_TOKEN', 'INFISICAL_API_URL'])
    if (environment[name] !== undefined) child[name] = environment[name];
  for (const name of ['TWENTY_OWNER_PASSWORD', 'TWENTY_DEMO_PASSWORD_SEED']) {
    if (typeof environment[name] !== 'string' || !environment[name]) throw new Error(`${name} must be injected from the isolated Infisical scope`);
    child[name] = environment[name];
  }
  if (child.TWENTY_OWNER_PASSWORD.length < 8 || child.TWENTY_OWNER_PASSWORD.length > 50 || child.TWENTY_DEMO_PASSWORD_SEED.length < 32)
    throw new Error('Use an owner password of 8..50 characters and a fresh password seed of at least 32 characters');
  return Object.assign(child, {
    TWENTY_ISOLATED: '1', TWENTY_ISOLATED_PROJECT_ID: config.projectId,
    TWENTY_ISOLATED_ENVIRONMENT: config.environment, TWENTY_ISOLATED_SECRET_PATH: config.secretPath,
    TWENTY_ISOLATED_TARGET_ORIGIN: config.targetOrigin, TWENTY_ISOLATED_STATE_DIRECTORY: config.stateDirectory,
    TWENTY_BASE_URL: config.targetOrigin, TWENTY_AUTH_ORIGIN: config.targetOrigin, SERVER_URL: config.targetOrigin,
    PG_DATABASE_URL: config.databaseEndpoint, REDIS_URL: config.cacheEndpoint,
  });
}

function execute(script, arguments_, environment) {
  const result = spawnSync(process.execPath, [join(scriptsDirectory, script), ...arguments_], {
    env: environment, cwd: scriptsDirectory, stdio: 'inherit',
  });
  if (result.error || result.status !== 0) throw new Error(`Isolated ${script} failed; preserve private state for recovery`);
}

export async function runIsolatedSeed(input, environment = process.env, { run = execute, load = readFile } = {}) {
  const config = validateIsolation(input, environment);
  const commands = commandPlan(config);
  if (!input.apply) return { mode: 'dry-run', scope: config, commands, warning: 'Declared endpoints only: independently verify the server actually uses these isolated DB/cache services before --apply.' };
  await inspectIsolationState(config);
  const child = childEnvironment(config, environment);
  await initializeIsolationState(config);
  const lockPath = join(config.stateDirectory, 'seed.lock');
  const lock = await open(lockPath, 'wx', 0o600).catch(() => { throw new Error('Another isolated seed may be running; inspect seed.lock before recovery'); });
  try {
    for (const [script, ...arguments_] of commands) {
      const reportIndex = arguments_.indexOf('--report');
      if (reportIndex !== -1) {
        const report = await open(arguments_[reportIndex + 1], 'a', 0o600);
        await report.close();
      }
      await run(script, arguments_, child);
      if (script === 'bootstrap.mjs') {
        const state = JSON.parse(await load(join(config.stateDirectory, 'bootstrap-secrets.json'), 'utf8'));
        if (state.target !== config.targetOrigin || !state.TWENTY_API_KEY || !state.TWENTY_WORKSPACE_ID)
          throw new Error('Bootstrap returned state for a different isolated target');
        child.TWENTY_API_KEY = state.TWENTY_API_KEY;
        child.TWENTY_WORKSPACE_ID = state.TWENTY_WORKSPACE_ID;
      }
      if (script === 'team.mjs') {
        const state = JSON.parse(await load(join(config.stateDirectory, 'team-credentials.json'), 'utf8'));
        const member = state.members?.find((candidate) => candidate.completed);
        if (state.target !== config.targetOrigin || state.workspaceId !== child.TWENTY_WORKSPACE_ID || !member?.email || !member.password)
          throw new Error('Team returned state for a different isolated workspace');
        child.DEMO_SMOKE_EMAIL = member.email;
        child.DEMO_SMOKE_PASSWORD = member.password;
      }
    }
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
  return { mode: 'complete', targetOrigin: config.targetOrigin, stateDirectory: config.stateDirectory, profile: 'smoke', members: 3 };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: {
    'project-id': { type: 'string' }, environment: { type: 'string' },
    'secret-path': { type: 'string' }, 'target-origin': { type: 'string' },
    'state-dir': { type: 'string' }, 'database-url': { type: 'string' }, 'cache-url': { type: 'string' },
    apply: { type: 'boolean', default: false },
  } });
  const result = await runIsolatedSeed({
    projectId: values['project-id'], environment: values.environment, secretPath: values['secret-path'],
    targetOrigin: values['target-origin'], stateDirectory: values['state-dir'],
    databaseUrl: values['database-url'], cacheUrl: values['cache-url'], apply: values.apply,
  });
  console.log(JSON.stringify(result, null, 2));
}
