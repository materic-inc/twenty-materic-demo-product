import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createClient } from './client.mjs';
import { isolationFromEnvironment, assertIsolatedScriptState } from './isolation.mjs';

const { values } = parseArgs({
  options: {
    'owner-state': { type: 'string' },
    'expected-members': { type: 'string', default: '81' },
    report: { type: 'string' },
  },
});
if (!values['owner-state']) throw new Error('--owner-state is required');
const isolation = isolationFromEnvironment();
if (isolation) {
  await assertIsolatedScriptState(isolation, isolation.stateDirectory);
  if (resolve(values['owner-state']) !== join(isolation.stateDirectory, 'bootstrap-secrets.json'))
    throw new Error('Isolated audit requires the owner state from this exact run');
}
const state = JSON.parse(
  await readFile(resolve(values['owner-state']), 'utf8'),
);
const baseUrl = process.env.TWENTY_BASE_URL;
if (!baseUrl || state.TWENTY_WORKSPACE_ID !== process.env.TWENTY_WORKSPACE_ID)
  throw new Error('Expected demo workspace scope required');
let isolatedTeam;
let isolatedMember;
if (isolation) {
  if (state.target !== isolation.targetOrigin ||
      ['ownerEmail', 'ownerWorkspaceMemberId', 'TWENTY_WORKSPACE_ID', 'TWENTY_OWNER_ACCESS_TOKEN'].some((key) => typeof state[key] !== 'string' || !state[key]))
    throw new Error('Isolated audit requires persisted owner identity for this target');
  isolatedTeam = JSON.parse(await readFile(join(isolation.stateDirectory, 'team-credentials.json'), 'utf8'));
  if (isolatedTeam.target !== isolation.targetOrigin || isolatedTeam.workspaceId !== state.TWENTY_WORKSPACE_ID)
    throw new Error('Persisted Member state belongs to another isolated workspace');
  isolatedMember = isolatedTeam.members?.find((member) => member.completed);
  if (!isolatedMember || ['workspaceMemberId', 'email', 'password'].some((key) => typeof isolatedMember[key] !== 'string' || !isolatedMember[key]) ||
      process.env.DEMO_SMOKE_EMAIL !== isolatedMember.email || process.env.DEMO_SMOKE_PASSWORD !== isolatedMember.password)
    throw new Error('Isolated audit requires the persisted completed Member credentials');
}
const client = createClient({
  baseUrl,
  token: state.TWENTY_OWNER_ACCESS_TOKEN,
});
const response = await client.graphql(
  `query DemoMemberRoles { ${isolation ? 'currentWorkspace { id }' : ''} currentUser { onboardingStatus ${isolation ? 'workspaceMember { id userEmail }' : ''} workspaceMembers { id userEmail roles { label canUpdateAllSettings } } } }`,
);
if (isolation) {
  assert.equal(response.currentWorkspace?.id, state.TWENTY_WORKSPACE_ID, 'Owner session workspace differs from the isolated workspace');
  assert.equal(response.currentUser.workspaceMember?.id, state.ownerWorkspaceMemberId, 'Owner session identity differs from persisted owner');
  assert.equal(response.currentUser.workspaceMember?.userEmail, state.ownerEmail, 'Owner session email differs from persisted owner');
}
assert.equal(response.currentUser.onboardingStatus, 'COMPLETED');
const members = response.currentUser.workspaceMembers;
if (Number(values['expected-members']))
  assert.equal(members.length, Number(values['expected-members']));
