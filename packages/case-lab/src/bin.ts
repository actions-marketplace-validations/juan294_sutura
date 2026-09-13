import { runCaseLabCli } from './cli.js';

process.exitCode = await runCaseLabCli(process.argv.slice(2));
