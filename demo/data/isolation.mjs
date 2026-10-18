import { lstat, mkdir, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const hostedState = join(homedir(), '.local/share/twenty-stuard-demo-product');
const manifestName = 'isolation.json';
const scopeKeys = ['projectId', 'environment', 'secretPath', 'targetOrigin', 'stateDirectory', 'databaseEndpoint', 'cacheEndpoint'];

function endpoint(value, protocols, name, originOnly = false) {
  if (typeof value !== 'string' || value !== value.trim())
    throw new Error(`${name} is required`);
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error(`${name} is invalid`); }
  const authority = value.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i)?.[1];
  const host = authority?.split('@').at(-1)?.replace(/:\d+$/, '');
  if (!protocols.includes(parsed.protocol) || !['127.0.0.1', '[::1]'].includes(host))
    throw new Error(`${name} must use a literal loopback address`);
  if (parsed.search || parsed.hash || (originOnly && (parsed.username || parsed.password || parsed.pathname !== '/')))
    throw new Error(`${name} must not contain credentials, query, fragment or a non-origin path`);
  parsed.username = '';
  parsed.password = '';
  return originOnly ? parsed.origin : parsed.href;
}

function within(path, parent) {
  const difference = relative(parent, path);
  return difference === '' || (!difference.startsWith('..') && !isAbsolute(difference));
}

export function validateIsolation(input, environment = {}) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.projectId || ''))
    throw new Error('An explicit Infisical project UUID is required');
  if (input.environment !== 'dev') throw new Error('Isolation requires Infisical environment dev');
  if (!/^\/twenty-stuard-demo-product-isolated\/[a-z0-9][a-z0-9-]{0,63}$/.test(input.secretPath || ''))
    throw new Error('Isolation requires a dedicated /twenty-stuard-demo-product-isolated/<run-id> secret path');
  const targetOrigin = endpoint(input.targetOrigin, ['http:', 'https:'], 'Target origin', true);
  const databaseEndpoint = endpoint(input.databaseUrl, ['postgres:', 'postgresql:'], 'Database URL');
  const cacheEndpoint = endpoint(input.cacheUrl, ['redis:', 'rediss:'], 'Cache URL');
  if (environment.TWENTY_TRANSPORT_URL !== undefined)
    throw new Error('Unset TWENTY_TRANSPORT_URL for isolation');
  for (const name of ['TWENTY_BASE_URL', 'TWENTY_AUTH_ORIGIN', 'SERVER_URL']) {
    if (environment[name] !== undefined && endpoint(environment[name], ['http:', 'https:'], name, true) !== targetOrigin)
      throw new Error(`${name} does not match the isolated target origin`);
  }
  for (const [name, expected, protocols] of [
    ['PG_DATABASE_URL', databaseEndpoint, ['postgres:', 'postgresql:']],
    ['REDIS_URL', cacheEndpoint, ['redis:', 'rediss:']],
  ]) {
    if (environment[name] !== undefined && endpoint(environment[name], protocols, name) !== expected)
      throw new Error(`${name} does not match the declared isolated endpoint`);
  }
  if (!input.stateDirectory || !isAbsolute(input.stateDirectory))
    throw new Error('An explicit absolute private state directory is required');
  const stateDirectory = resolve(input.stateDirectory);
  if (within(stateDirectory, repository) || within(stateDirectory, hostedState) || stateDirectory === homedir() || stateDirectory === '/')
    throw new Error('Use a dedicated state directory outside Git and hosted state');
  return Object.freeze({
    version: 1, projectId: input.projectId, environment: input.environment,
    secretPath: input.secretPath, targetOrigin, stateDirectory, databaseEndpoint, cacheEndpoint,
  });
}

export function isolationFromEnvironment(environment = process.env) {
  if (environment.TWENTY_ISOLATED === undefined) return null;
  if (environment.TWENTY_ISOLATED !== '1') throw new Error('Invalid explicit isolation mode');
  return validateIsolation({
    projectId: environment.TWENTY_ISOLATED_PROJECT_ID,
    environment: environment.TWENTY_ISOLATED_ENVIRONMENT,
    secretPath: environment.TWENTY_ISOLATED_SECRET_PATH,
    targetOrigin: environment.TWENTY_ISOLATED_TARGET_ORIGIN,
    stateDirectory: environment.TWENTY_ISOLATED_STATE_DIRECTORY,
    databaseUrl: environment.PG_DATABASE_URL,
    cacheUrl: environment.REDIS_URL,
  }, environment);
}

export function assertIsolationRequest(config, value) {
  const parsed = new URL(value);
  if (parsed.origin !== config.targetOrigin || parsed.username || parsed.password)
    throw new Error('Isolated request must stay on the exact target origin and port');
  endpoint(parsed.origin, ['http:', 'https:'], 'Request origin', true);
}

function assertPrivate(metadata, directory = false) {
  if (metadata.isSymbolicLink() || (directory ? !metadata.isDirectory() : !metadata.isFile()) || (metadata.mode & 0o077) || metadata.uid !== process.getuid())
    throw new Error('Isolated state must be private, owned by the current user and contain no symlinks');
}

export async function inspectIsolationState(config) {
  let ancestor = config.stateDirectory;
  while (true) {
    try {
      const canonical = await realpath(ancestor);
      if (canonical !== ancestor) throw new Error('State path must use its real path without symlink ancestors');
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      ancestor = dirname(ancestor);
    }
  }
  for (let path = ancestor; ; path = dirname(path)) {
    try {
      await lstat(join(path, '.git'));
      throw new Error('Isolated state must stay outside every Git checkout');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (dirname(path) === path) break;
  }
  let metadata;
  try { metadata = await lstat(config.stateDirectory); }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  assertPrivate(metadata, true);
  const entries = await readdir(config.stateDirectory);
  if (!entries.length) return false;
  if (!entries.includes(manifestName)) throw new Error('Unmarked existing state cannot be reused for isolation');
  for (const entry of entries) assertPrivate(await lstat(join(config.stateDirectory, entry)));
  const manifest = JSON.parse(await readFile(join(config.stateDirectory, manifestName), 'utf8'));
  if (manifest.version !== 1 || scopeKeys.some((key) => manifest[key] !== config[key]))
    throw new Error('Isolated state belongs to a different run, target or secret scope');
  return true;
}

export async function initializeIsolationState(config) {
  if (await inspectIsolationState(config)) return;
  await mkdir(config.stateDirectory, { recursive: true, mode: 0o700 });
  assertPrivate(await lstat(config.stateDirectory), true);
  await writeFile(join(config.stateDirectory, manifestName), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
}

export async function assertIsolatedScriptState(config, directory) {
  if (!config) return;
  if (resolve(directory) !== config.stateDirectory || !await inspectIsolationState(config))
    throw new Error('Run isolated scripts through isolated-seed.mjs with its bound state directory');
}
