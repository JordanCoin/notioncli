// lib/paginate.js — Generic Notion pagination helper

/**
 * Paginate Notion list/query/search endpoints that return { results, has_more, next_cursor }.
 * fetchPage({ start_cursor, page_size }) should return the raw API response.
 */
async function paginate(fetchPage, options = {}) {
  const limit = options.limit == null ? null : Number(options.limit);
  const pageSizeLimit = options.pageSizeLimit || 100;

  if (limit != null && (!Number.isFinite(limit) || limit < 0)) {
    throw new Error(`Invalid limit: ${options.limit}`);
  }

  const results = [];
  let cursor = undefined;
  let hasMore = true;
  let truncated = false;
  let responseBase = null;

  while (hasMore) {
    const remaining = limit == null ? null : limit - results.length;
    if (remaining != null && remaining <= 0) {
      truncated = true;
      break;
    }

    const pageSize = remaining == null ? pageSizeLimit : Math.min(pageSizeLimit, remaining);
    const res = await fetchPage({ start_cursor: cursor, page_size: pageSize });
    if (!responseBase) responseBase = res;

    const pageResults = res.results || [];
    if (limit != null && pageResults.length > 0) {
      const remaining = limit - results.length;
      if (remaining <= 0) {
        truncated = true;
        break;
      }
      if (pageResults.length > remaining) {
        results.push(...pageResults.slice(0, remaining));
        truncated = true;
        cursor = res.next_cursor || null;
        break;
      }
    }
    results.push(...pageResults);

    hasMore = Boolean(res.has_more);
    cursor = res.next_cursor || null;

    if (limit != null && results.length >= limit && hasMore) {
      truncated = true;
      break;
    }
  }

  const finalHasMore = truncated ? true : false;
  const finalCursor = truncated ? cursor : null;
  const response = responseBase
    ? { ...responseBase, results, has_more: finalHasMore, next_cursor: finalCursor }
    : { object: 'list', results, has_more: finalHasMore, next_cursor: finalCursor };

  return {
    results,
    has_more: finalHasMore,
    next_cursor: finalCursor,
    truncated,
    response,
  };
}

module.exports = {
  paginate,
};
