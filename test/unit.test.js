// test/unit.test.js — Pure function tests (no API calls)

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  richTextToPlain,
  propValue,
  buildPropValue,
  printTable,
  pagesToRows,
  formatCsv,
  formatYaml,
  parseFilterOperator,
  resolveRelativeDate,
  buildFilterFromSchema,
  buildCompoundFilter,
  markdownToBlocks,
  parseInlineFormatting,
  blocksToMarkdown,
  parseCsv,
  kebabToProperty,
  extractDynamicProps,
  UUID_REGEX,
  paginate,
  withRetry,
} = require('../lib/helpers');

// ─── richTextToPlain ───────────────────────────────────────────────────────────

describe('richTextToPlain', () => {
  it('returns empty string for null', () => {
    assert.equal(richTextToPlain(null), '');
  });

  it('returns empty string for undefined', () => {
    assert.equal(richTextToPlain(undefined), '');
  });

  it('returns empty string for empty array', () => {
    assert.equal(richTextToPlain([]), '');
  });

  it('returns empty string for non-array truthy value', () => {
    assert.equal(richTextToPlain('some string'), '');
    assert.equal(richTextToPlain(42), '');
    assert.equal(richTextToPlain({}), '');
  });

  it('extracts plain text from single item', () => {
    const rt = [{ plain_text: 'Hello' }];
    assert.equal(richTextToPlain(rt), 'Hello');
  });

  it('concatenates plain text from multiple items', () => {
    const rt = [
      { plain_text: 'Hello ' },
      { plain_text: 'World' },
    ];
    assert.equal(richTextToPlain(rt), 'Hello World');
  });

  it('handles items without plain_text', () => {
    const rt = [{ plain_text: 'Hi' }, {}, { plain_text: ' there' }];
    assert.equal(richTextToPlain(rt), 'Hi there');
  });
});

// ─── propValue ─────────────────────────────────────────────────────────────────

