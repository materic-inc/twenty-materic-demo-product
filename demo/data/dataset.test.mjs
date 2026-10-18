import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDataset,
  DEFAULT_AS_OF,
  idFor,
  PROFILES,
  teamDirectory,
} from './dataset.mjs';

const members = Array.from({ length: 8 }, (_, index) => idFor('member', index));
const memberNames = Object.fromEntries(
  members.map((id, index) => [id, `Staff ${index + 1}`]),
);
const dataset = buildDataset({
  profile: 'smoke',
  memberIds: members,
  memberNames,
});

test('same snapshot produces the same ids and relationships; staff have unique reserved emails', () => {
  assert.deepEqual(
    buildDataset({ profile: 'smoke', memberIds: members, memberNames }),
    dataset,
  );
  const staff = teamDirectory();
  assert.equal(staff.length, 80);
  assert.equal(new Set(staff.map((person) => person.email)).size, 80);
  assert.ok(
    staff.every((person) => person.email.endsWith('@meridian.example')),
  );
  assert.notEqual(idFor('company', 1), idFor('person', 1));
});

test('contacts, opportunities, tasks and notes form consistent company histories', () => {
  const companies = new Map(dataset.companies.map((row) => [row.id, row]));
  const people = new Map(dataset.people.map((row) => [row.id, row]));
  for (const company of companies.values()) {
    assert.equal(company.createdBy.workspaceMemberId, company.accountOwnerId);
    assert.equal(company.createdBy.name, memberNames[company.accountOwnerId]);
    assert.equal(company.createdBy.source, 'MANUAL');
  }
  for (const contact of people.values()) {
    const company = companies.get(contact.companyId);
    assert.ok(company);
    assert.ok(
      contact.emails.primaryEmail.endsWith(
        `@${company.domainName.primaryLinkLabel}`,
      ),
    );
    assert.ok(contact.createdAt >= company.createdAt);
  }
  for (const deal of dataset.opportunities) {
    const contact = people.get(deal.pointOfContactId);
    assert.equal(contact.companyId, deal.companyId);
    assert.ok(members.includes(deal.ownerId));
    assert.equal(
      deal.amount.currencyCode,
      companies.get(deal.companyId).annualRevenue.currencyCode,
    );
    assert.ok(Number(deal.amount.amountMicros) > 0);
  }
  for (const kind of ['task', 'note']) {
    const records = new Map(dataset[`${kind}s`].map((row) => [row.id, row]));
    const targets = dataset[`${kind}Targets`];
    assert.equal(targets.length, records.size * 3);
    for (const record of records.values()) {
      const links = targets.filter(
        (target) => target[`${kind}Id`] === record.id,
      );
      assert.equal(links.length, 3);
      const companyId = links.find(
        (link) => link.targetCompanyId,
      ).targetCompanyId;
      const personId = links.find((link) => link.targetPersonId).targetPersonId;
      const dealId = links.find(
        (link) => link.targetOpportunityId,
      ).targetOpportunityId;
      assert.equal(people.get(personId).companyId, companyId);
      assert.equal(
        dataset.opportunities.find((row) => row.id === dealId).companyId,
        companyId,
      );
      assert.ok(record.bodyV2.markdown.includes(companies.get(companyId).name));
      assert.equal(
        record.createdBy.workspaceMemberId,
        companies.get(companyId).accountOwnerId,
      );
      assert.equal(
        record.createdBy.name,
        memberNames[record.createdBy.workspaceMemberId],
      );
      assert.ok(JSON.parse(record.bodyV2.blocknote).length > 1);
    }
  }
});

