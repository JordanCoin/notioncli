#!/usr/bin/env node
// Live integration test: Relations, Rollups & Blocks CRUD
// Creates temp databases, links them, tests CLI output, cleans up.

const { Client } = require('@notionhq/client');
const { execSync } = require('child_process');
const path = require('path');

const CLI = path.join(__dirname, '..', 'bin', 'notion.js');
const run = (cmd) => execSync(`node ${CLI} ${cmd}`, { encoding: 'utf-8' }).trim();
const runJson = (cmd) => JSON.parse(execSync(`node ${CLI} --json ${cmd}`, { encoding: 'utf-8' }));

const notion = new Client({ auth: process.env.NOTION_API_KEY || require('../lib/helpers').loadConfig(
  require('../lib/helpers').getConfigPaths().CONFIG_PATH
).apiKey });

let parentPageId = null;
let projectsDbId = null;
let projectsDsId = null;
let tasksDbId = null;
let tasksDsId = null;
let testPageIds = [];
let createdDbIds = [];

async function setup() {
  console.log('\n🔧 Setting up test databases...\n');

  // Create a dedicated test page as parent (needs to be under a page the integration can access)
  // First, find an existing page the integration has access to
  const search = await notion.search({ filter: { value: 'page', property: 'object' }, page_size: 20 });
  
  // Look for a top-level page (parent is workspace), or any page that's not inside a database
  let rootPageId = null;
  for (const p of search.results) {
    if (p.parent?.type === 'workspace' || p.parent?.type === 'page_id') {
      rootPageId = p.id;
      break;
    }
  }

  if (!rootPageId) {
    // No standalone page found — create the DBs using the workspace parent directly
    // by creating a page in the integration's space
    console.log('No standalone page found. Will use first available page.');
    rootPageId = search.results[0]?.id;
    if (!rootPageId) throw new Error('No pages accessible by integration');
  }

  // Create a test container page
  const containerPage = await notion.pages.create({
    parent: { type: 'page_id', page_id: rootPageId },
    properties: {
      title: { title: [{ text: { content: 'CLI Test Container (auto-delete)' } }] },
    },
  });
  parentPageId = containerPage.id;
  testPageIds.push(parentPageId);
  console.log(`📄 Created test container page: ${parentPageId.slice(0, 8)}…`);

  // 1. Create "CLI Test Projects" database
  console.log('\nCreating Projects DB...');
  const projectsDb = await notion.databases.create({
    parent: { type: 'page_id', page_id: parentPageId },
    title: [{ text: { content: 'CLI Test Projects' } }],
    properties: {
      'Name': { title: {} },
      'Status': { select: { options: [
        { name: 'Active', color: 'green' },
        { name: 'Done', color: 'gray' },
      ]}},
      'Priority': { number: {} },
    },
  });
  // databases.create() returns: .id = data_source_id, .database_id = database_id for page creation
  projectsDsId = projectsDb.id;
  projectsDbId = projectsDb.database_id || projectsDb.id;
  createdDbIds.push(projectsDb.id);
  console.log(`✅ Projects DB (db: ${projectsDbId.slice(0, 8)}…, ds: ${projectsDsId.slice(0, 8)}…)`);

  // 2. Create "CLI Test Tasks" database with relation to Projects
  console.log('Creating Tasks DB with relation...');
  const tasksDb = await notion.databases.create({
    parent: { type: 'page_id', page_id: parentPageId },
    title: [{ text: { content: 'CLI Test Tasks' } }],
    properties: {
      'Name': { title: {} },
      'Done': { checkbox: {} },
      'Project': { relation: { database_id: projectsDbId } },
    },
  });
  tasksDsId = tasksDb.id;
  tasksDbId = tasksDb.database_id || tasksDb.id;
  createdDbIds.push(tasksDb.id);
  console.log(`✅ Tasks DB (db: ${tasksDbId.slice(0, 8)}…, ds: ${tasksDsId.slice(0, 8)}…)`);

  // 3. Add project pages
  console.log('\nAdding test data...');
  const proj1 = await notion.pages.create({
    parent: { type: 'database_id', database_id: projectsDbId },
    properties: {
      'Name': { title: [{ text: { content: 'Build CLI' } }] },
      'Status': { select: { name: 'Active' } },
      'Priority': { number: 1 },
    },
  });
  testPageIds.push(proj1.id);
  console.log(`  📌 Project: "Build CLI"`);

  const proj2 = await notion.pages.create({
    parent: { type: 'database_id', database_id: projectsDbId },
    properties: {
      'Name': { title: [{ text: { content: 'Write Docs' } }] },
      'Status': { select: { name: 'Done' } },
      'Priority': { number: 2 },
    },
  });
  testPageIds.push(proj2.id);
  console.log(`  📌 Project: "Write Docs"`);

  // 4. Add task pages linked to projects
  const task1 = await notion.pages.create({
    parent: { type: 'database_id', database_id: tasksDbId },
    properties: {
      'Name': { title: [{ text: { content: 'Implement relations' } }] },
      'Done': { checkbox: true },
      'Project': { relation: [{ id: proj1.id }] },
    },
  });
  testPageIds.push(task1.id);
  console.log(`  📋 Task: "Implement relations" → Build CLI`);

  const task2 = await notion.pages.create({
    parent: { type: 'database_id', database_id: tasksDbId },
    properties: {
      'Name': { title: [{ text: { content: 'Add tests' } }] },
      'Done': { checkbox: false },
      'Project': { relation: [{ id: proj1.id }] },
    },
  });
  testPageIds.push(task2.id);
  console.log(`  📋 Task: "Add tests" → Build CLI`);

  const task3 = await notion.pages.create({
    parent: { type: 'database_id', database_id: tasksDbId },
    properties: {
      'Name': { title: [{ text: { content: 'Write README' } }] },
      'Done': { checkbox: true },
      'Project': { relation: [{ id: proj2.id }] },
    },
  });
  testPageIds.push(task3.id);
  console.log(`  📋 Task: "Write README" → Write Docs`);

  // 5. Register CLI aliases
  run(`alias add test-projects ${projectsDsId}`);
  run(`alias add test-tasks ${tasksDsId}`);
  console.log(`\n✅ Aliases registered: test-projects, test-tasks\n`);
}