describe('propValue', () => {
  it('returns empty string for null/undefined', () => {
    assert.equal(propValue(null), '');
    assert.equal(propValue(undefined), '');
  });

  it('handles title type', () => {
    const prop = { type: 'title', title: [{ plain_text: 'My Title' }] };
    assert.equal(propValue(prop), 'My Title');
  });

  it('handles rich_text type', () => {
    const prop = { type: 'rich_text', rich_text: [{ plain_text: 'Some text' }] };
    assert.equal(propValue(prop), 'Some text');
  });

  it('handles number type', () => {
    assert.equal(propValue({ type: 'number', number: 42 }), '42');
    assert.equal(propValue({ type: 'number', number: 0 }), '0');
    assert.equal(propValue({ type: 'number', number: null }), '');
  });

  it('handles select type', () => {
    assert.equal(propValue({ type: 'select', select: { name: 'Option A' } }), 'Option A');
    assert.equal(propValue({ type: 'select', select: null }), '');
  });

  it('handles multi_select type', () => {
    const prop = {
      type: 'multi_select',
      multi_select: [{ name: 'Tag1' }, { name: 'Tag2' }],
    };
    assert.equal(propValue(prop), 'Tag1, Tag2');
    assert.equal(propValue({ type: 'multi_select', multi_select: [] }), '');
  });

  it('handles date type with start only', () => {
    const prop = { type: 'date', date: { start: '2024-01-15' } };
    assert.equal(propValue(prop), '2024-01-15');
  });

  it('handles date type with start and end', () => {
    const prop = { type: 'date', date: { start: '2024-01-15', end: '2024-01-20' } };
    assert.equal(propValue(prop), '2024-01-15 → 2024-01-20');
  });

  it('handles date type with null date', () => {
    assert.equal(propValue({ type: 'date', date: null }), '');
  });

  it('handles checkbox type', () => {
    assert.equal(propValue({ type: 'checkbox', checkbox: true }), '✓');
    assert.equal(propValue({ type: 'checkbox', checkbox: false }), '✗');
  });

  it('handles url type', () => {
    assert.equal(propValue({ type: 'url', url: 'https://example.com' }), 'https://example.com');
    assert.equal(propValue({ type: 'url', url: null }), '');
  });

  it('handles email type', () => {
    assert.equal(propValue({ type: 'email', email: 'test@example.com' }), 'test@example.com');
    assert.equal(propValue({ type: 'email', email: null }), '');
  });

  it('handles phone_number type', () => {
    assert.equal(propValue({ type: 'phone_number', phone_number: '+1234567890' }), '+1234567890');
    assert.equal(propValue({ type: 'phone_number', phone_number: null }), '');
  });

  it('handles status type', () => {
    assert.equal(propValue({ type: 'status', status: { name: 'In Progress' } }), 'In Progress');
    assert.equal(propValue({ type: 'status', status: null }), '');
  });

  it('handles formula type — string', () => {
    assert.equal(propValue({ type: 'formula', formula: { string: 'computed' } }), 'computed');
  });

  it('handles formula type — number', () => {
    assert.equal(propValue({ type: 'formula', formula: { number: 99 } }), '99');
  });

  it('handles formula type — boolean', () => {
    assert.equal(propValue({ type: 'formula', formula: { boolean: true } }), 'true');
  });

  it('handles formula type — date', () => {
    assert.equal(propValue({ type: 'formula', formula: { date: { start: '2024-06-01' } } }), '2024-06-01');
  });

  it('handles formula type — null', () => {
    assert.equal(propValue({ type: 'formula', formula: null }), '');
  });

  it('handles relation type — empty', () => {
    assert.equal(propValue({ type: 'relation', relation: [] }), '');
  });

  it('handles relation type — single', () => {
    const prop = { type: 'relation', relation: [{ id: 'abc12345-6789-0000-0000-000000000000' }] };
    assert.equal(propValue(prop), '→ abc12345…');
  });

  it('handles relation type — multiple', () => {
    const prop = { type: 'relation', relation: [{ id: 'aaa' }, { id: 'bbb' }, { id: 'ccc' }] };
    assert.equal(propValue(prop), '→ 3 linked');
  });

  it('handles rollup type — number', () => {
    assert.equal(propValue({ type: 'rollup', rollup: { type: 'number', number: 100 } }), '100');
  });

  it('handles rollup type — null number', () => {
    assert.equal(propValue({ type: 'rollup', rollup: { type: 'number', number: null } }), '');
  });

  it('handles rollup type — date', () => {
    assert.equal(propValue({ type: 'rollup', rollup: { type: 'date', date: { start: '2026-02-09' } } }), '2026-02-09');
  });

  it('handles rollup type — date range', () => {
    assert.equal(propValue({ type: 'rollup', rollup: { type: 'date', date: { start: '2026-02-01', end: '2026-02-28' } } }), '2026-02-01 → 2026-02-28');
  });

  it('handles rollup type — array', () => {
    const rollup = {
      type: 'array',
      array: [
        { type: 'number', number: 1 },
        { type: 'number', number: 2 },
        { type: 'number', number: 3 },
      ],
    };
    assert.equal(propValue({ type: 'rollup', rollup }), '1, 2, 3');
  });

  it('handles rollup type — empty array', () => {
    assert.equal(propValue({ type: 'rollup', rollup: { type: 'array', array: [] } }), '');
  });

  it('handles rollup type — null', () => {
    assert.equal(propValue({ type: 'rollup', rollup: null }), '');
  });

  it('handles people type', () => {
    const prop = {
      type: 'people',
      people: [{ name: 'Alice' }, { id: 'user-id-123' }],
    };
    assert.equal(propValue(prop), 'Alice, user-id-123');
  });

  it('handles files type', () => {
    const prop = {
      type: 'files',
      files: [
        { name: 'doc.pdf' },
        { external: { url: 'https://example.com/file.png' } },
      ],
    };
    assert.equal(propValue(prop), 'doc.pdf, https://example.com/file.png');
  });

  it('handles created_time type', () => {
    assert.equal(propValue({ type: 'created_time', created_time: '2024-01-01T00:00:00Z' }), '2024-01-01T00:00:00Z');
    assert.equal(propValue({ type: 'created_time', created_time: '' }), '');
  });

  it('handles last_edited_time type', () => {
    assert.equal(propValue({ type: 'last_edited_time', last_edited_time: '2024-06-01T12:00:00Z' }), '2024-06-01T12:00:00Z');
  });

  it('handles created_by type', () => {
    assert.equal(propValue({ type: 'created_by', created_by: { name: 'Bob' } }), 'Bob');
    assert.equal(propValue({ type: 'created_by', created_by: { id: 'uid' } }), 'uid');
    assert.equal(propValue({ type: 'created_by', created_by: null }), '');
  });

  it('handles last_edited_by type', () => {
    assert.equal(propValue({ type: 'last_edited_by', last_edited_by: { name: 'Carol' } }), 'Carol');
  });

  it('handles unknown type — JSON stringified', () => {
    assert.equal(propValue({ type: 'custom_thing', custom_thing: { foo: 'bar' } }), '{"foo":"bar"}');
  });

  it('handles unknown type with null value', () => {
    // null ?? '' → '', JSON.stringify('') → '""'
    assert.equal(propValue({ type: 'mystery', mystery: null }), '""');
  });

  it('handles unknown type with undefined property', () => {
    assert.equal(propValue({ type: 'missing_prop' }), '""');
  });
});

// ─── buildPropValue ────────────────────────────────────────────────────────────

