import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { createClient, listMetadata } from './client.mjs';
import { buildDashboardPlans } from './dashboards.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { PROFILES, idFor, buildDataset, DEFAULT_AS_OF } from './dataset.mjs';

const { values } = parseArgs({
  options: {
    profile: { type: 'string', default: 'full' },
    samples: { type: 'string', default: '12' },
    'as-of': { type: 'string', default: DEFAULT_AS_OF },
    report: { type: 'string' },
  },
});
const { TWENTY_BASE_URL: baseUrl, TWENTY_API_KEY: token } = process.env;
if (!baseUrl || !token)
  throw new Error('TWENTY_BASE_URL and TWENTY_API_KEY are required');
const client = createClient({ baseUrl, token });
const baseline = buildDataset({
  profile: values.profile,
  asOf: values['as-of'],
});
const report = {
  profile: values.profile,
  asOf: values['as-of'],
  target: baseUrl,
  verifiedAt: new Date().toISOString(),
  counts: {},
  dateSamples: [],
  charts: [],
};
const assertDates = (kind, record) => {
  const expected = baseline[kind].find((row) => row.id === record.id);
  report.dateSamples.push({
    kind,
    id: record.id,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  });
  assert.equal(
    new Date(record.createdAt).toISOString(),
    expected.createdAt,
    `${kind} ${record.id}: historical creation date did not persist`,
  );
  assert.equal(
    new Date(record.updatedAt).toISOString(),
    expected.updatedAt,
    `${kind} ${record.id}: historical update date did not persist`,
  );
};
const expected = {
  ...PROFILES[values.profile],
  taskTargets: PROFILES[values.profile].tasks * 3,
  noteTargets: PROFILES[values.profile].notes * 3,
};
for (const [kind, count] of Object.entries(expected)) {
  const response = await client.request(`/rest/${kind}?limit=1&depth=0`);
  assert.ok(
    response.totalCount >= count,
    `${kind}: expected at least ${count}, received ${response.totalCount}`,
  );
  report.counts[kind] = response.totalCount;
  console.log(`${kind}: ${response.totalCount} persisted records`);
}
const find = async (plural, id) => {
  const response = await client.request(
    `/rest/${plural}?filter=${encodeURIComponent(`id[eq]:${id}`)}&depth=0`,
  );
  assert.equal(response.totalCount, 1, `Missing ${plural} ${id}`);
  return response.data[plural][0];
};
for (let sample = 0; sample < Number(values.samples); sample++) {
  const index = Math.floor(
    (sample * expected.opportunities) / Number(values.samples),
  );
  const opportunity = await find('opportunities', idFor('opportunity', index));
  const company = await find('companies', opportunity.companyId);
  const person = await find('people', opportunity.pointOfContactId);
  assertDates('companies', company);
  assertDates('people', person);
  assertDates('opportunities', opportunity);
  assert.equal(person.companyId, company.id);
  assert.ok(person.emails.primaryEmail.endsWith('.example'));
  assert.ok(Number(opportunity.amount.amountMicros) > 0);
  for (const kind of ['task', 'note']) {
    const record = await find(`${kind}s`, idFor(kind, index));
    assertDates(`${kind}s`, record);
    assert.ok(record.bodyV2.markdown.includes(company.name));
    const targets = await client.request(
      `/rest/${kind}Targets?filter=${encodeURIComponent(`${kind}Id[eq]:${record.id}`)}&depth=0`,
    );
    assert.equal(targets.totalCount, 3);
    assert.ok(
      targets.data[`${kind}Targets`].some(
        (target) => target.targetCompanyId === company.id,
      ),
    );
    assert.ok(
      targets.data[`${kind}Targets`].some(
        (target) => target.targetPersonId === person.id,
      ),
    );
    assert.ok(
      targets.data[`${kind}Targets`].some(
        (target) => target.targetOpportunityId === opportunity.id,
      ),
    );
  }
}
const staff = await client.request('/rest/workspaceMembers?limit=100&depth=0');
assert.equal(staff.totalCount, 81, 'Expected exactly 80 staff plus the owner');
report.counts.workspaceMembers = staff.totalCount;
console.log(`Workspace members: ${staff.totalCount}`);
const metadata = await listMetadata(client);
const plans = buildDashboardPlans(metadata);
for (let dashboardIndex = 0; dashboardIndex < plans.length; dashboardIndex++) {
  const dashboard = await find(
    'dashboards',
    idFor('dashboard', dashboardIndex),
  );
  const tabs = await client.graphql(
    'query DemoVerifyDashboard($pageLayoutId:String!) { getPageLayoutTabs(pageLayoutId:$pageLayoutId) { id widgets { id title } } }',
    { pageLayoutId: dashboard.pageLayoutId },
  );
  const widgetCount = tabs.getPageLayoutTabs.reduce(
    (total, tab) => total + (tab.widgets?.length || 0),
    0,
  );
  assert.equal(
    widgetCount,
    plans[dashboardIndex].widgets.length,
    `Unexpected widget count for ${dashboard.title}`,
  );
  for (const widget of plans[dashboardIndex].widgets) {
    const kind = widget.configuration.configurationType;
    if (kind === 'AGGREGATE_CHART') continue;
    const chartType =
      kind === 'BAR_CHART' ? 'bar' : kind === 'PIE_CHART' ? 'pie' : 'line';
    const operation = `${chartType}ChartData`;
    const inputType = `${chartType[0].toUpperCase() + chartType.slice(1)}ChartDataInput`;
    const selection =
      chartType === 'bar'
        ? 'data'
        : chartType === 'pie'
          ? 'data { key value }'
          : 'series { key data { x y } }';
    const result = await client.graphql(
      `query DemoVerifyChart($input:${inputType}!) { ${operation}(input:$input) { ${selection} } }`,
      {
        input: {
          objectMetadataId: metadata[widget.object].id,
          configuration: widget.configuration,
        },
      },
    );
    const chart = result[operation];
    const pointCount =
      chartType === 'line'
        ? chart.series.reduce((total, series) => total + series.data.length, 0)
        : chart.data.length;
    assert.ok(pointCount > 0, `Empty chart: ${widget.title}`);
    report.charts.push({
      dashboard: dashboard.title,
      title: widget.title,
      pointCount,
    });
  }
}
const reportPath = resolve(
  values.report ||
    join(
      homedir(),
      '.local',
      'share',
      'twenty-stuard-demo-product',
      `verification-${values.profile}.json`,
    ),
);
await mkdir(dirname(reportPath), { recursive: true, mode: 0o700 });
report.status = 'passed';
await writeFile(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(`Nonsecret verification report: ${reportPath}`);
console.log(
  'Independent server-side counts, amounts and sampled relationship chains verified.',
);
