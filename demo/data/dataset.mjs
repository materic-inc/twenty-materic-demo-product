import { createHash } from 'node:crypto';

export const DEFAULT_AS_OF = '2026-10-18T16:00:00.000Z';
export const PROFILES = {
  smoke: { companies: 12, people: 60, opportunities: 24, tasks: 72, notes: 60 },
  full: {
    companies: 5000,
    people: 25000,
    opportunities: 8000,
    tasks: 24000,
    notes: 20000,
  },
};
const DAY = 86400000;
const FIRST_NAMES =
  'Maya James Amara Oliver Sofia Ethan Aisha Lucas Isla Noah Priya Leo Elena Daniel Zara Henry Mei Gabriel Nora Samuel Ada Benjamin Yuki Alexander Freya Jacob Anika William Chloe Liam Imani Theo Aria Isaac Leila Julian Clara Felix Nia Oscar Sienna Miles Rina Sebastian Eva Finn Hana Thomas Lucia Adrian'.split(
    ' ',
  );
const LAST_NAMES =
  'Chen Rivera Patel Williams Kim Thompson Garcia Singh Wilson Park Martinez Johnson Okafor Brown Nakamura Davis Santos Anderson Tan Robinson Shah Lewis Morgan Walker Nguyen Clark Ivanova Hall Brooks Bell Hassan Scott Reed Evans Ali Turner Collins Fischer Bennett Costa Hayes Murphy Diaz Wright Young Roberts Bailey Martin Cooper Foster'.split(
    ' ',
  );
const PREFIXES =
  'Northstar|Cedar|Atlas|Juniper|Lumen|Harbor|Summit|Aspen|Copper|Evergreen|Bluewater|Redwood|Granite|Aster|Orchard|Silverline|Oakridge|Pioneer|Willow|Keystone|Meridian|Cobalt|Solstice|Ironwood|Vista|Clearwater|Brookfield|Pacific|Bridgewater|Crescent|Acorn|Sterling|Meadow|Horizon|Anchor|Ridgeline|Firefly|Elm|Alder|Maple|Canyon|Cascade|Beacon|Sparrow|Marble|Helix|Terra|Violet|Birch|Sequoia'.split(
    '|',
  );