describe('buildPropValue', () => {
  it('builds title property', () => {
    assert.deepEqual(buildPropValue('title', 'Hello'), {
      title: [{ text: { content: 'Hello' } }],
    });
  });

  it('builds rich_text property', () => {
    assert.deepEqual(buildPropValue('rich_text', 'Some text'), {
      rich_text: [{ text: { content: 'Some text' } }],
    });
  });

  it('builds number property', () => {
    assert.deepEqual(buildPropValue('number', '42'), { number: 42 });
    assert.deepEqual(buildPropValue('number', '3.14'), { number: 3.14 });
  });

  it('builds select property', () => {
    assert.deepEqual(buildPropValue('select', 'Option A'), {
      select: { name: 'Option A' },
    });
  });

  it('builds multi_select property with commas', () => {
    assert.deepEqual(buildPropValue('multi_select', 'Tag1, Tag2, Tag3'), {
      multi_select: [{ name: 'Tag1' }, { name: 'Tag2' }, { name: 'Tag3' }],
    });
  });

  it('builds multi_select property with single value', () => {
    assert.deepEqual(buildPropValue('multi_select', 'OnlyTag'), {
      multi_select: [{ name: 'OnlyTag' }],
    });
  });

  it('builds date property', () => {
    assert.deepEqual(buildPropValue('date', '2024-01-15'), {
      date: { start: '2024-01-15' },
    });
  });

  it('builds checkbox property — true values', () => {
    assert.deepEqual(buildPropValue('checkbox', 'true'), { checkbox: true });
    assert.deepEqual(buildPropValue('checkbox', '1'), { checkbox: true });
    assert.deepEqual(buildPropValue('checkbox', 'yes'), { checkbox: true });
  });

  it('builds checkbox property — false values', () => {
    assert.deepEqual(buildPropValue('checkbox', 'false'), { checkbox: false });
    assert.deepEqual(buildPropValue('checkbox', '0'), { checkbox: false });
    assert.deepEqual(buildPropValue('checkbox', 'no'), { checkbox: false });
    assert.deepEqual(buildPropValue('checkbox', 'anything'), { checkbox: false });
  });

  it('builds url property', () => {
    assert.deepEqual(buildPropValue('url', 'https://example.com'), {
      url: 'https://example.com',
    });
  });

  it('builds email property', () => {
    assert.deepEqual(buildPropValue('email', 'user@test.com'), {
      email: 'user@test.com',
    });
  });

  it('builds phone_number property', () => {
    assert.deepEqual(buildPropValue('phone_number', '+1234567890'), {
      phone_number: '+1234567890',
    });
  });

  it('builds status property', () => {
    assert.deepEqual(buildPropValue('status', 'Done'), {
      status: { name: 'Done' },
    });
  });

  it('builds unknown type — raw passthrough', () => {
    assert.deepEqual(buildPropValue('custom_type', 'raw'), {
      custom_type: 'raw',
    });
  });
});

// ─── printTable ────────────────────────────────────────────────────────────────

describe('printTable', () => {
  // Helper to capture stdout
  function captureLog(fn) {
    const lines = [];
    const orig = console.log;
    console.log = (...args) => lines.push(args.join(' '));
    try {
      fn();
    } finally {
      console.log = orig;
    }
    return lines;
  }

  it('prints (no results) for empty rows', () => {
    const lines = captureLog(() => printTable([], ['col']));
    assert.equal(lines.length, 1);
    assert.equal(lines[0], '(no results)');
  });

  it('prints (no results) for null rows', () => {
    const lines = captureLog(() => printTable(null, ['col']));
    assert.equal(lines[0], '(no results)');
  });

  it('prints header, separator, data rows, and count', () => {
    const rows = [{ name: 'Alice', age: '30' }];
    const lines = captureLog(() => printTable(rows, ['name', 'age']));
    // header, separator, 1 data row, blank + count
    assert.ok(lines[0].includes('name'));
    assert.ok(lines[0].includes('age'));
    assert.ok(lines[1].includes('─'));
    assert.ok(lines[2].includes('Alice'));
    assert.ok(lines[2].includes('30'));
    assert.ok(lines[3].includes('1 result'));
  });

  it('pluralizes result count', () => {
    const rows = [{ x: 'a' }, { x: 'b' }];
    const lines = captureLog(() => printTable(rows, ['x']));
    assert.ok(lines[lines.length - 1].includes('2 results'));
  });

  it('truncates values longer than 50 chars', () => {
    const longVal = 'A'.repeat(60);
    const rows = [{ col: longVal }];
    const lines = captureLog(() => printTable(rows, ['col']));
    const dataLine = lines[2];
    assert.ok(dataLine.includes('...'));
    assert.ok(!dataLine.includes(longVal));
  });

  it('caps column width at 50', () => {
    const longVal = 'B'.repeat(100);
    const rows = [{ col: longVal }];
    const lines = captureLog(() => printTable(rows, ['col']));
    // The separator line should have exactly 50 dashes for the column
    const sepParts = lines[1].split('─┼─');
    // Single column so no split, just dashes
    assert.ok(lines[1].length <= 55); // 50 + some padding
  });
});

// ─── pagesToRows ───────────────────────────────────────────────────────────────

describe('pagesToRows', () => {
  it('extracts id and all properties', () => {
    const pages = [{
      id: 'page-123',
      properties: {
        Name: { type: 'title', title: [{ plain_text: 'Test' }] },
        Status: { type: 'select', select: { name: 'Active' } },
      },
    }];
    const rows = pagesToRows(pages);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 'page-123');
    assert.equal(rows[0].Name, 'Test');
    assert.equal(rows[0].Status, 'Active');
  });

  it('handles pages with no properties', () => {
    const pages = [{ id: 'page-456' }];
    const rows = pagesToRows(pages);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 'page-456');
    assert.equal(Object.keys(rows[0]).length, 1);
  });

  it('handles empty pages array', () => {
    assert.deepEqual(pagesToRows([]), []);
  });

  it('handles multiple pages', () => {
    const pages = [
      { id: 'a', properties: { X: { type: 'number', number: 1 } } },
      { id: 'b', properties: { X: { type: 'number', number: 2 } } },
    ];
    const rows = pagesToRows(pages);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].X, '1');
    assert.equal(rows[1].X, '2');
  });
});

