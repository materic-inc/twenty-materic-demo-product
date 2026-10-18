import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createClient } from './client.mjs';

const { values } = parseArgs({
  options: {
    'owner-state': { type: 'string' },
    'expected-members': { type: 'string', default: '81' },
    report: { type: 'string' },
  },
});
if (!values['owner-state']) throw new Error('--owner-state is required');
const state = JSON.parse(
  await readFile(resolve(values['owner-state']), 'utf8'),
);
const baseUrl = process.env.TWENTY_BASE_URL;
if (!baseUrl || state.TWENTY_WORKSPACE_ID !== process.env.TWENTY_WORKSPACE_ID)
  throw new Error('Expected demo workspace scope required');
const client = createClient({
  baseUrl,
  token: state.TWENTY_OWNER_ACCESS_TOKEN,
});
const response = await client.graphql(
  'query DemoMemberRoles { currentUser { onboardingStatus workspaceMembers { id userEmail roles { label canUpdateAllSettings } } } }',
);
assert.equal(response.currentUser.onboardingStatus, 'COMPLETED');
const members = response.currentUser.workspaceMembers;
if (Number(values['expected-members']))
  assert.equal(members.length, Number(values['expected-members']));
const staff = members.filter((member) =>
  member.userEmail.endsWith('@meridian.example'),
);
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
    'query DemoAuditMemberState { currentUser { onboardingStatus workspaceMember { roles { label canUpdateAllSettings } } } }',
  );
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
