import { mkdir, readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';
import { createClient } from './client.mjs';

const { values } = parseArgs({
  options: {
    'state-dir': {
      type: 'string',
      default: join(homedir(), '.local', 'share', 'twenty-stuard-demo-product'),
    },
  },
});
const { TWENTY_BASE_URL: baseUrl, TWENTY_OWNER_PASSWORD: password } =
  process.env;
const email =
  process.env.TWENTY_OWNER_EMAIL || 'alex.morgan@meridian-cloud.example';
const workspaceName = 'Meridian Cloud';
if (!baseUrl || !password)
  throw new Error(
    'TWENTY_BASE_URL and Infisical-injected TWENTY_OWNER_PASSWORD are required',
  );
const authOrigin = process.env.TWENTY_AUTH_ORIGIN || new URL(baseUrl).origin;
const directory = resolve(values['state-dir']);
await mkdir(directory, { recursive: true, mode: 0o700 });
const secretsPath = join(directory, 'bootstrap-secrets.json');
let saved;
try {
  saved = JSON.parse(await readFile(secretsPath, 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
if (saved && (saved.target !== baseUrl || saved.ownerEmail !== email))
  throw new Error('Bootstrap state belongs to a different target or owner');
const client = createClient({ baseUrl });
const existence = await client.graphql(
  'query DemoOwnerExists($email:String!) { checkUserExists(email:$email) { exists } }',
  { email },
  null,
);
const operation = existence.checkUserExists.exists ? 'signIn' : 'signUp';
const session = await client.graphql(
  `mutation DemoOwnerAuthentication($email:String!,$password:String!) { ${operation}(email:$email,password:$password) { tokens { accessOrWorkspaceAgnosticToken { token } } availableWorkspaces { availableWorkspacesForSignIn { id displayName loginToken } availableWorkspacesForSignUp { id displayName } } } }`,
  { email, password },
  null,
);
const authentication = session[operation];
const existing =
  authentication.availableWorkspaces.availableWorkspacesForSignIn;
let workspace =
  existing.find((candidate) => candidate.id === saved?.TWENTY_WORKSPACE_ID) ||
  existing.find((candidate) => candidate.displayName === workspaceName);
if (!workspace && existing.length)
  throw new Error(
    'Owner already belongs to another workspace; refusing to create an unexpected extra workspace',
  );
if (!workspace) {
  const created = await client.graphql(
    'mutation DemoCreateWorkspace($input:SignUpInNewWorkspaceInput) { signUpInNewWorkspace(input:$input) { loginToken { token } workspace { id } } }',
    { input: { displayName: workspaceName } },
    authentication.tokens.accessOrWorkspaceAgnosticToken.token,
  );
  workspace = {
    id: created.signUpInNewWorkspace.workspace.id,
    loginToken: created.signUpInNewWorkspace.loginToken.token,
  };
}
if (
  process.env.TWENTY_WORKSPACE_ID &&
  process.env.TWENTY_WORKSPACE_ID !== workspace.id
)
  throw new Error(
    'Existing owner workspace differs from expected TWENTY_WORKSPACE_ID',
  );
const auth = await client.graphql(
  'mutation DemoOwnerWorkspaceToken($loginToken:String!,$origin:String!) { getAuthTokensFromLoginToken(loginToken:$loginToken,origin:$origin) { tokens { accessOrWorkspaceAgnosticToken { token } } } }',
  { loginToken: workspace.loginToken, origin: authOrigin },
  null,
);
const ownerToken =
  auth.getAuthTokensFromLoginToken.tokens.accessOrWorkspaceAgnosticToken.token;
const ownerClient = createClient({ baseUrl, token: ownerToken });
const initial = await ownerClient.graphql(
  'query DemoWorkspaceState { currentWorkspace { id displayName activationStatus } }',
);
if (
  !['ACTIVE', 'CREATED'].includes(initial.currentWorkspace.activationStatus)
) {
  console.log('Initializing Twenty workspace and standard application...');
  await ownerClient.graphql(
    'mutation DemoActivateWorkspace { activateWorkspace(data:{}) { id activationStatus } }',
  );
}
const members = await ownerClient.request(
  '/rest/workspaceMembers?limit=100&depth=0',
);
const owner = members.data.workspaceMembers.find(
  (member) => member.userEmail === email,
);
if (!owner)
  throw new Error('Owner workspace member was not created during activation');
await ownerClient.graphql(
  'mutation DemoOwnerProfile($input:UpdateWorkspaceMemberSettingsInput!) { updateWorkspaceMemberSettings(input:$input) }',
  {
    input: {
      workspaceMemberId: owner.id,
      update: { name: { firstName: 'Alex', lastName: 'Morgan' }, locale: 'en' },
    },
  },
);
await ownerClient.graphql(
  'mutation DemoSkipEmail { skipSyncEmailOnboardingStep { success } }',
);
const roles = await ownerClient.graphql(
  'query DemoKeyRoles { getApiKeyRoles { id label } }',
);
const admin = roles.getApiKeyRoles.find(
  (role) => role.label.toLowerCase() === 'admin',
);
if (!admin) throw new Error('No API-assignable Admin role found');
const keys = await ownerClient.graphql(
  'query DemoExistingKeys { apiKeys { id name expiresAt } }',
);
let key = keys.apiKeys.find(
  (candidate) =>
    candidate.name === 'Meridian Cloud demo seeder' &&
    Date.parse(candidate.expiresAt) > Date.now() + 86400000,
);
const expiresAt = new Date(Date.now() + 365 * 86400000).toISOString();
if (!key) {
  const created = await ownerClient.graphql(
    'mutation DemoCreateKey($input:CreateApiKeyInput!) { createApiKey(input:$input) { id expiresAt } }',
    {
      input: {
        name: 'Meridian Cloud demo seeder',
        expiresAt,
        roleId: admin.id,
      },
    },
  );
  key = created.createApiKey;
}
const generated = await ownerClient.graphql(
  'mutation DemoGenerateKey($apiKeyId:UUID!,$expiresAt:String!) { generateApiKeyToken(apiKeyId:$apiKeyId,expiresAt:$expiresAt) { token } }',
  { apiKeyId: key.id, expiresAt: key.expiresAt },
);
await writeFile(
  secretsPath,
  JSON.stringify(
    {
      target: baseUrl,
      ownerEmail: email,
      TWENTY_WORKSPACE_ID: workspace.id,
      TWENTY_API_KEY: generated.generateApiKeyToken.token,
      TWENTY_OWNER_ACCESS_TOKEN: ownerToken,
      ownerWorkspaceMemberId: owner.id,
      apiKeyId: key.id,
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'twenty-bootstrap-'));
try {
  const environmentPath = join(temporaryDirectory, 'secrets.env');
  await writeFile(
    environmentPath,
    [
      `TWENTY_API_KEY=${JSON.stringify(generated.generateApiKeyToken.token)}`,
      `TWENTY_WORKSPACE_ID=${JSON.stringify(workspace.id)}`,
      'TWENTY_BASE_URL="https://twenty-stuard-demo-product.materic.inc"',
    ].join('\n') + '\n',
    { mode: 0o600 },
  );
  const stored = spawnSync(
    'infisical',
    [
      'secrets',
      'set',
      '--projectId',
      'c41f4ae6-3f02-4165-a4a4-3ea9043a6e6c',
      '--env',
      'dev',
      '--path',
      '/twenty-stuard-demo-product',
      '--file',
      environmentPath,
      '--silent',
    ],
    { encoding: 'utf8' },
  );
  if (stored.status !== 0)
    throw new Error(
      `Infisical persistence failed (exit ${stored.status}); recover from the private bootstrap state before continuing`,
    );
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
console.log(
  `Workspace ready: ${workspaceName} (${workspace.id}). Owner: ${email}.`,
);
console.log(
  `API credential saved privately at ${secretsPath}. Persisted TWENTY_API_KEY, TWENTY_WORKSPACE_ID and canonical TWENTY_BASE_URL to Infisical Apps dev /twenty-stuard-demo-product.`,
);
