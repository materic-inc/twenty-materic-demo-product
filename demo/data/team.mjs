import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { createHmac, randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createClient } from './client.mjs';
import { teamDirectory } from './dataset.mjs';

const { values } = parseArgs({
  options: {
    count: { type: 'string', default: '80' },
    'state-dir': {
      type: 'string',
      default: join(homedir(), '.local', 'share', 'twenty-stuard-demo-product'),
    },
  },
});
const {
  TWENTY_BASE_URL: baseUrl,
  TWENTY_API_KEY: token,
  TWENTY_WORKSPACE_ID: workspaceId,
  TWENTY_DEMO_PASSWORD_SEED: passwordSeed,
} = process.env;
if (!baseUrl || !token || !workspaceId || !passwordSeed)
  throw new Error(
    'TWENTY_BASE_URL, TWENTY_API_KEY, TWENTY_WORKSPACE_ID, TWENTY_DEMO_PASSWORD_SEED are required; inject the seed from scoped Infisical dev secrets',
  );
if (
  JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
    .workspaceId !== workspaceId
)
  throw new Error('API credential belongs to a different workspace');
const directory = resolve(values['state-dir']);
await mkdir(directory, { recursive: true, mode: 0o700 });
const file = join(directory, 'team-credentials.json');
let state = { target: baseUrl, workspaceId, members: [] };
try {
  state = JSON.parse(await readFile(file, 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
if (state.target !== baseUrl || state.workspaceId !== workspaceId)
  throw new Error('Credential state belongs to another target');
const client = createClient({ baseUrl, token });
const invitationStatePath = join(directory, 'invitation-state.json');
const restoreInvite = (originalState) =>
  client.graphql(
    'mutation DemoRestoreInvite($data:UpdateWorkspaceInput!) { updateWorkspace(data:$data) { id } }',
    {
      data: {
        inviteHash: originalState.inviteHash,
        isPublicInviteLinkEnabled: originalState.isPublicInviteLinkEnabled,
      },
    },
  );
try {
  const interrupted = JSON.parse(await readFile(invitationStatePath, 'utf8'));
  if (interrupted.target !== baseUrl || interrupted.workspaceId !== workspaceId)
    throw new Error(
      'Pending invitation recovery belongs to a different workspace',
    );
  await restoreInvite(interrupted.original);
  await unlink(invitationStatePath);
  console.log('Restored invitation state after interrupted provisioning.');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const original = await client.graphql(
  'query DemoInviteState { currentWorkspace { id inviteHash isPublicInviteLinkEnabled } }',
);
const inviteHash = randomBytes(24).toString('hex');
const persist = () =>
  writeFile(file, JSON.stringify(state, null, 2), { mode: 0o600 });
const count = Number(values.count);
if (!Number.isInteger(count) || count < 1 || count > 250)
  throw new Error('Count must be 1..250');
await writeFile(
  invitationStatePath,
  JSON.stringify({
    target: baseUrl,
    workspaceId,
    original: original.currentWorkspace,
  }),
  { mode: 0o600 },
);
await client.graphql(
  'mutation DemoEnableInvite($data:UpdateWorkspaceInput!) { updateWorkspace(data:$data) { id } }',
  { data: { inviteHash, isPublicInviteLinkEnabled: true } },
);
try {
  for (const staff of teamDirectory(count)) {
    let record = state.members.find((member) => member.email === staff.email);
    if (record?.completed) continue;
    if (!record) {
      record = {
        ...staff,
        password: `D3mo!${createHmac('sha256', passwordSeed).update(staff.email).digest('base64url').slice(0, 32)}`,
        completed: false,
      };
      state.members.push(record);
      await persist();
    }
    const exists = await client.graphql(
      'query DemoStaffExists($email:String!) { checkUserExists(email:$email) { exists } }',
      { email: record.email },
      null,
    );
    let loginToken;
    if (exists.checkUserExists.exists) {
      const signedIn = await client.graphql(
        'mutation DemoStaffLogin($email:String!,$password:String!,$origin:String!) { getLoginTokenFromCredentials(email:$email,password:$password,origin:$origin) { loginToken { token } } }',
        {
          email: record.email,
          password: record.password,
          origin: process.env.TWENTY_AUTH_ORIGIN || new URL(baseUrl).origin,
        },
        null,
      );
      loginToken = signedIn.getLoginTokenFromCredentials.loginToken.token;
    } else {
      const signedUp = await client.graphql(
        'mutation DemoTeamSignup($email:String!,$password:String!,$workspaceId:UUID,$workspaceInviteHash:String) { signUpInWorkspace(email:$email,password:$password,workspaceId:$workspaceId,workspaceInviteHash:$workspaceInviteHash) { loginToken { token } } }',
        {
          email: record.email,
          password: record.password,
          workspaceId,
          workspaceInviteHash: inviteHash,
        },
        null,
      );
      loginToken = signedUp.signUpInWorkspace.loginToken.token;
    }
    const auth = await client.graphql(
      'mutation DemoTeamTokens($loginToken:String!,$origin:String!) { getAuthTokensFromLoginToken(loginToken:$loginToken,origin:$origin) { tokens { accessOrWorkspaceAgnosticToken { token } } } }',
      {
        loginToken,
        origin: process.env.TWENTY_AUTH_ORIGIN || new URL(baseUrl).origin,
      },
      null,
    );
    const accessToken =
      auth.getAuthTokensFromLoginToken.tokens.accessOrWorkspaceAgnosticToken
        .token;
    const ownClient = createClient({ baseUrl, token: accessToken });
    const response = await ownClient.request(
      `/rest/workspaceMembers?filter=${encodeURIComponent(`userEmail[eq]:${record.email}`)}&depth=0`,
    );
    const member = response.data?.workspaceMembers?.find(
      (candidate) => candidate.userEmail === record.email,
    );
    if (!member)
      throw new Error(
        `No workspace member created for staff index ${record.index}`,
      );
    await ownClient.graphql(
      'mutation DemoTeamProfile($input:UpdateWorkspaceMemberSettingsInput!) { updateWorkspaceMemberSettings(input:$input) }',
      {
        input: {
          workspaceMemberId: member.id,
          update: { name: record.name, locale: 'en' },
        },
      },
    );
    await ownClient.graphql(
      'mutation DemoTeamOnboarding { skipSyncEmailOnboardingStep { success } }',
    );
    record.workspaceMemberId = member.id;
    record.completed = true;
    await persist();
    console.log(
      `Provisioned staff ${record.index + 1}/${count}: ${record.department}`,
    );
  }
} finally {
  await restoreInvite(original.currentWorkspace);
  await unlink(invitationStatePath);
}
console.log(
  `Staff credentials derived from the Infisical seed and saved privately at ${file}; do not commit this file.`,
);