// ─── formatCsv ─────────────────────────────────────────────────────────────────

describe('formatCsv', () => {
  it('returns (no results) for empty rows', () => {
    assert.equal(formatCsv([], ['a']), '(no results)');
    assert.equal(formatCsv(null, ['a']), '(no results)');
  });

  it('produces header row', () => {
    const rows = [{ name: 'Alice', age: '30' }];
    const csv = formatCsv(rows, ['name', 'age']);
    const lines = csv.split('\n');
    assert.equal(lines[0], 'name,age');
  });

  it('produces data rows', () => {
    const rows = [{ name: 'Alice', age: '30' }];
    const csv = formatCsv(rows, ['name', 'age']);
    const lines = csv.split('\n');
    assert.equal(lines[1], 'Alice,30');
  });

  it('quotes values with commas', () => {
    const rows = [{ val: 'a, b' }];
    const csv = formatCsv(rows, ['val']);
    const lines = csv.split('\n');
    assert.equal(lines[1], '"a, b"');
  });

  it('escapes double quotes', () => {
    const rows = [{ val: 'say "hello"' }];
    const csv = formatCsv(rows, ['val']);
    const lines = csv.split('\n');
    assert.equal(lines[1], '"say ""hello"""');
  });

  it('quotes values with newlines', () => {
    const rows = [{ val: 'line1\nline2' }];
    const csv = formatCsv(rows, ['val']);
    assert.ok(csv.includes('"line1\nline2"'));
  });

  it('handles null/undefined values', () => {
    const rows = [{ a: null, b: undefined }];
    const csv = formatCsv(rows, ['a', 'b']);
    const lines = csv.split('\n');
    assert.equal(lines[1], ',');
  });
});

// ─── formatYaml ────────────────────────────────────────────────────────────────

describe('formatYaml', () => {
  it('returns (no results) for empty rows', () => {
    assert.equal(formatYaml([], ['a']), '(no results)');
    assert.equal(formatYaml(null, ['a']), '(no results)');
  });

  it('produces correct key: value format', () => {
    const rows = [{ name: 'Alice', status: 'Active' }];
    const yaml = formatYaml(rows, ['name', 'status']);
    assert.ok(yaml.includes('- # result 1'));
    assert.ok(yaml.includes('  name: Alice'));
    assert.ok(yaml.includes('  status: Active'));
  });

  it('quotes values with special YAML characters', () => {
    const rows = [{ val: 'key: value' }];
    const yaml = formatYaml(rows, ['val']);
    assert.ok(yaml.includes('"key: value"'));
  });

  it('quotes empty strings', () => {
    const rows = [{ val: '' }];
    const yaml = formatYaml(rows, ['val']);
    assert.ok(yaml.includes('val: ""'));
  });

  it('separates multiple results with blank lines', () => {
    const rows = [{ x: 'a' }, { x: 'b' }];
    const yaml = formatYaml(rows, ['x']);
    assert.ok(yaml.includes('- # result 1'));
    assert.ok(yaml.includes('- # result 2'));
    const lines = yaml.split('\n');
    // There should be a blank line between result groups
    assert.ok(lines.some(l => l === ''));
  });

  it('escapes double quotes inside values', () => {
    const rows = [{ val: 'say "hi"' }];
    const yaml = formatYaml(rows, ['val']);
    assert.ok(yaml.includes('\\"hi\\"'));
  });
});

// ─── UUID_REGEX ────────────────────────────────────────────────────────────────

describe('UUID_REGEX', () => {
  it('matches standard UUID with dashes', () => {
    assert.ok(UUID_REGEX.test('550e8400-e29b-41d4-a716-446655440000'));
  });

  it('matches UUID without dashes (32 hex chars)', () => {
    assert.ok(UUID_REGEX.test('550e8400e29b41d4a716446655440000'));
  });

  it('matches uppercase UUIDs', () => {
    assert.ok(UUID_REGEX.test('550E8400-E29B-41D4-A716-446655440000'));
  });

  it('matches mixed case UUIDs', () => {
    assert.ok(UUID_REGEX.test('550e8400-E29B-41d4-A716-446655440000'));
  });

  it('rejects short strings', () => {
    assert.ok(!UUID_REGEX.test('abc123'));
    assert.ok(!UUID_REGEX.test(''));
  });

  it('rejects strings with invalid characters', () => {
    assert.ok(!UUID_REGEX.test('550e8400-e29b-41d4-a716-44665544000g'));
    assert.ok(!UUID_REGEX.test('hello-world-this-is-not-a-uuid!'));
  });

  it('rejects alias-like strings', () => {
    assert.ok(!UUID_REGEX.test('my-database'));
    assert.ok(!UUID_REGEX.test('workouts'));
    assert.ok(!UUID_REGEX.test('projects'));
  });
});

