// test/integration.test.js — Live API tests (optional, requires NOTION_API_KEY)

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execSync } = require('child_process');
const path = require('path');

const SKIP = !process.env.NOTION_API_KEY;
const CLI = path.resolve(__dirname, '..', 'bin', 'notion.js');

function run(args, opts = {}) {
  const result = execSync(`node ${CLI} ${args}`, {
    encoding: 'utf-8',
    timeout: 30000,
    env: { ...process.env },
    ...opts,
  });
  return result.trim();
}

function runJSON(args) {
  const output = run(`--json ${args}`);
  return JSON.parse(output);
}

describe('Integration tests (live API)', { skip: SKIP ? 'NOTION_API_KEY not set' : false }, () => {
  describe('notion dbs', () => {
    it('returns at least 1 database', () => {
      const result = runJSON('dbs');
      assert.ok(result.results, 'Expected results array');
      assert.ok(result.results.length >= 1, `Expected at least 1 database, got ${result.results.length}`);
    });
  });

  describe('notion search', () => {
    it('search returns results', () => {
      const result = runJSON('search "test"');
      assert.ok(result.results, 'Expected results array');
    });
  });

  describe('notion users', () => {
    it('returns at least 1 user', () => {
      const result = runJSON('users');
      assert.ok(result.results, 'Expected results array');
      assert.ok(result.results.length >= 1, `Expected at least 1 user, got ${result.results.length}`);
    });
  });

  describe('CRUD round-trip', () => {
    // This test requires a configured alias. We'll try to find one.
    let alias;
    let createdPageId;
    const testName = `TEST_ENTRY_${Date.now()}`;

    before(() => {
      // Look for an alias in the config
      try {
        const output = run('alias list');
        // Parse the table output to find at least one alias
        const lines = output.split('\n');
        // Skip header and separator (first 2 lines), grab first data line
        if (lines.length >= 3) {
          const dataLine = lines[2];
          alias = dataLine.split(/\s+│\s+/)[0]?.trim();
        }
      } catch (e) {
        // No aliases configured
      }
    });

    it('add a page', { skip: !alias ? 'No alias configured for CRUD test' : false }, () => {
      const result = runJSON(`add ${alias} --prop "Name=${testName}"`);
      assert.ok(result.id, 'Expected page id in response');
      createdPageId = result.id;
    });

    it('query to find the page', { skip: !alias ? 'No alias configured' : false }, () => {
      if (!createdPageId) return;
      const result = runJSON(`query ${alias} --filter "Name=${testName}"`);
      assert.ok(result.results, 'Expected results');
      assert.ok(result.results.length >= 1, 'Expected at least 1 result');
      const found = result.results.some(p => p.id === createdPageId);
      assert.ok(found, 'Expected to find created page');
    });

    it('get the page', { skip: !alias ? 'No alias configured' : false }, () => {
      if (!createdPageId) return;
      const result = runJSON(`get ${createdPageId}`);
      assert.equal(result.id, createdPageId);
    });

    it('delete (archive) the page', { skip: !alias ? 'No alias configured' : false }, () => {
      if (!createdPageId) return;
      const result = runJSON(`delete ${createdPageId}`);
      assert.equal(result.archived, true);
    });

    after(() => {
      // Cleanup: ensure the page is archived even if a test failed
      if (createdPageId) {
        try {
          run(`delete ${createdPageId}`);
        } catch (e) {
          // Already archived or doesn't exist
        }
      }
    });
  });
});
