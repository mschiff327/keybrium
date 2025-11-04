import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const packages = ['packages/auth','packages/react','packages/react-native'];
let failed = false;

for (const pkg of packages) {
  const dist = join(pkg, 'dist');
  try {
    const entries = readdirSync(dist).filter(f => !f.startsWith('.'));
    const hasJS = entries.some(f => f.endsWith('.js'));
    const hasDTS = entries.some(f => f.endsWith('.d.ts'));

    if (!entries.length || !hasJS || !hasDTS) {
      console.error(`✖ ${pkg}: dist/ missing expected build artifacts (.js and .d.ts)`);
      failed = true;
    } else {
      const total = entries
          .map(f => statSync(join(dist, f)).size)
          .reduce((a,b)=>a+b,0);
      if (total < 200) {
        console.error(`✖ ${pkg}: dist/ looks suspiciously small (${total} bytes)`);
        failed = true;
      } else {
        console.log(`✓ ${pkg}: build artifacts OK (${entries.length} files)`);
      }
    }
  } catch {
    console.error(`✖ ${pkg}: dist/ not found`);
    failed = true;
  }
}

if (failed) process.exit(1);