// ─── buildFilterFromSchema ─────────────────────────────────────────────────────

describe('buildFilterFromSchema', () => {
  const schema = {
    name: { type: 'title', name: 'Name' },
    description: { type: 'rich_text', name: 'Description' },
    status: { type: 'select', name: 'Status' },
    tags: { type: 'multi_select', name: 'Tags' },
    count: { type: 'number', name: 'Count' },
    done: { type: 'checkbox', name: 'Done' },
    due: { type: 'date', name: 'Due' },
    stage: { type: 'status', name: 'Stage' },
  };

  it('returns error for invalid filter format (no =)', () => {
    const result = buildFilterFromSchema(schema, 'invalid');
    assert.ok(result.error);
    assert.ok(result.error.includes('Invalid filter format'));
  });

  it('returns error for unknown property', () => {
    const result = buildFilterFromSchema(schema, 'nonexistent=value');
    assert.ok(result.error);
    assert.ok(result.available);
    assert.ok(result.available.length > 0);
  });

  it('builds title filter with contains', () => {
    const result = buildFilterFromSchema(schema, 'Name=Hello');
    assert.deepEqual(result.filter, {
      property: 'Name',
      title: { contains: 'Hello' },
    });
  });

  it('builds rich_text filter with contains', () => {
    const result = buildFilterFromSchema(schema, 'Description=test');
    assert.deepEqual(result.filter, {
      property: 'Description',
      rich_text: { contains: 'test' },
    });
  });

  it('builds select filter with equals', () => {
    const result = buildFilterFromSchema(schema, 'Status=Active');
    assert.deepEqual(result.filter, {
      property: 'Status',
      select: { equals: 'Active' },
    });
  });

  it('builds multi_select filter with contains', () => {
    const result = buildFilterFromSchema(schema, 'Tags=Important');
    assert.deepEqual(result.filter, {
      property: 'Tags',
      multi_select: { contains: 'Important' },
    });
  });

  it('builds number filter with equals', () => {
    const result = buildFilterFromSchema(schema, 'Count=42');
    assert.deepEqual(result.filter, {
      property: 'Count',
      number: { equals: 42 },
    });
  });

  it('builds checkbox filter — true', () => {
    const result = buildFilterFromSchema(schema, 'Done=true');
    assert.deepEqual(result.filter, {
      property: 'Done',
      checkbox: { equals: true },
    });
  });

  it('builds checkbox filter — 1', () => {
    const result = buildFilterFromSchema(schema, 'Done=1');
    assert.deepEqual(result.filter, {
      property: 'Done',
      checkbox: { equals: true },
    });
  });

  it('builds checkbox filter — false', () => {
    const result = buildFilterFromSchema(schema, 'Done=false');
    assert.deepEqual(result.filter, {
      property: 'Done',
      checkbox: { equals: false },
    });
  });

  it('builds date filter with equals', () => {
    const result = buildFilterFromSchema(schema, 'Due=2024-01-15');
    assert.deepEqual(result.filter, {
      property: 'Due',
      date: { equals: '2024-01-15' },
    });
  });

  it('builds status filter with equals', () => {
    const result = buildFilterFromSchema(schema, 'Stage=In Progress');
    assert.deepEqual(result.filter, {
      property: 'Stage',
      status: { equals: 'In Progress' },
    });
  });

  it('is case-insensitive for property lookup', () => {
    const result = buildFilterFromSchema(schema, 'NAME=test');
    assert.ok(!result.error);
    assert.equal(result.filter.property, 'Name');
  });

  it('handles values containing = signs', () => {
    const result = buildFilterFromSchema(schema, 'Name=a=b=c');
    assert.deepEqual(result.filter, {
      property: 'Name',
      title: { contains: 'a=b=c' },
    });
  });

  // ─── Rich filter operators ─────────────────────────────────────────────────

  it('builds number greater than filter', () => {
    const result = buildFilterFromSchema(schema, 'Count>100');
    assert.deepEqual(result.filter, {
      property: 'Count',
      number: { greater_than: 100 },
    });
  });

  it('builds number less than filter', () => {
    const result = buildFilterFromSchema(schema, 'Count<50');
    assert.deepEqual(result.filter, {
      property: 'Count',
      number: { less_than: 50 },
    });
  });

  it('builds number greater than or equal filter', () => {
    const result = buildFilterFromSchema(schema, 'Count>=10');
    assert.deepEqual(result.filter, {
      property: 'Count',
      number: { greater_than_or_equal_to: 10 },
    });
  });

  it('builds number less than or equal filter', () => {
    const result = buildFilterFromSchema(schema, 'Count<=99');
    assert.deepEqual(result.filter, {
      property: 'Count',
      number: { less_than_or_equal_to: 99 },
    });
  });

  it('builds not-equal filter for select', () => {
    const result = buildFilterFromSchema(schema, 'Status!=Draft');
    assert.deepEqual(result.filter, {
      property: 'Status',
      select: { does_not_equal: 'Draft' },
    });
  });

  it('builds not-equal filter for title', () => {
    const result = buildFilterFromSchema(schema, 'Name!=Untitled');
    assert.deepEqual(result.filter, {
      property: 'Name',
      title: { does_not_contain: 'Untitled' },
    });
  });

  it('builds date after filter', () => {
    const result = buildFilterFromSchema(schema, 'Due>2024-01-01');
    assert.deepEqual(result.filter, {
      property: 'Due',
      date: { after: '2024-01-01' },
    });
  });

  it('builds date before filter', () => {
    const result = buildFilterFromSchema(schema, 'Due<2024-12-31');
    assert.deepEqual(result.filter, {
      property: 'Due',
      date: { before: '2024-12-31' },
    });
  });

  it('builds date on_or_after filter', () => {
    const result = buildFilterFromSchema(schema, 'Due>=2024-06-01');
    assert.deepEqual(result.filter, {
      property: 'Due',
      date: { on_or_after: '2024-06-01' },
    });
  });
});

