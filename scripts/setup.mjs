// Одноразовая настройка: node scripts/setup.mjs  (или npm run setup)
import { existsSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const run = (cmd, args) => spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' }).status === 0;
const has = (cmd) => spawnSync(cmd, ['--version'], { stdio: 'ignore', shell: process.platform === 'win32' }).status === 0;

const missing = [['node', 'Node.js 20+'], ['docker', 'Docker Desktop'], ['cargo', 'Rust (https://rustup.rs)']].filter(([c]) => !has(c));
if (missing.length) {
  console.error('Установите: ' + missing.map(([, n]) => n).join(', '));
  process.exit(1);
}

const env = 'backend/.env';
if (!existsSync(env)) {
  copyFileSync('backend/.env.example', env);
  writeFileSync(env, readFileSync(env, 'utf8').replace(/^SECRETS_KEY=.*$/m, `SECRETS_KEY=${randomBytes(32).toString('hex')}`));
  console.log('✓ создан backend/.env (со своим SECRETS_KEY)');
} else {
  console.log('• backend/.env уже есть, не трогаю');
}

if (!run('npm', ['install'])) process.exit(1);
if (!run('docker', ['compose', 'up', '-d', 'db'])) process.exit(1);
console.log('\n✓ Готово. Запуск: npm run dev:all  → http://localhost:5173');
