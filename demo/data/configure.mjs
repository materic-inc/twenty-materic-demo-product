import { createClient, listMetadata } from './client.mjs';
import { idFor } from './dataset.mjs';
import { configureDashboards } from './dashboards.mjs';

const {
  TWENTY_BASE_URL: baseUrl,
  TWENTY_API_KEY: token,
  TWENTY_WORKSPACE_ID: workspaceId,
} = process.env;
if (!baseUrl || !token || !workspaceId)
  throw new Error(
    'TWENTY_BASE_URL, TWENTY_API_KEY, TWENTY_WORKSPACE_ID are required',
  );
const tokenPayload = JSON.parse(
  Buffer.from(token.split('.')[1], 'base64url').toString(),
);
if (tokenPayload.workspaceId !== workspaceId)
  throw new Error('API credential belongs to a different workspace');
const client = createClient({ baseUrl, token });
let metadata = await listMetadata(client);
const customFields = [
  ['employees', 'Employees', 'NUMBER', 'IconUsers'],
  ['industry', 'Industry', 'TEXT', 'IconBuildingFactory2'],
  ['region', 'Region', 'TEXT', 'IconWorld'],
  ['accountHealth', 'Account health', 'TEXT', 'IconHeartRateMonitor'],
  ['customerTier', 'Customer tier', 'TEXT', 'IconBuildingSkyscraper'],
  ['idealCustomerProfile', 'Ideal customer profile', 'BOOLEAN', 'IconTarget'],
];
const ensureField = async (objectName, [name, label, type, icon]) => {
  if (metadata[objectName].fields[name]) return;
  await client.graphql(
    'mutation DemoField($input:CreateOneFieldMetadataInput!) { createOneField(input:$input) { id } }',
    {
      input: {
        field: {
          objectMetadataId: metadata[objectName].id,
          name,
          label,
          type,
          icon,
          isNullable: true,
          isActive: true,
        },
      },
    },
  );
  console.log(`Configured ${objectName} field: ${name}`);
};
for (const field of customFields) await ensureField('companies',field);
await ensureField('people',['city','City','TEXT','IconMapPin']);
metadata = await listMetadata(client);
const plans = [
  {
    name: 'Enterprise accounts',
    object: 'companies',
    icon: 'IconBuildingSkyscraper',
    columns: [
      'name',
      'domainName',
      'employees',
      'annualRevenue',
      'industry',
      'accountOwner',
      'accountHealth',
    ],
    filters: [['customerTier', 'IS', 'Enterprise']],
  },
  {
    name: 'Accounts needing attention',
    object: 'companies',
    icon: 'IconAlertTriangle',
    columns: [
      'name',
      'accountHealth',
      'accountOwner',
      'customerTier',
      'industry',
      'region',
    ],
    filters: [['accountHealth', 'IS_NOT', 'Healthy']],
  },
  {
    name: 'North America',
    object: 'companies',
    icon: 'IconWorld',
    columns: [
      'name',
      'domainName',
      'employees',
      'annualRevenue',
      'accountOwner',
      'region',
    ],
    filters: [['region', 'IS', 'North America']],
  },
  {
    name: 'EMEA accounts',
    object: 'companies',
    icon: 'IconWorld',
    columns: [
      'name',
      'domainName',
      'employees',
      'annualRevenue',
      'accountOwner',
      'region',
    ],
    filters: [['region', 'IS', 'EMEA']],
  },
  {
    name: 'Enterprise pipeline',
    object: 'opportunities',
    icon: 'IconChartBar',
    type: 'KANBAN',
    group: 'stage',
    columns: [
      'name',
      'amount',
      'company',
      'pointOfContact',
      'owner',
      'closeDate',
    ],
    filters: [],
  },
  {
    name: 'Proposals in review',
    object: 'opportunities',
    icon: 'IconFileDescription',
    columns: ['name', 'company', 'amount', 'owner', 'closeDate'],
    filters: [['stage', 'IS', ['PROPOSAL']]],
  },
  {
    name: 'Customer contracts',
    object: 'opportunities',
    icon: 'IconCircleCheck',
    columns: ['name', 'company', 'amount', 'owner', 'closeDate'],
    filters: [['stage', 'IS', ['CUSTOMER']]],
  },
  {
    name: 'Open follow-ups',
    object: 'tasks',
    icon: 'IconCheckbox',
    columns: ['title', 'status', 'dueAt', 'assignee', 'createdAt'],
    filters: [['status', 'IS_NOT', ['DONE']]],
  },
  {
    name: 'Work in progress',
    object: 'tasks',
    icon: 'IconProgress',
    columns: ['title', 'status', 'dueAt', 'assignee'],
    filters: [['status', 'IS', ['IN_PROGRESS']]],
  },
  {
    name: 'Completed activities',
    object: 'tasks',
    icon: 'IconCircleCheck',
    columns: ['title', 'status', 'assignee', 'dueAt', 'updatedAt'],
    filters: [['status', 'IS', ['DONE']]],
  },
  {
    name: 'Account conversations',
    object: 'notes',
    icon: 'IconNotes',
    columns: ['title', 'createdAt', 'updatedAt', 'createdBy'],
    filters: [],
  },
];
const existing = await client.graphql(
  'query DemoViews { getViews { id name objectMetadataId viewFields { id fieldMetadataId } viewFilters { id fieldMetadataId } } }',
);
for (let index = 0; index < plans.length; index++) {
  const plan = plans[index];
  const object = metadata[plan.object];
  let view = existing.getViews.find(
    (candidate) =>
      candidate.name === plan.name && candidate.objectMetadataId === object.id,
  );
  if (!view) {
    const result = await client.graphql(
      'mutation DemoView($input:CreateViewInput!) { createView(input:$input) { id } }',
      {
        input: {
          id: idFor('view', index),
          name: plan.name,
          objectMetadataId: object.id,
          type: plan.type || 'TABLE',
          icon: plan.icon,
          position: 10 + index,
          visibility: 'WORKSPACE',
          ...(plan.group
            ? { mainGroupByFieldMetadataId: object.fields[plan.group].id }
            : {}),
        },
      },
    );
    view = { id: result.createView.id, viewFields: [], viewFilters: [] };
  }
  for (let position = 0; position < plan.columns.length; position++) {
    const field = object.fields[plan.columns[position]];
    if (
      !field ||
      view.viewFields.some(
        (candidate) => candidate.fieldMetadataId === field.id,
      )
    )
      continue;
    await client.graphql(
      'mutation DemoViewField($input:CreateViewFieldInput!) { createViewField(input:$input) { id } }',
      {
        input: {
          viewId: view.id,
          fieldMetadataId: field.id,
          isVisible: true,
          position,
          size: position === 0 ? 300 : 170,
        },
      },
    );
  }
  for (const [name, operand, value] of plan.filters) {
    const field = object.fields[name];
    if (
      view.viewFilters.some(
        (candidate) => candidate.fieldMetadataId === field.id,
      )
    )
      continue;
    await client.graphql(
      'mutation DemoViewFilter($input:CreateViewFilterInput!) { createViewFilter(input:$input) { id } }',
      {
        input: {
          viewId: view.id,
          fieldMetadataId: field.id,
          operand:
            field.type === 'TEXT'
              ? operand === 'IS'
                ? 'CONTAINS'
                : operand === 'IS_NOT'
                  ? 'DOES_NOT_CONTAIN'
                  : operand
              : operand,
          value: Array.isArray(value) ? JSON.stringify(value) : value,
        },
      },
    );
  }
  console.log(`Configured view: ${plan.name}`);
}

await configureDashboards(client, metadata);