// ─── parseFilterOperator ─────────────────────────────────────────────────────

describe('parseFilterOperator', () => {
  it('parses = operator', () => {
    const result = parseFilterOperator('Name=Hello');
    assert.deepEqual(result, { key: 'Name', operator: '=', value: 'Hello' });
  });

  it('parses > operator', () => {
    const result = parseFilterOperator('Amount>100');
    assert.deepEqual(result, { key: 'Amount', operator: '>', value: '100' });
  });

  it('parses >= operator', () => {
    const result = parseFilterOperator('Amount>=50');
    assert.deepEqual(result, { key: 'Amount', operator: '>=', value: '50' });
  });

  it('parses != operator', () => {
    const result = parseFilterOperator('Status!=Done');
    assert.deepEqual(result, { key: 'Status', operator: '!=', value: 'Done' });
  });

  it('parses <= operator', () => {
    const result = parseFilterOperator('Day<=14');
    assert.deepEqual(result, { key: 'Day', operator: '<=', value: '14' });
  });

  it('returns error for missing operator', () => {
    const result = parseFilterOperator('justtext');
    assert.ok(result.error);
  });
});

// ─── resolveRelativeDate ───────────────────────────────────────────────────────

describe('resolveRelativeDate', () => {
  it('resolves today', () => {
    const result = resolveRelativeDate('today');
    // Use local date (same as the function does)
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    assert.equal(result, today.toISOString().split('T')[0]);
  });

  it('resolves yesterday', () => {
    const result = resolveRelativeDate('yesterday');
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    today.setDate(today.getDate() - 1);
    assert.equal(result, today.toISOString().split('T')[0]);
  });

  it('passes through non-keyword values', () => {
    assert.equal(resolveRelativeDate('2024-06-15'), '2024-06-15');
  });
});

// ─── buildCompoundFilter ───────────────────────────────────────────────────────

describe('buildCompoundFilter', () => {
  const schema = {
    name: { type: 'title', name: 'Name' },
    status: { type: 'select', name: 'Status' },
    amount: { type: 'number', name: 'Amount' },
  };

  it('returns single filter for one entry', () => {
    const result = buildCompoundFilter(schema, ['Status=Active']);
    assert.ok(!result.error);
    assert.deepEqual(result.filter, { property: 'Status', select: { equals: 'Active' } });
  });

  it('returns AND compound for multiple filters', () => {
    const result = buildCompoundFilter(schema, ['Status=Active', 'Amount>10']);
    assert.ok(!result.error);
    assert.ok(result.filter.and);
    assert.equal(result.filter.and.length, 2);
    assert.deepEqual(result.filter.and[0], { property: 'Status', select: { equals: 'Active' } });
    assert.deepEqual(result.filter.and[1], { property: 'Amount', number: { greater_than: 10 } });
  });

  it('returns error if any filter is invalid', () => {
    const result = buildCompoundFilter(schema, ['Status=Active', 'bogus']);
    assert.ok(result.error);
  });
});

// ─── markdownToBlocks ──────────────────────────────────────────────────────────

describe('markdownToBlocks', () => {
  it('parses headings', () => {
    const blocks = markdownToBlocks('# Title\n## Subtitle\n### Section');
    assert.equal(blocks.length, 3);
    assert.equal(blocks[0].type, 'heading_1');
    assert.equal(blocks[1].type, 'heading_2');
    assert.equal(blocks[2].type, 'heading_3');
  });

  it('parses paragraphs', () => {
    const blocks = markdownToBlocks('Hello world');
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].type, 'paragraph');
    assert.equal(blocks[0].paragraph.rich_text[0].text.content, 'Hello world');
  });

  it('parses bullet lists', () => {
    const blocks = markdownToBlocks('- Item 1\n- Item 2\n* Item 3');
    assert.equal(blocks.length, 3);
    blocks.forEach(b => assert.equal(b.type, 'bulleted_list_item'));
  });

  it('parses numbered lists', () => {
    const blocks = markdownToBlocks('1. First\n2. Second');
    assert.equal(blocks.length, 2);
    blocks.forEach(b => assert.equal(b.type, 'numbered_list_item'));
  });

  it('parses code blocks', () => {
    const blocks = markdownToBlocks('```javascript\nconst x = 1;\n```');
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].type, 'code');
    assert.equal(blocks[0].code.language, 'javascript');
    assert.equal(blocks[0].code.rich_text[0].text.content, 'const x = 1;');
  });

  it('parses quotes', () => {
    const blocks = markdownToBlocks('> This is a quote');
    assert.equal(blocks[0].type, 'quote');
  });

  it('parses dividers', () => {
    const blocks = markdownToBlocks('---');
    assert.equal(blocks[0].type, 'divider');
  });

  it('parses todo items', () => {
    const blocks = markdownToBlocks('- [ ] Not done\n- [x] Done');
    assert.equal(blocks[0].type, 'to_do');
    assert.equal(blocks[0].to_do.checked, false);
    assert.equal(blocks[1].to_do.checked, true);
  });

  it('skips empty lines', () => {
    const blocks = markdownToBlocks('Line 1\n\nLine 2');
    assert.equal(blocks.length, 2);
  });
});

