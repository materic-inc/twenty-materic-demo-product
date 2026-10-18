import { setTimeout as delay } from 'node:timers/promises';
import { isolationFromEnvironment, assertIsolationRequest } from './isolation.mjs';

export function createClient({ baseUrl, token, delayMilliseconds = 700 }) {
  const isolation = isolationFromEnvironment();
  const origin = new URL(process.env.TWENTY_TRANSPORT_URL || baseUrl);
  if (!['https:', 'http:'].includes(origin.protocol))
    throw new Error('Twenty base/transport URL must be an HTTP URL');
  if (isolation) assertIsolationRequest(isolation, origin);
  let previousRequest = 0;
  async function request(path, { method = 'GET', body, bearer = token } = {}) {
    const url = new URL(path, origin);
    if (isolation) {
      if (process.env.TWENTY_TRANSPORT_URL !== undefined) throw new Error('Unset TWENTY_TRANSPORT_URL for isolation');
      assertIsolationRequest(isolation, url);
    }
    for (let attempt = 0; attempt < 7; attempt++) {
      await delay(
        Math.max(0, previousRequest + delayMilliseconds - Date.now()),
      );
      previousRequest = Date.now();
      const response = await fetch(url, {
        method,
        ...(isolation ? { redirect: 'error' } : {}),
        headers: {
          'content-type': 'application/json',
          ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(120000),
      }).catch((error) => {
        if (isolation) throw new Error('Isolated API transport failed; no redirect is permitted');
        throw error;
      });
      if (isolation && response.status >= 300 && response.status < 400)
        throw new Error('Isolated API redirect rejected');
      if (response.status === 429 || response.status >= 500) {
        if (attempt === 6)
          throw new Error(
            `HTTP ${response.status} for ${method} ${path.split('?')[0]} after retries`,
          );
        const retryAfter = Number(response.headers.get('retry-after'));
        await delay(
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : Math.min(60000, 2000 * 2 ** attempt),
        );
        continue;
      }
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.errors?.length) {
        if (isolation) throw new Error(`Isolated API returned HTTP ${response.status} or GraphQL errors; response diagnostics withheld`);
        const messages =
          payload?.errors
            ?.map((error) =>
              typeof error === 'string' ? error : error.message,
            )
            .filter(Boolean)
            .join('; ') ||
          payload?.message ||
          payload?.messages?.join('; ') ||
          'Request failed';
        // GraphQL variables can contain passwords; only report server diagnostics.
        throw new Error(
          `HTTP ${response.status} for ${method} ${path.split('?')[0]}: ${String(
            messages,
          )
            .slice(0, 1500)
            .replaceAll(token || '\0', '[redacted]')}`,
        );
      }
      return payload;
    }
  }
  return {
    request,
    graphql: async (query, variables = {}, bearer = token) =>
      (
        await request('/metadata', {
          method: 'POST',
          body: { query, variables },
          bearer,
        })
      ).data,
    upsert: async (plural, rows) =>
      request(`/rest/batch/${plural}?upsert=true&depth=0`, {
        method: 'POST',
        body: rows,
      }),
  };
}

export async function listMetadata(client) {
  const data = await client.graphql(
    'query DemoObjects { objects(paging: { first: 100 }) { edges { node { id nameSingular namePlural fields(paging: { first: 1000 }) { edges { node { id name type } } } } } } }',
  );
  return Object.fromEntries(
    data.objects.edges.map(({ node }) => [
      node.namePlural,
      {
        ...node,
        fields: Object.fromEntries(
          node.fields.edges.map(({ node: field }) => [field.name, field]),
        ),
      },
    ]),
  );
}
