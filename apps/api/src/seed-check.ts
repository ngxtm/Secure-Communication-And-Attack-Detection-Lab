import { loadDemoUsers } from './seed-config.js';

try {
  loadDemoUsers();
  console.info('Demo account configuration is valid.');
} catch (error) {
  const message = error instanceof Error ? error.message : '';
  if (message.startsWith('SEED_') || message.startsWith('Set a real SEED_')) {
    console.error(`Seed configuration failed: ${message}`);
  } else {
    console.error('Seed configuration is invalid; credential details are hidden.');
  }
  process.exitCode = 1;
}