const VERTICALS = [
  ['Cloud Systems', 'B2B software', 'operational analytics', 'data platform'],
  ['Health Partners', 'Healthcare', 'patient operations', 'care coordination'],
  [
    'Manufacturing',
    'Manufacturing',
    'production visibility',
    'plant operations',
  ],
  [
    'Financial Group',
    'Financial services',
    'risk reporting',
    'audit preparation',
  ],
  [
    'Logistics',
    'Transportation',
    'shipment visibility',
    'warehouse operations',
  ],
  ['Retail Collective', 'Retail', 'inventory forecasting', 'store operations'],
  ['Energy', 'Energy', 'asset monitoring', 'field operations'],
  ['Learning', 'Education', 'student engagement', 'campus operations'],
  [
    'Foods',
    'Food and beverage',
    'supply chain traceability',
    'distribution planning',
  ],
  ['Construction', 'Construction', 'project profitability', 'site operations'],
  ['Hospitality', 'Hospitality', 'guest experience', 'property operations'],
  [
    'Networks',
    'Telecommunications',
    'service reliability',
    'network operations',
  ],
  ['Labs', 'Life sciences', 'research reporting', 'laboratory operations'],
  ['Insurance', 'Insurance', 'claims processing', 'policy operations'],
  ['Media', 'Media', 'audience insights', 'content operations'],
  ['Commerce', 'Ecommerce', 'customer retention', 'order operations'],
  [
    'Advisory',
    'Professional services',
    'client reporting',
    'engagement delivery',
  ],
  ['Properties', 'Real estate', 'portfolio reporting', 'property management'],
  ['Mobility', 'Automotive', 'fleet optimization', 'service operations'],
  ['Security', 'Cybersecurity', 'compliance automation', 'security operations'],
];
const CITIES = [
  ['New York', 'NY', '10013', 'United States', 'USD'],
  ['Austin', 'TX', '78701', 'United States', 'USD'],
  ['San Francisco', 'CA', '94105', 'United States', 'USD'],
  ['Chicago', 'IL', '60601', 'United States', 'USD'],
  ['Seattle', 'WA', '98101', 'United States', 'USD'],
  ['Boston', 'MA', '02110', 'United States', 'USD'],
  ['London', 'London', 'EC2A 4NE', 'United Kingdom', 'GBP'],
  ['Manchester', 'Manchester', 'M1 1AD', 'United Kingdom', 'GBP'],
  ['Berlin', 'Berlin', '10115', 'Germany', 'EUR'],
  ['Amsterdam', 'North Holland', '1012', 'Netherlands', 'EUR'],
  ['Paris', 'Ile-de-France', '75002', 'France', 'EUR'],
  ['Toronto', 'Ontario', 'M5V 2H1', 'Canada', 'CAD'],
  ['Vancouver', 'British Columbia', 'V6B 1A1', 'Canada', 'CAD'],
  ['Sydney', 'New South Wales', '2000', 'Australia', 'AUD'],
  ['Singapore', 'Singapore', '018956', 'Singapore', 'SGD'],
  ['Dublin', 'Dublin', 'D02', 'Ireland', 'EUR'],
];
const JOBS = [
  'VP of Operations',
  'Chief Technology Officer',
  'Director of IT',
  'Head of Finance',
  'Procurement Manager',
  'Data Engineering Lead',
  'Chief Operating Officer',
  'Director of Customer Success',
  'Security Architect',
  'Business Systems Manager',
];
const PRODUCTS = [
  'Operations Cloud',
  'Analytics Enterprise',
  'Workflow Automation',
  'Customer Intelligence',
  'Compliance Suite',
  'Data Connect',
];
const ACTIONS = [
  'Schedule discovery workshop',
  'Send implementation proposal',
  'Review security questionnaire',
  'Confirm procurement timeline',
  'Prepare executive business case',
  'Run technical validation',
  'Follow up on legal redlines',
  'Share onboarding plan',
  'Review adoption metrics',
  'Confirm renewal scope',
  'Resolve integration blocker',
  'Schedule quarterly business review',
];
const STAGES = ['NEW', 'SCREENING', 'MEETING', 'PROPOSAL', 'CUSTOMER'];
const personName = (index) => ({
  firstName: FIRST_NAMES[index % FIRST_NAMES.length],
  lastName:
    LAST_NAMES[
      (Math.floor(index / FIRST_NAMES.length) + index * 17) % LAST_NAMES.length
    ],
});
export const idFor = (kind, index) => {
  const hexadecimal = createHash('sha256')
    .update(`meridian-cloud-demo-v1:${kind}:${index}`)
    .digest('hex');
  return `${hexadecimal.slice(0, 8)}-${hexadecimal.slice(8, 12)}-4${hexadecimal.slice(13, 16)}-a${hexadecimal.slice(17, 20)}-${hexadecimal.slice(20, 32)}`;
};
const randomFor = (kind, index) => {
  let state = createHash('sha256')
    .update(`${kind}:${index}:meridian-v1`)
    .digest()
    .readUInt32LE();
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
};
const pick = (array, random) => array[Math.floor(random() * array.length)];
const iso = (timestamp) => new Date(timestamp).toISOString();
const richText = (text, id) => ({
  markdown: text,
  blocknote: JSON.stringify(
    text.split('\n\n').map((paragraph, index) => ({
      id: idFor(`${id}-block`, index),
      type: 'paragraph',
      props: {
        textColor: 'default',
        backgroundColor: 'default',
        textAlignment: 'left',
      },
      content: [{ type: 'text', text: paragraph, styles: {} }],
      children: [],
    })),
  ),
});
export const teamDirectory = (count = 80) =>
  Array.from({ length: count }, (_, index) => {
    const name = personName(index);
    return {
      index,
      name,
      email: `${name.firstName.toLowerCase()}.${name.lastName.toLowerCase()}.${index + 1}@meridian.example`,
      department: [
        'Sales',
        'Customer Success',
        'Solutions Engineering',
        'Revenue Operations',
        'Leadership',
      ][index % 5],
      title: [
        'Account Executive',
        'Customer Success Manager',
        'Solutions Engineer',
        'Revenue Operations Analyst',
        'Regional Director',
      ][index % 5],
      region: ['North America', 'EMEA', 'APAC'][index % 3],
    };
  });