const staff = members.filter((member) =>
  member.userEmail.endsWith('@meridian.example'),
);
if (isolation) {
  for (const completed of isolatedTeam.members.filter((member) => member.completed)) {
    assert.ok(completed.workspaceMemberId && completed.email, 'Completed Member has no persisted identity');
    assert.ok(staff.some((member) => member.id === completed.workspaceMemberId && member.userEmail === completed.email), 'Completed Member identity is absent from the isolated workspace');
  }
}
assert.ok(staff.length > 0, 'No staff accounts found');
for (const member of staff) {
  assert.ok(
    member.roles.some((role) => role.label.toLowerCase() === 'member'),
    `${member.userEmail}: Member role missing`,
  );
  assert.ok(
    member.roles.every(
      (role) =>
        role.label.toLowerCase() !== 'admin' && !role.canUpdateAllSettings,
    ),
    `${member.userEmail}: unexpected administration access`,
  );
}
const owner = members.find(
  (member) => member.userEmail === 'alex.morgan@meridian-cloud.example',
);
assert.ok(owner?.roles.some((role) => role.label.toLowerCase() === 'admin'));
const report = {
  verifiedAt: new Date().toISOString(),
  workspaceId: state.TWENTY_WORKSPACE_ID,
  totalMembers: members.length,
  staffMembers: staff.length,
  staffRole: 'Member',
  staffHaveAdministrationAccess: false,
  ownerRole: 'Admin',
  ownerOnboarding: 'COMPLETED',
};
if (process.env.DEMO_SMOKE_EMAIL && process.env.DEMO_SMOKE_PASSWORD) {
  const origin = process.env.TWENTY_AUTH_ORIGIN || new URL(baseUrl).origin;
  const signedIn = await client.graphql(
    'mutation DemoAuditMemberLogin($email:String!,$password:String!,$origin:String!) { getLoginTokenFromCredentials(email:$email,password:$password,origin:$origin) { loginToken { token } } }',
    {
      email: process.env.DEMO_SMOKE_EMAIL,
      password: process.env.DEMO_SMOKE_PASSWORD,
      origin,
    },
    null,
  );
  const tokens = await client.graphql(
    'mutation DemoAuditMemberToken($loginToken:String!,$origin:String!) { getAuthTokensFromLoginToken(loginToken:$loginToken,origin:$origin) { tokens { accessOrWorkspaceAgnosticToken { token } } } }',
    {
      loginToken: signedIn.getLoginTokenFromCredentials.loginToken.token,
      origin,
    },
    null,
  );
  const memberClient = createClient({
    baseUrl,
    token:
      tokens.getAuthTokensFromLoginToken.tokens.accessOrWorkspaceAgnosticToken
        .token,
  });
  const memberState = await memberClient.graphql(
    `query DemoAuditMemberState { ${isolation ? 'currentWorkspace { id }' : ''} currentUser { onboardingStatus workspaceMember { ${isolation ? 'id userEmail' : ''} roles { label canUpdateAllSettings } } } }`,
  );
  if (isolation) {
    assert.equal(memberState.currentWorkspace?.id, state.TWENTY_WORKSPACE_ID, 'Member session workspace differs from the isolated workspace');
    assert.equal(memberState.currentUser.workspaceMember?.id, isolatedMember.workspaceMemberId, 'Member session identity differs from persisted completed Member');
    assert.equal(memberState.currentUser.workspaceMember?.userEmail, isolatedMember.email, 'Member session email differs from persisted completed Member');
    assert.ok(memberState.currentUser.workspaceMember.roles.some((role) => role.label.toLowerCase() === 'member'), 'Authenticated isolated account must have Member role');
    assert.ok(memberState.currentUser.workspaceMember.roles.every((role) => role.label.toLowerCase() !== 'admin'), 'Authenticated isolated Member must not have Admin role');
    report.ownerSessionWorkspaceId = response.currentWorkspace.id;
    report.memberSessionWorkspaceId = memberState.currentWorkspace.id;
    report.memberWorkspaceMemberId = isolatedMember.workspaceMemberId;
  }
  assert.equal(memberState.currentUser.onboardingStatus, 'COMPLETED');
  assert.ok(
    memberState.currentUser.workspaceMember.roles.every(
      (role) => !role.canUpdateAllSettings,
    ),
  );
  report.memberOnboarding = 'COMPLETED';
  report.memberPasswordLogin = 'passed';
}
if (values.report) {
  const path = resolve(values.report);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report, null, 2));
