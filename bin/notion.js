#!/usr/bin/env node

const { program } = require('commander');
const { createContext } = require('../lib/context');

program
  .name('notion')
  .description('A powerful CLI for the Notion API — query databases, manage pages, and automate your workspace from the terminal.')
  .version('1.3.0')
  .option('--json', 'Output raw JSON instead of formatted tables')
  .option('-w, --workspace <name>', 'Use a specific workspace profile');

const ctx = createContext(program);

// Register all command modules
require('../commands/config').register(program, ctx);
require('../commands/search').register(program, ctx);
require('../commands/query').register(program, ctx);
require('../commands/crud').register(program, ctx);
require('../commands/blocks').register(program, ctx);
require('../commands/database').register(program, ctx);
require('../commands/users').register(program, ctx);
require('../commands/comments').register(program, ctx);
require('../commands/pages').register(program, ctx);
require('../commands/import-export').register(program, ctx);
require('../commands/upload').register(program, ctx);

program.parseAsync(process.argv);
