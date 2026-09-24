export interface DemoUserSeed {
  username: string;
  displayName: string;
  password: string;
}

export function loadDemoUsers(): DemoUserSeed[] {
  return [
    {
      username: 'alice',
      displayName: 'Alice',
      password: requireSeedPassword('SEED_ALICE_PASSWORD'),
    },
    {
      username: 'bob',
      displayName: 'Bob',
      password: requireSeedPassword('SEED_BOB_PASSWORD'),
    },
  ];
}

function requireSeedPassword(variable: string): string {
  const password = process.env[variable];
  const passwordBytes = password ? Buffer.byteLength(password) : 0;

  if (!password || passwordBytes < 20 || passwordBytes > 128) {
    throw new Error(`${variable} must be 20-128 bytes long.`);
  }

  if (/^(replace|change_me|changeme|todo)/i.test(password)) {
    throw new Error(`Set a real ${variable} in the environment.`);
  }

  return password;
}