async function runTests() {
  let passed = 0;
  let failed = 0;

  function check(name, condition, detail) {
    if (condition) {
      console.log(`  ✅ ${name}`);
      passed++;
    } else {
      console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
      failed++;
    }
  }

  console.log('🧪 Running live tests...\n');

  // --- Test 1: Query tasks — relation column formatting ---
  console.log('--- 1. query (relation display) ---');
  try {
    const out = run('query test-tasks');
    check('query shows tasks', out.includes('Implement relations'));
    check('relation shows → format', out.includes('→'));
    console.log(`\n${out.split('\n').map(l => '    ' + l).join('\n')}\n`);
  } catch (e) { check('query test-tasks', false, e.message); }

  // --- Test 2: Get task — resolve relation to project title ---
  console.log('--- 2. get (relation resolution) ---');
  try {
    const out = run('get test-tasks --filter "Name=Implement relations"');
    check('get resolves relation to title', out.includes('Build CLI'));
    check('get shows URL', out.includes('notion.so'));
    console.log(`\n${out.split('\n').map(l => '    ' + l).join('\n')}\n`);
  } catch (e) { check('get with relation', false, e.message); }

  // --- Test 3: Relations command — graph explorer ---
  console.log('--- 3. relations (graph explorer) ---');
  try {
    const out = run('relations test-tasks --filter "Name=Implement relations"');
    check('relations shows linked pages', out.includes('linked') || out.includes('Build CLI'));
    console.log(`\n${out.split('\n').map(l => '    ' + l).join('\n')}\n`);
  } catch (e) { check('relations command', false, e.message); }

  // --- Test 4: Reverse relation (project → tasks) ---
  console.log('--- 4. reverse relation ---');
  try {
    const out = run('relations test-projects --filter "Name=Build CLI"');
    const hasLinks = out.includes('Implement') || out.includes('Add tests') || out.includes('linked');
    check('project shows reverse relations', hasLinks);
    console.log(`\n${out.split('\n').map(l => '    ' + l).join('\n')}\n`);
  } catch (e) { check('reverse relation', false, e.message); }

  // --- Test 5: Blocks --ids ---
  console.log('--- 5. blocks --ids ---');
  try {
    run('append test-tasks "Test block for live test" --filter "Name=Implement relations"');
    const out = run('blocks test-tasks --filter "Name=Implement relations" --ids');
    check('blocks --ids shows ID prefix', out.includes('['));
    check('blocks shows appended text', out.includes('Test block'));
    console.log(`\n${out.split('\n').map(l => '    ' + l).join('\n')}\n`);
  } catch (e) { check('blocks --ids', false, e.message); }

  // --- Test 6: Block edit ---
  console.log('--- 6. block-edit ---');
  try {
    const json = runJson('blocks test-tasks --filter "Name=Implement relations"');
    const blockId = json.results[json.results.length - 1].id;
    const out = run(`block-edit ${blockId} "EDITED by CLI test"`);
    check('block-edit succeeds', out.includes('✅'));
    const verify = run('blocks test-tasks --filter "Name=Implement relations"');
    check('edited content visible', verify.includes('EDITED'));
    console.log(`\n${verify.split('\n').map(l => '    ' + l).join('\n')}\n`);
  } catch (e) { check('block-edit', false, e.message); }

  // --- Test 7: Block delete ---
  console.log('--- 7. block-delete ---');
  try {
    const json = runJson('blocks test-tasks --filter "Name=Implement relations"');
    const blockId = json.results[json.results.length - 1].id;
    const out = run(`block-delete ${blockId}`);
    check('block-delete succeeds', out.includes('🗑'));
    const verify = run('blocks test-tasks --filter "Name=Implement relations"');
    check('deleted content gone', !verify.includes('EDITED'));
  } catch (e) { check('block-delete', false, e.message); }

  // --- Test 8: JSON output preserves relation data ---
  console.log('--- 8. json output ---');
  try {
    const json = runJson('get test-tasks --filter "Name=Implement relations"');
    check('json has properties', !!json.properties);
    check('json has relation property', !!json.properties.Project);
    check('relation type correct', json.properties.Project.type === 'relation');
    check('relation has linked IDs', json.properties.Project.relation.length > 0);
  } catch (e) { check('json output', false, e.message); }

  // --- Test 9: Query projects with rollup-like display ---
  console.log('--- 9. query projects ---');
  try {
    const out = run('query test-projects');
    check('query shows projects', out.includes('Build CLI'));
    check('query shows both projects', out.includes('Write Docs'));
    console.log(`\n${out.split('\n').map(l => '    ' + l).join('\n')}\n`);
  } catch (e) { check('query projects', false, e.message); }

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed}`);
  console.log('═'.repeat(50));
  
  return failed;
}

async function cleanup() {
  console.log('\n🧹 Cleaning up...');
  
  // Archive pages first (before their parent DBs get deleted)
  for (const id of testPageIds.filter(id => !createdDbIds.includes(id))) {
    try { await notion.pages.update({ page_id: id, archived: true }); } catch {}
  }
  
  // Then delete DBs and container page
  for (const id of createdDbIds) {
    try { await notion.blocks.delete({ block_id: id }); } catch {}
  }
  
  // Delete container page last
  if (parentPageId) {
    try { await notion.blocks.delete({ block_id: parentPageId }); } catch {}
  }

  try { run('alias remove test-projects'); } catch {}
  try { run('alias remove test-tasks'); } catch {}
  
  console.log('✅ Cleaned up\n');
}

async function main() {
  try {
    await setup();
    const failures = await runTests();
    await cleanup();
    process.exit(failures > 0 ? 1 : 0);
  } catch (err) {
    console.error('\n💥 Test crashed:', err.message);
    if (err.body) console.error('API body:', JSON.stringify(err.body).slice(0, 500));
    if (err.stack) console.error(err.stack);
    await cleanup().catch(() => {});
    process.exit(1);
  }
}

main();
