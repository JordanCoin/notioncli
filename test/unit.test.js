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
  buildFilterFromSchema,
  UUID_REGEX,
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

  it('handles relation type', () => {
    const prop = { type: 'relation', relation: [{ id: 'abc' }, { id: 'def' }] };
    assert.equal(propValue(prop), 'abc, def');
    assert.equal(propValue({ type: 'relation', relation: [] }), '');
  });

  it('handles rollup type', () => {
    const rollupData = { type: 'number', number: 100 };
    assert.equal(propValue({ type: 'rollup', rollup: rollupData }), JSON.stringify(rollupData));
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
});