// ─── parseInlineFormatting ─────────────────────────────────────────────────────

describe('parseInlineFormatting', () => {
  it('parses bold text', () => {
    const result = parseInlineFormatting('Hello **bold** world');
    assert.equal(result.length, 3);
    assert.equal(result[1].annotations.bold, true);
    assert.equal(result[1].text.content, 'bold');
  });

  it('parses italic text', () => {
    const result = parseInlineFormatting('Hello *italic* world');
    assert.equal(result.length, 3);
    assert.equal(result[1].annotations.italic, true);
  });

  it('parses inline code', () => {
    const result = parseInlineFormatting('Use `notion query` here');
    assert.equal(result.length, 3);
    assert.equal(result[1].annotations.code, true);
    assert.equal(result[1].text.content, 'notion query');
  });

  it('parses links', () => {
    const result = parseInlineFormatting('Visit [GitHub](https://github.com) now');
    assert.equal(result.length, 3);
    assert.equal(result[1].text.content, 'GitHub');
    assert.equal(result[1].text.link.url, 'https://github.com');
  });

  it('returns plain text when no formatting', () => {
    const result = parseInlineFormatting('Just plain text');
    assert.equal(result.length, 1);
    assert.equal(result[0].text.content, 'Just plain text');
  });
});

// ─── blocksToMarkdown ──────────────────────────────────────────────────────────

describe('blocksToMarkdown', () => {
  it('converts heading blocks', () => {
    const blocks = [
      { type: 'heading_1', heading_1: { rich_text: [{ plain_text: 'Title' }] } },
      { type: 'heading_2', heading_2: { rich_text: [{ plain_text: 'Sub' }] } },
    ];
    const md = blocksToMarkdown(blocks);
    assert.ok(md.includes('# Title'));
    assert.ok(md.includes('## Sub'));
  });

  it('converts paragraph blocks', () => {
    const blocks = [
      { type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'Hello' }] } },
    ];
    assert.equal(blocksToMarkdown(blocks), 'Hello');
  });

  it('converts code blocks', () => {
    const blocks = [
      { type: 'code', code: { rich_text: [{ plain_text: 'const x = 1;' }], language: 'js' } },
    ];
    const md = blocksToMarkdown(blocks);
    assert.ok(md.includes('```js'));
    assert.ok(md.includes('const x = 1;'));
  });
});

// ─── parseCsv ──────────────────────────────────────────────────────────────────

describe('parseCsv', () => {
  it('parses simple CSV', () => {
    const rows = parseCsv('Name,Status\nTask 1,Done\nTask 2,Todo');
    assert.equal(rows.length, 2);
    assert.equal(rows[0].Name, 'Task 1');
    assert.equal(rows[0].Status, 'Done');
    assert.equal(rows[1].Name, 'Task 2');
  });

  it('handles quoted fields with commas', () => {
    const rows = parseCsv('Name,Notes\n"Task, Important","Note, here"');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].Name, 'Task, Important');
    assert.equal(rows[0].Notes, 'Note, here');
  });

  it('handles escaped quotes', () => {
    const rows = parseCsv('Name\n"He said ""hello"""');
    assert.equal(rows[0].Name, 'He said "hello"');
  });

  it('returns empty for single line', () => {
    const rows = parseCsv('Name,Status');
    assert.equal(rows.length, 0);
  });
});

// ─── kebabToProperty ───────────────────────────────────────────────────────────

describe('kebabToProperty', () => {
  const schema = {
    name: { type: 'title', name: 'Name' },
    status: { type: 'select', name: 'Status' },
    'due date': { type: 'date', name: 'Due Date' },
  };

  it('matches exact lowercase', () => {
    const result = kebabToProperty('name', schema);
    assert.equal(result.name, 'Name');
  });

  it('matches kebab to space', () => {
    const result = kebabToProperty('due-date', schema);
    assert.equal(result.name, 'Due Date');
  });

  it('returns null for no match', () => {
    const result = kebabToProperty('nonexistent', schema);
    assert.equal(result, null);
  });

  it('strips leading dashes', () => {
    const result = kebabToProperty('--status', schema);
    assert.equal(result.name, 'Status');
  });
});

// ─── extractDynamicProps ───────────────────────────────────────────────────────

