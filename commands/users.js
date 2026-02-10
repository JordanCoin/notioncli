module.exports = {
  register(program, ctx) {
    const {
      getNotion,
      paginate,
      jsonOutput,
      printTable,
      runCommand,
    } = ctx;

    // ─── users ───────────────────────────────────────────────────────────────
    program
      .command('users')
      .description('List all users in the workspace')
      .action(async (opts, cmd) => runCommand('Users', async () => {
        const notion = getNotion();
        const { results, response } = await paginate(
          ({ start_cursor, page_size }) => notion.users.list({ start_cursor, page_size }),
          { pageSizeLimit: 100 },
        );
        if (jsonOutput(cmd, response)) return;
        const rows = results.map(u => ({
          id: u.id,
          name: u.name || '',
          type: u.type || '',
          email: (u.person && u.person.email) || '',
        }));
        printTable(rows, ['id', 'name', 'type', 'email']);
      }));

    // ─── user ────────────────────────────────────────────────────────────────
    program
      .command('user <user-id>')
      .description('Get user details')
      .action(async (userId, opts, cmd) => runCommand('User', async () => {
        const notion = getNotion();
        const user = await notion.users.retrieve({ user_id: userId });
        if (jsonOutput(cmd, user)) return;
        console.log(`User: ${user.id}`);
        console.log(`Name: ${user.name || '(unnamed)'}`);
        console.log(`Type: ${user.type || ''}`);
        if (user.person && user.person.email) {
          console.log(`Email: ${user.person.email}`);
        }
        if (user.avatar_url) {
          console.log(`Avatar: ${user.avatar_url}`);
        }
        if (user.bot) {
          console.log(`Bot Owner: ${JSON.stringify(user.bot.owner || {})}`);
        }
      }));

    // ─── me ──────────────────────────────────────────────────────────────────
    program
      .command('me')
      .description('Show details about the current integration/bot')
      .action(async (opts, cmd) => runCommand('Me', async () => {
        const notion = getNotion();
        const me = await notion.users.me({});
        if (jsonOutput(cmd, me)) return;
        console.log(`Bot: ${me.name || '(unnamed)'}`);
        console.log(`ID: ${me.id}`);
        console.log(`Type: ${me.type}`);
        if (me.bot?.owner) {
          const owner = me.bot.owner;
          console.log(`Owner: ${owner.type === 'workspace' ? 'Workspace' : owner.user?.name || owner.type}`);
        }
        if (me.avatar_url) {
          console.log(`Avatar: ${me.avatar_url}`);
        }
      }));
  },
};