test('history is chronological and data includes meaningful varied states', () => {
  for (const records of [
    dataset.companies,
    dataset.people,
    dataset.opportunities,
    dataset.tasks,
    dataset.notes,
  ]) {
    assert.equal(new Set(records.map((row) => row.id)).size, records.length);
    for (const row of records) {
      assert.ok(
        row.createdAt <= row.updatedAt,
        `${row.id}: update before creation`,
      );
      assert.ok(row.updatedAt <= DEFAULT_AS_OF, `${row.id}: updated in future`);
    }
  }
  assert.equal(new Set(dataset.opportunities.map((row) => row.stage)).size, 5);
  assert.equal(new Set(dataset.tasks.map((row) => row.status)).size, 3);
  assert.ok(
    dataset.tasks.some(
      (row) => row.status !== 'DONE' && row.dueAt < DEFAULT_AS_OF,
    ),
  );
  assert.ok(
    dataset.tasks.some(
      (row) => row.status !== 'DONE' && row.dueAt > DEFAULT_AS_OF,
    ),
  );
  assert.ok(
    new Set(dataset.opportunities.map((row) => row.amount.currencyCode)).size >=
      4,
  );
});

test('full fixture has substantial breadth and unique companies', () => {
  const full = buildDataset({
    profile: 'full',
    memberIds: members,
    memberNames,
  });
  for (const [kind, rows] of Object.entries(dataset)) {
    const fullById = new Map(full[kind].map((row) => [row.id, row]));
    for (const row of rows) assert.deepEqual(row, fullById.get(row.id));
  }
  for (const [kind, count] of Object.entries(PROFILES.full))
    assert.equal(full[kind].length, count);
  assert.equal(new Set(full.companies.map((row) => row.name)).size, 5000);
  assert.equal(full.taskTargets.length, 72000);
  assert.equal(full.noteTargets.length, 60000);
  assert.equal(new Set(full.companies.map((row) => row.industry)).size, 20);
  assert.equal(
    new Set(full.opportunities.map((row) => row.amount.currencyCode)).size,
    6,
  );
  const recentThreshold = new Date(
    Date.parse(DEFAULT_AS_OF) - 14 * 86400000,
  ).toISOString();
  const recentCompanies = full.companies.filter(
    (company) => company.createdAt >= recentThreshold,
  );
  assert.equal(recentCompanies.length, 750);
  const peopleById = new Map(full.people.map((person) => [person.id, person]));
  const namesByCompany = new Map(full.companies.map((company)=>[company.id,new Set()]));
  for(const person of full.people) namesByCompany.get(person.companyId).add(`${person.name.firstName} ${person.name.lastName}`);
  for(const names of namesByCompany.values()) assert.equal(names.size,5,'Each company needs five distinct contact names');
  const companiesById = new Map(
    full.companies.map((company) => [company.id, company]),
  );
  for (const person of full.people)
    assert.ok(
      person.createdAt >= companiesById.get(person.companyId).createdAt,
    );
  for (const opportunity of full.opportunities) {
    assert.ok(
      opportunity.createdAt >=
        companiesById.get(opportunity.companyId).createdAt,
    );
    assert.ok(
      opportunity.createdAt >=
        peopleById.get(opportunity.pointOfContactId).createdAt,
    );
    if (companiesById.get(opportunity.companyId).createdAt >= recentThreshold)
      assert.ok(['NEW', 'SCREENING'].includes(opportunity.stage));
  }
  const opportunitiesById = new Map(
    full.opportunities.map((opportunity) => [opportunity.id, opportunity]),
  );
  for (const kind of ['task', 'note']) {
    const recordsById = new Map(
      full[`${kind}s`].map((record) => [record.id, record]),
    );
    for (const target of full[`${kind}Targets`]) {
      const record = recordsById.get(target[`${kind}Id`]);
      if (target.targetCompanyId)
        assert.ok(
          record.createdAt >=
            companiesById.get(target.targetCompanyId).createdAt,
        );
      if (target.targetPersonId)
        assert.ok(
          record.createdAt >= peopleById.get(target.targetPersonId).createdAt,
        );
      if (target.targetOpportunityId)
        assert.ok(
          record.createdAt >=
            opportunitiesById.get(target.targetOpportunityId).createdAt,
        );
    }
  }
});
