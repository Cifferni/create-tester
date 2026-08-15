#!/usr/bin/env node
// MCP server 薄壳:真实引擎在 @create-tester/core(依赖版本管理,升级不再靠覆盖文件)
// 升级:项目根目录跑 npm update @create-tester/core 即可,本文件无需改动。
require('@create-tester/core/dist/mcp/server.cjs');
