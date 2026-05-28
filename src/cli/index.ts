#!/usr/bin/env node
import { Command } from 'commander';
import { registerLogin } from './commands/login.js';
import { registerKeys } from './commands/keys.js';
import { registerProject } from './commands/project.js';
import { registerMember } from './commands/member.js';
import { registerKb } from './commands/kb.js';
import { registerMilestone } from './commands/milestone.js';
import { registerTask } from './commands/task.js';
import { registerContext } from './commands/context.js';
import { runInit } from '../init/index.js';

const program = new Command();
program.name('contextsync').description('contextsync CLI').version('0.1.0');

program.command('init')
  .description('install skill, register MCP server, save config')
  .option('--upgrade', 'refresh skill template from this package')
  .option('--uninstall', 'remove skill, MCP entry, config')
  .action(runInit);

registerLogin(program);
registerKeys(program);
registerProject(program);
registerMember(program);
registerKb(program);
registerMilestone(program);
registerTask(program);
registerContext(program);

program.parseAsync().catch((e) => { process.stderr.write(`error: ${e.message}\n`); process.exit(1); });
