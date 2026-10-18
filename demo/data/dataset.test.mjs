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
const dataset = buildDataset({ profile: 'smoke', memberIds: members });

test('same snapshot produces the same ids and relationships; staff have unique reserved emails', () => {
  assert.deepEqual(
    buildDataset({ profile: 'smoke', memberIds: members }),
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
  const full = buildDataset({ profile: 'full', memberIds: members });
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
});
