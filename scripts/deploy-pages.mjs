// dist/ を gh-pages ブランチとして push する（GitHub Pages 配信用）。問題データの JSON は含まれない。
import { execSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';

const run = (cmd, cwd = 'dist') => execSync(cmd, { cwd, stdio: 'inherit' });
if (!existsSync('dist/index.html')) throw new Error('先に npm run build を実行してください');
const remote = execSync('git remote get-url origin').toString().trim();
writeFileSync('dist/.nojekyll', '');
run('rm -rf .git && git init -q && git checkout -q -b gh-pages');
run('git add -A');
run('git -c user.name=deploy -c user.email=deploy@localhost commit -q -m "deploy"');
run(`git push -f ${remote} gh-pages`);
run('rm -rf .git');
console.log('公開しました: https://kota-mochizuki.github.io/cfp-study/');
