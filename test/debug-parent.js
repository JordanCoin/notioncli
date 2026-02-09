const { Client } = require('@notionhq/client');
const h = require('../lib/helpers');
const notion = new Client({ auth: h.loadConfig(h.getConfigPaths().CONFIG_PATH).apiKey });
const parentId = '302903e2-cff4-8059-b808-e3c953fd7d26';

(async () => {
  const db = await notion.databases.create({
    parent: { type: 'page_id', page_id: parentId },
    title: [{ text: { content: 'Quick Test DB' } }],
    properties: { Name: { title: {} }, Priority: { number: {} } }
  });
  console.log('DB created:', db.id.slice(0,8));
  console.log('DB keys with id:', Object.keys(db).filter(k => k.includes('id')));
  console.log('database_id:', db.database_id);

  await new Promise(r => setTimeout(r, 2000));

  for (const pt of ['data_source_id', 'database_id']) {
    const pid = pt === 'database_id' && db.database_id ? db.database_id : db.id;
    try {
      const page = await notion.pages.create({
        parent: { type: pt, [pt]: pid },
        properties: { Name: { title: [{ text: { content: 'test ' + pt } }] } }
      });
      console.log(pt, 'WORKS:', page.id.slice(0,8));
      await notion.pages.update({ page_id: page.id, archived: true });
    } catch(e) { console.log(pt, 'FAILED:', e.code, e.message.slice(0,100)); }
  }

  await notion.blocks.delete({ block_id: db.id });
  console.log('cleaned');
})();