export function buildDataset({
  profile = 'full',
  counts = PROFILES[profile],
  asOf = DEFAULT_AS_OF,
  memberIds = [],
} = {}) {
  if (
    !counts ||
    Object.values(counts).some((count) => !Number.isInteger(count) || count < 1)
  )
    throw new Error('Positive integer entity counts are required');
  if (counts.people < counts.companies || counts.opportunities > counts.people)
    throw new Error(
      'Need at least one contact per company, and opportunities cannot exceed contacts',
    );
  const now = Date.parse(asOf);
  if (!Number.isFinite(now)) throw new Error('Invalid as-of date');
  const start = now - 548 * DAY;
  const owner = (index) =>
    memberIds.length ? memberIds[index % memberIds.length] : undefined;
  const datasets = {
    companies: [],
    people: [],
    opportunities: [],
    tasks: [],
    notes: [],
    taskTargets: [],
    noteTargets: [],
  };
  const companyContexts = [];
  for (let index = 0; index < counts.companies; index++) {
    const random = randomFor('company', index);
    const vertical =
      VERTICALS[Math.floor(index / PREFIXES.length) % VERTICALS.length];
    const city = pick(CITIES, random);
    const regionSuffix = [
      '',
      ' Americas',
      ' Europe',
      ' Pacific',
      ' International',
    ][Math.floor(index / (PREFIXES.length * VERTICALS.length)) % 5];
    const name = `${PREFIXES[index % PREFIXES.length]} ${vertical[0]}${regionSuffix}`;
    const domain = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.example`;
    const created =
      index % 20 < 3
        ? now - (1 + Math.floor(random() * 14)) * DAY
        : start + Math.floor(random() * 480) * DAY;
    const employees = pick(
      [18, 32, 48, 75, 120, 180, 250, 450, 800, 1200, 2400, 5000],
      random,
    );
    const annualRevenue = employees * (80000 + Math.floor(random() * 220000));
    companyContexts.push({ vertical, city, domain, created });
    datasets.companies.push({
      id: idFor('company', index),
      name,
      domainName: {
        primaryLinkUrl: `https://${domain}`,
        primaryLinkLabel: domain,
        secondaryLinks: [],
      },
      employees,
      annualRevenue: {
        amountMicros: String(annualRevenue * 1e6),
        currencyCode: city[4],
      },
      address: {
        addressStreet1: `${100 + (index % 8900)} ${PREFIXES[index % PREFIXES.length]} Avenue`,
        addressStreet2: index % 4 === 0 ? `Suite ${100 + (index % 40)}` : '',
        addressCity: city[0],
        addressState: city[1],
        addressPostcode: city[2],
        addressCountry: city[3],
      },
      industry: vertical[1],
      region: ['North America', 'EMEA', 'APAC'][
        city[3] === 'Singapore' || city[3] === 'Australia'
          ? 2
          : city[3] === 'United States' || city[3] === 'Canada'
            ? 0
            : 1
      ],
      accountHealth: pick(
        ['Healthy', 'Healthy', 'Healthy', 'At risk', 'Needs attention'],
        random,
      ),
      customerTier:
        employees >= 800
          ? 'Enterprise'
          : employees >= 120
            ? 'Mid-market'
            : 'Small business',
      accountOwnerId: owner(index),
      idealCustomerProfile: employees >= 120 && employees <= 2400,
      createdAt: iso(created),
      updatedAt: iso(
        Math.min(now, created + (14 + Math.floor(random() * 270)) * DAY),
      ),
      position: index,
    });
  }
  for (let index = 0; index < counts.people; index++) {
    const random = randomFor('person', index);
    const companyIndex = index % counts.companies;
    const context = companyContexts[companyIndex];
    const name = personName(index + 83);
    const contactWindowDays = Math.min(
      45,
      Math.floor((now - DAY - context.created) / DAY) + 1,
    );
    const created =
      context.created + Math.floor(random() * contactWindowDays) * DAY;
    datasets.people.push({
      id: idFor('person', index),
      name,
      emails: {
        primaryEmail: `${name.firstName.toLowerCase()}.${name.lastName.toLowerCase()}.${Math.floor(index / counts.companies) + 1}@${context.domain}`,
        additionalEmails: [],
      },
      jobTitle: JOBS[Math.floor(index / counts.companies) % JOBS.length],
      companyId: idFor('company', companyIndex),
      city: context.city[0],
      phones: {
        primaryPhoneNumber: `20255501${String(index % 100).padStart(2, '0')}`,
        primaryPhoneCallingCode: '+1',
        primaryPhoneCountryCode: 'US',
        additionalPhones: [],
      },
      createdAt: iso(created),
      updatedAt: iso(Math.min(now, created + Math.floor(random() * 300) * DAY)),
      position: index,
    });
  }
  for (let index = 0; index < counts.opportunities; index++) {
    const random = randomFor('opportunity', index);
    const companyIndex = index % counts.companies;
    const company = datasets.companies[companyIndex];
    const context = companyContexts[companyIndex];
    const contactIndex =
      companyIndex +
      (Math.floor(index / counts.companies) %
        Math.floor(counts.people / counts.companies)) *
        counts.companies;
    const earliestOpportunity = Date.parse(
      datasets.people[contactIndex].createdAt,
    );
    const opportunityWindowDays = Math.min(
      108,
      Math.floor((now - DAY - earliestOpportunity) / DAY) + 1,
    );
    const created =
      earliestOpportunity + Math.floor(random() * opportunityWindowDays) * DAY;
    const ageDays = (now - created) / DAY;
    const stage =
      ageDays < 21
        ? random() < 0.65
          ? 'NEW'
          : 'SCREENING'
        : ageDays > 120 && random() < 0.68
          ? 'CUSTOMER'
          : pick(STAGES.slice(0, 4), random);
    const closeDate =
      stage === 'CUSTOMER'
        ? Math.min(now - DAY, created + (30 + Math.floor(random() * 90)) * DAY)
        : now + (Math.floor(random() * 120) - 10) * DAY;
    const product = PRODUCTS[index % PRODUCTS.length];
    const motion =
      index >= counts.companies
        ? index % 2
          ? 'Renewal'
          : 'Expansion'
        : 'New business';
    const amount =
      Math.round(
        (company.employees * (24 + Math.floor(random() * 65)) * 12 + 2500) /
          100,
      ) * 100;
    datasets.opportunities.push({
      id: idFor('opportunity', index),
      name: `${company.name} · ${product} · ${motion}`,
      amount: {
        amountMicros: String(amount * 1e6),
        currencyCode: context.city[4],
      },
      closeDate: iso(closeDate),
      stage,
      companyId: company.id,
      pointOfContactId: idFor('person', contactIndex),
      ownerId: owner(companyIndex),
      createdAt: iso(created),
      updatedAt: iso(
        Math.max(
          created,
          stage === 'CUSTOMER'
            ? closeDate
            : now - Math.floor(random() * 28) * DAY,
        ),
      ),
      position: index,
    });
  }
  const peopleById = new Map(
    datasets.people.map((person) => [person.id, person]),
  );
  const activity = (kind, count) => {
    for (let index = 0; index < count; index++) {
      const random = randomFor(kind, index);
      const opportunityIndex = index % counts.opportunities;
      const opportunity = datasets.opportunities[opportunityIndex];
      const companyIndex = opportunityIndex % counts.companies;
      const company = datasets.companies[companyIndex];
      const context = companyContexts[companyIndex];
      const contact = peopleById.get(opportunity.pointOfContactId);
      const created = Math.min(
        now - DAY,
        Date.parse(opportunity.createdAt) +
          Math.floor(
            random() *
              Math.max(1, (now - Date.parse(opportunity.createdAt)) / DAY - 1),
          ) *
            DAY,
      );
      const ownerId = owner(companyIndex);
      const contactName = `${contact.name.firstName} ${contact.name.lastName}`;
      const action =
        ACTIONS[
          (index + Math.floor(index / counts.opportunities)) % ACTIONS.length
        ];
      const seats = Math.max(
        10,
        Math.round(company.employees * (0.15 + random() * 0.5)),
      );
      const businessCase = `${company.name} wants to reduce manual work in ${context.vertical[2]} across the ${context.city[0]} team. Initial scope: ${seats} seats, with a second phase for ${context.vertical[3]}.`;
      const blocker = pick(
        [
          'IT needs confirmation of SSO and SCIM support',
          'Procurement requested a two-year price lock',
          'Security review is waiting on the DPA',
          'The executive sponsor wants a phased rollout',
          'Finance needs the cost center allocation',
          'The pilot team needs a sandbox before approval',
        ],
        random,
      );
      const nextStep = `${action} with ${contactName} (${contact.jobTitle}). ${blocker}. Target a decision by ${iso(Math.min(now + 45 * DAY, created + 21 * DAY)).slice(0, 10)}.`;
      if (kind === 'task') {
        const status =
          created < now - 35 * DAY && random() < 0.8
            ? 'DONE'
            : random() < 0.55
              ? 'TODO'
              : 'IN_PROGRESS';
        datasets.tasks.push({
          id: idFor('task', index),
          title: `${action} — ${company.name}`,
          bodyV2: richText(`${businessCase}\n\n${nextStep}`, `task-${index}`),
          status,
          dueAt: iso(
            status === 'DONE'
              ? Math.min(
                  now - DAY,
                  created + (2 + Math.floor(random() * 10)) * DAY,
                )
              : now + (Math.floor(random() * 35) - 10) * DAY,
          ),
          assigneeId: ownerId,
          position: index,
          createdAt: iso(created),
          updatedAt: iso(
            Math.max(
              created,
              status === 'DONE'
                ? Math.min(now, created + 12 * DAY)
                : now - Math.floor(random() * 8) * DAY,
            ),
          ),
        });
        for (const [targetKind, targetId] of [
          ['Company', company.id],
          ['Person', contact.id],
          ['Opportunity', opportunity.id],
        ])
          datasets.taskTargets.push({
            id: idFor(`task-target-${targetKind}`, index),
            taskId: idFor('task', index),
            [`target${targetKind}Id`]: targetId,
          });
      } else {
        const title = pick(
          [
            'Discovery summary',
            'Pilot review',
            'Commercial discussion',
            'Security review',
            'Executive alignment',
            'Quarterly account review',
            'Implementation handoff',
            'Renewal planning',
          ],
          random,
        );
        const markdown = `${title} — ${company.name}\n\nMet with ${contactName}, ${contact.jobTitle}, on ${iso(created).slice(0, 10)}. ${businessCase}\n\nSuccess criteria: ${20 + Math.floor(random() * 45)}% less manual reporting; ${75 + Math.floor(random() * 20)}% weekly active usage across ${seats} licensed seats. Budget owner confirmed ${opportunity.amount.currencyCode} ${Math.round(Number(opportunity.amount.amountMicros) / 1e6).toLocaleString('en-US')} annual scope.\n\n${blocker}.\n\nNext steps: ${nextStep}`;
        datasets.notes.push({
          id: idFor('note', index),
          title: `${title} — ${company.name}`,
          bodyV2: richText(markdown, `note-${index}`),
          position: index,
          createdAt: iso(created),
          updatedAt: iso(Math.min(now, created + DAY)),
        });
        for (const [targetKind, targetId] of [
          ['Company', company.id],
          ['Person', contact.id],
          ['Opportunity', opportunity.id],
        ])
          datasets.noteTargets.push({
            id: idFor(`note-target-${targetKind}`, index),
            noteId: idFor('note', index),
            [`target${targetKind}Id`]: targetId,
          });
      }
    }
  };
  activity('task', counts.tasks);
  activity('note', counts.notes);
  return datasets;
}

export const summarizeDataset = (dataset) => ({
  counts: Object.fromEntries(
    Object.entries(dataset).map(([kind, rows]) => [kind, rows.length]),
  ),
  stages: Object.fromEntries(
    STAGES.map((stage) => [
      stage,
      dataset.opportunities.filter((row) => row.stage === stage).length,
    ]),
  ),
  taskStatuses: Object.fromEntries(
    ['TODO', 'IN_PROGRESS', 'DONE'].map((status) => [
      status,
      dataset.tasks.filter((row) => row.status === status).length,
    ]),
  ),
  currencies: [
    ...new Set(dataset.opportunities.map((row) => row.amount.currencyCode)),
  ].sort(),
  createdAtRange: [
    dataset.companies.reduce(
      (minimum, row) => (row.createdAt < minimum ? row.createdAt : minimum),
      '9999',
    ),
    dataset.companies.reduce(
      (maximum, row) => (row.createdAt > maximum ? row.createdAt : maximum),
      '0000',
    ),
  ],
});
