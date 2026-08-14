#!/usr/bin/env node
'use strict';

// create-tester 入口:用 tsx 运行 TypeScript 源码
// 需要 Node 20.6+

const { spawnSync } = require('child_process');
const path = require('path');

const tsxEntry = require.resolve('tsx/cli');

const result = spawnSync(
  process.execPath,
  [tsxEntry, path.join(__dirname, '..', 'src', 'index.ts'), ...process.argv.slice(2)],
  { stdio: 'inherit' }
);
process.exit(result.status ?? 1);
