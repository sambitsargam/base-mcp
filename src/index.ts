#!/usr/bin/env node
import { init } from './cli/init.js';
import { main } from './main.js';

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
});

const [cmd] = process.argv.slice(2);
if (cmd === '--init') {
  await init();
} else {
  main().catch((error) => {
    console.error('Fatal error in main():', error);
    process.exit(1);
  });
}