describe('extractDynamicProps', () => {
  const schema = {
    name: { type: 'title', name: 'Name' },
    status: { type: 'select', name: 'Status' },
    'due date': { type: 'date', name: 'Due Date' },
  };

  it('extracts dynamic property flags', () => {
    const argv = ['node', 'notion', 'add', 'tasks', '--name', 'Ship it', '--status', 'Done'];
    const result = extractDynamicProps(argv, ['prop', 'from'], schema);
    assert.deepEqual(result, ['Name=Ship it', 'Status=Done']);
  });

  it('skips known flags', () => {
    const argv = ['node', 'notion', 'add', 'tasks', '--prop', 'Name=Hello', '--name', 'World'];
    const result = extractDynamicProps(argv, ['prop', 'from'], schema);
    assert.deepEqual(result, ['Name=World']);
  });

  it('handles kebab-case properties', () => {
    const argv = ['node', 'notion', 'add', 'tasks', '--due-date', '2024-06-15'];
    const result = extractDynamicProps(argv, ['prop'], schema);
    assert.deepEqual(result, ['Due Date=2024-06-15']);
  });

  it('ignores flags not in schema', () => {
    const argv = ['node', 'notion', 'add', 'tasks', '--bogus', 'value'];
    const result = extractDynamicProps(argv, ['prop'], schema);
    assert.deepEqual(result, []);
  });
});

// ─── paginate ──────────────────────────────────────────────────────────────────

describe('paginate', () => {
  it('fetches all pages until has_more is false', async () => {
    const pages = [
      { results: [1, 2], has_more: true, next_cursor: 'a', object: 'list' },
      { results: [3], has_more: false, next_cursor: null, object: 'list' },
    ];
    let call = 0;
    const fetchPage = async () => pages[call++];

    const { results, truncated, has_more, next_cursor, response } = await paginate(fetchPage);

    assert.deepEqual(results, [1, 2, 3]);
    assert.equal(truncated, false);
    assert.equal(has_more, false);
    assert.equal(next_cursor, null);
    assert.equal(response.object, 'list');
    assert.deepEqual(response.results, [1, 2, 3]);
  });

  it('respects limit and flags truncation when more results exist', async () => {
    const pages = [
      { results: [1, 2], has_more: true, next_cursor: 'a', object: 'list' },
      { results: [3, 4], has_more: true, next_cursor: 'b', object: 'list' },
    ];
    let call = 0;
    const fetchPage = async () => pages[call++];

    const { results, truncated, has_more, next_cursor } = await paginate(fetchPage, { limit: 3, pageSizeLimit: 2 });

    assert.deepEqual(results, [1, 2, 3]);
    assert.equal(truncated, true);
    assert.equal(has_more, true);
    assert.equal(next_cursor, 'b');
  });

  it('does not truncate when limit equals total results', async () => {
    const pages = [
      { results: [1, 2], has_more: true, next_cursor: 'a', object: 'list' },
      { results: [3], has_more: false, next_cursor: null, object: 'list' },
    ];
    let call = 0;
    const fetchPage = async () => pages[call++];

    const { results, truncated, has_more } = await paginate(fetchPage, { limit: 3, pageSizeLimit: 2 });

    assert.deepEqual(results, [1, 2, 3]);
    assert.equal(truncated, false);
    assert.equal(has_more, false);
  });
});

// ─── withRetry ────────────────────────────────────────────────────────────────

describe('withRetry', () => {
  function rateLimitError() {
    const err = new Error('Rate limited');
    err.status = 429;
    err.code = 'rate_limited';
    err.body = { message: 'Rate limited' };
    return err;
  }

  it('retries rate limit errors and eventually succeeds', async () => {
    let calls = 0;
    const delays = [];
    const fn = async () => {
      calls += 1;
      if (calls < 3) {
        throw rateLimitError();
      }
      return 'ok';
    };

    const result = await withRetry(fn, {
      maxAttempts: 3,
      baseDelayMs: 1000,
      jitter: false,
      sleep: async (ms) => {
        delays.push(ms);
      },
      onRetry: () => {},
    });

    assert.equal(result, 'ok');
    assert.equal(calls, 3);
    assert.deepEqual(delays, [1000, 2000]);
  });

  it('stops after max attempts on repeated rate limits', async () => {
    let calls = 0;
    const fn = async () => {
      calls += 1;
      throw rateLimitError();
    };

    await assert.rejects(
      () => withRetry(fn, {
        maxAttempts: 3,
        baseDelayMs: 10,
        jitter: false,
        sleep: async () => {},
        onRetry: () => {},
      }),
      /Rate limited/,
    );

    assert.equal(calls, 3);
  });

  it('does not retry non-rate-limit errors', async () => {
    let calls = 0;
    const err = new Error('Boom');
    err.status = 400;
    err.code = 'invalid_request';
    err.body = { message: 'Boom' };

    await assert.rejects(
      () => withRetry(async () => {
        calls += 1;
        throw err;
      }, {
        maxAttempts: 3,
        baseDelayMs: 10,
        jitter: false,
        sleep: async () => {},
        onRetry: () => {},
      }),
      /Boom/,
    );

    assert.equal(calls, 1);
  });
});
