// lib/filters.js — Filter parsing and building for Notion API queries

/**
 * Parse a filter string into { key, operator, value }.
 * Supports: >=, <=, !=, >, <, = (default)
 * Examples: "Status=Active", "Day>5", "Date>=2026-01-01", "Name!=Draft"
 */
function parseFilterOperator(filterStr) {
  // Order matters: check multi-char operators first
  const ops = ['>=', '<=', '!=', '>', '<', '='];
  for (const op of ops) {
    const idx = filterStr.indexOf(op);
    if (idx > 0) {
      return {
        key: filterStr.slice(0, idx),
        operator: op,
        value: filterStr.slice(idx + op.length),
      };
    }
  }
  return { error: `Invalid filter format: ${filterStr} (expected key=value, key>value, etc.)` };
}

/**
 * Resolve relative date keywords to ISO date strings.
 */
function resolveRelativeDate(value) {
  const lower = value.toLowerCase();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (lower) {
    case 'today':
      return today.toISOString().split('T')[0];
    case 'yesterday': {
      const d = new Date(today); d.setDate(d.getDate() - 1);
      return d.toISOString().split('T')[0];
    }
    case 'tomorrow': {
      const d = new Date(today); d.setDate(d.getDate() + 1);
      return d.toISOString().split('T')[0];
    }
    case 'last_week': case 'last-week': {
      const d = new Date(today); d.setDate(d.getDate() - 7);
      return d.toISOString().split('T')[0];
    }
    case 'next_week': case 'next-week': {
      const d = new Date(today); d.setDate(d.getDate() + 7);
      return d.toISOString().split('T')[0];
    }
    default:
      return value; // Return as-is if not a keyword
  }
}

/**
 * Map { operator, type } to Notion filter condition.
 */
function operatorToCondition(type, operator, value) {
  // Resolve relative dates
  if (type === 'date') {
    value = resolveRelativeDate(value);
  }

  // Number coercion
  if (type === 'number') {
    value = Number(value);
  }

  // Checkbox coercion
  if (type === 'checkbox') {
    value = value === 'true' || value === '1' || value === 'yes';
  }

  // Map operators to Notion API condition names
  const conditionMap = {
    '=': getDefaultCondition(type, value),
    '!=': getNotEqualCondition(type, value),
    '>': { [getFilterType(type)]: { after: type === 'date' ? value : undefined, greater_than: type !== 'date' ? value : undefined } },
    '<': { [getFilterType(type)]: { before: type === 'date' ? value : undefined, less_than: type !== 'date' ? value : undefined } },
    '>=': { [getFilterType(type)]: { on_or_after: type === 'date' ? value : undefined, greater_than_or_equal_to: type !== 'date' ? value : undefined } },
    '<=': { [getFilterType(type)]: { on_or_before: type === 'date' ? value : undefined, less_than_or_equal_to: type !== 'date' ? value : undefined } },
  };

  const condition = conditionMap[operator];
  if (!condition) return null;

  // Clean undefined values
  const filterType = getFilterType(type);
  if (condition[filterType]) {
    const inner = condition[filterType];
    for (const k of Object.keys(inner)) {
      if (inner[k] === undefined) delete inner[k];
    }
  }

  return condition;
}

/** Get the Notion filter type key for a schema type */
function getFilterType(type) {
  // Most types use themselves as the filter key
  return type;
}

/** Default equals/contains condition for = operator */
function getDefaultCondition(type, value) {
  switch (type) {
    case 'title':
    case 'rich_text':
      return { [type]: { contains: value } };
    case 'select':
      return { select: { equals: value } };
    case 'multi_select':
      return { multi_select: { contains: value } };
    case 'number':
      return { number: { equals: value } };
    case 'checkbox':
      return { checkbox: { equals: value } };
    case 'date':
      return { date: { equals: value } };
    case 'status':
      return { status: { equals: value } };
    default:
      return { [type]: { equals: value } };
  }
}

/** Not-equal condition for != operator */
function getNotEqualCondition(type, value) {
  switch (type) {
    case 'title':
    case 'rich_text':
      return { [type]: { does_not_contain: value } };
    case 'select':
      return { select: { does_not_equal: value } };
    case 'multi_select':
      return { multi_select: { does_not_contain: value } };
    case 'number':
      return { number: { does_not_equal: value } };
    case 'checkbox':
      return { checkbox: { does_not_equal: value } };
    case 'date':
      // Notion doesn't have date does_not_equal; skip
      return { date: { does_not_equal: value } };
    case 'status':
      return { status: { does_not_equal: value } };
    default:
      return { [type]: { does_not_equal: value } };
  }
}

/**
 * Build a Notion filter object from a schema and a single filter string.
 * Supports operators: =, !=, >, <, >=, <=
 * Supports relative dates: today, yesterday, tomorrow, last_week, next_week
 */
function buildFilterFromSchema(schema, filterStr) {
  const parsed = parseFilterOperator(filterStr);
  if (parsed.error) return parsed;

  const { key, operator, value } = parsed;
  const schemaEntry = schema[key.toLowerCase()];
  if (!schemaEntry) {
    return {
      error: `Filter property "${key}" not found in database schema.`,
      available: Object.values(schema).map(s => s.name),
    };
  }

  const propName = schemaEntry.name;
  const type = schemaEntry.type;

  const condition = operatorToCondition(type, operator, value);
  if (!condition) {
    return { error: `Operator "${operator}" not supported for type "${type}"` };
  }

  return { filter: { property: propName, ...condition } };
}

/**
 * Build a compound AND filter from multiple filter strings.
 * Each filter is parsed independently, then combined with AND.
 */
function buildCompoundFilter(schema, filterStrs) {
  if (!Array.isArray(filterStrs) || filterStrs.length === 0) {
    return { error: 'No filters provided' };
  }
  if (filterStrs.length === 1) {
    return buildFilterFromSchema(schema, filterStrs[0]);
  }

  const filters = [];
  for (const f of filterStrs) {
    const result = buildFilterFromSchema(schema, f);
    if (result.error) return result;
    filters.push(result.filter);
  }

  return { filter: { and: filters } };
}

module.exports = {
  parseFilterOperator,
  resolveRelativeDate,
  operatorToCondition,
  getDefaultCondition,
  getNotEqualCondition,
  getFilterType,
  buildFilterFromSchema,
  buildCompoundFilter,
};
