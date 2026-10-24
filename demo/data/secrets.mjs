import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

export async function persistDemoSecrets(secrets) {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'twenty-secrets-'));
  try {
    const environmentPath = join(temporaryDirectory, 'secrets.env');
    await writeFile(
      environmentPath,
      Object.entries(secrets)
        .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
        .join('\n') + '\n',
      { mode: 0o600 },
    );
    const stored = spawnSync(
      'infisical',
      [
        'secrets',
        'set',
        '--projectId',
        'c41f4ae6-3f02-4165-a4a4-3ea9043a6e6c',
        '--env',
        'dev',
        '--path',
        '/twenty-materic-demo-product',
        '--file',
        environmentPath,
        '--silent',
      ],
      { encoding: 'utf8' },
    );
    if (stored.status !== 0)
      throw new Error(
        `Infisical persistence failed (exit ${stored.status}); recover from the private state before continuing`,
      );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
