import { idFor } from './dataset.mjs';

export function buildDashboardPlans(metadata) {
  const field = (object, name) => {
    const result = metadata[object]?.fields[name];
    if (!result) throw new Error(`Chart field missing: ${object}.${name}`);
    return result.id;
  };
  const filter = (object, name, operand, value) => ({
    recordFilters: [
      {
        fieldMetadataId: field(object, name),
        operand,
        value: Array.isArray(value) ? JSON.stringify(value) : value,
      },
    ],
  });
  const count = (object, title, recordFilter) => ({
    object,
    title,
    configuration: {
      configurationType: 'AGGREGATE_CHART',
      aggregateFieldMetadataId: field(object, 'id'),
      aggregateOperation: 'COUNT',
      numberFormat: 'FULL',
      displayDataLabel: true,
      ...(recordFilter ? { filter: recordFilter } : {}),
    },
  });
  const bar = (object, name, title) => ({
    object,
    title,
    configuration: {
      configurationType: 'BAR_CHART',
      layout: 'VERTICAL',
      aggregateFieldMetadataId: field(object, 'id'),
      aggregateOperation: 'COUNT',
      primaryAxisGroupByFieldMetadataId: field(object, name),
      primaryAxisOrderBy: 'VALUE_DESC',
      displayDataLabel: true,
      axisNameDisplay: 'NONE',
      omitNullValues: true,
      numberFormat: 'SHORT',
      color: 'blue',
    },
  });
  const pie = (object, name, title) => ({
    object,
    title,
    configuration: {
      configurationType: 'PIE_CHART',
      groupByFieldMetadataId: field(object, name),
      aggregateFieldMetadataId: field(object, 'id'),
      aggregateOperation: 'COUNT',
      orderBy: 'VALUE_DESC',
      displayDataLabel: true,
      displayLegend: true,
      showCenterMetric: true,
      numberFormat: 'SHORT',
    },
  });
  const trend = (object, title) => ({
    object,
    title,
    configuration: {
      configurationType: 'LINE_CHART',
      aggregateFieldMetadataId: field(object, 'id'),
      aggregateOperation: 'COUNT',
      primaryAxisGroupByFieldMetadataId: field(object, 'createdAt'),
      primaryAxisDateGranularity: 'MONTH',
      primaryAxisOrderBy: 'FIELD_ASC',
      displayDataLabel: false,
      axisNameDisplay: 'NONE',
      omitNullValues: true,
      numberFormat: 'SHORT',
      color: 'blue',
    },
  });
  const plans = [
    {
      title: 'Revenue overview',
      widgets: [
        count('companies', 'Accounts'),
        count('people', 'Contacts'),
        count('opportunities', 'Opportunities'),
        count(
          'opportunities',
          'Customer contracts',
          filter('opportunities', 'stage', 'IS', ['CUSTOMER']),
        ),
        bar('opportunities', 'stage', 'Opportunities by stage'),
        trend('opportunities', 'New opportunities by month'),
        pie('companies', 'customerTier', 'Accounts by segment'),
      ],
    },
    {
      title: 'Customer portfolio',
      widgets: [
        count(
          'companies',
          'Healthy accounts',
          filter('companies', 'accountHealth', 'IS', 'Healthy'),
        ),
        count(
          'companies',
          'Accounts at risk',
          filter('companies', 'accountHealth', 'IS', 'At risk'),
        ),
        count(
          'companies',
          'Accounts needing attention',
          filter('companies', 'accountHealth', 'IS', 'Needs attention'),
        ),
        bar('companies', 'region', 'Accounts by region'),
        bar('companies', 'industry', 'Accounts by industry'),
        pie('companies', 'accountHealth', 'Account health'),
        trend('companies', 'Account growth'),
      ],
    },
    {
      title: 'Team operations',
      widgets: [
        count('tasks', 'All follow-ups'),
        count('notes', 'Account conversations'),
        count(
          'tasks',
          'Completed follow-ups',
          filter('tasks', 'status', 'IS', ['DONE']),
        ),
        pie('tasks', 'status', 'Follow-up status'),
        trend('tasks', 'Activities created by month'),
        trend('notes', 'Conversations by month'),
      ],
    },
  ];
  return plans;
}

export async function configureDashboards(client, metadata) {
  const plans = buildDashboardPlans(metadata);
  for (let index = 0; index < plans.length; index++) {
    const plan = plans[index];
    const dashboardId = idFor('dashboard', index);
    let response = await client.request(
      `/rest/dashboards?filter=${encodeURIComponent(`id[eq]:${dashboardId}`)}&depth=0`,
    );
    if (!response.totalCount) {
      await client.request('/rest/dashboards', {
        method: 'POST',
        body: { id: dashboardId, title: plan.title, position: index },
      });
      response = await client.request(
        `/rest/dashboards?filter=${encodeURIComponent(`id[eq]:${dashboardId}`)}&depth=0`,
      );
    }
    const dashboard = response.data.dashboards[0];
    if (!dashboard?.pageLayoutId)
      throw new Error(`Dashboard ${plan.title} has no native page layout`);
    let tabs = await client.graphql(
      'query DemoDashboardTabs($pageLayoutId:String!) { getPageLayoutTabs(pageLayoutId:$pageLayoutId) { id title widgets { id title } } }',
      { pageLayoutId: dashboard.pageLayoutId },
    );
    let tab = tabs.getPageLayoutTabs[0];
    if (!tab) {
      const created = await client.graphql(
        'mutation DemoDashboardTab($input:CreatePageLayoutTabInput!) { createPageLayoutTab(input:$input) { id title } }',
        {
          input: {
            title: 'Overview',
            pageLayoutId: dashboard.pageLayoutId,
            layoutMode: 'GRID',
          },
        },
      );
      tab = { ...created.createPageLayoutTab, widgets: [] };
    }
    for (
      let widgetIndex = 0;
      widgetIndex < plan.widgets.length;
      widgetIndex++
    ) {
      const widget = plan.widgets[widgetIndex];
      if (tab.widgets?.some((existing) => existing.title === widget.title))
        continue;
      const isNumber =
        widget.configuration.configurationType === 'AGGREGATE_CHART';
      const topCount = plan.widgets.filter(
        (candidate) =>
          candidate.configuration.configurationType === 'AGGREGATE_CHART',
      ).length;
      const chartIndex = widgetIndex - topCount;
      const position = isNumber
        ? {
            layoutMode: 'GRID',
            row: 0,
            column: widgetIndex * 3,
            rowSpan: 2,
            columnSpan: 3,
          }
        : {
            layoutMode: 'GRID',
            row: 2 + Math.floor(chartIndex / 2) * 5,
            column: (chartIndex % 2) * 6,
            rowSpan: 5,
            columnSpan: 6,
          };
      await client.graphql(
        'mutation DemoDashboardWidget($input:CreatePageLayoutWidgetInput!) { createPageLayoutWidget(input:$input) { id } }',
        {
          input: {
            title: widget.title,
            type: 'GRAPH',
            objectMetadataId: metadata[widget.object].id,
            pageLayoutTabId: tab.id,
            position,
            configuration: widget.configuration,
          },
        },
      );
    }
    console.log(
      `Configured dashboard: ${plan.title} (${plan.widgets.length} live chart widgets)`,
    );
  }
}
