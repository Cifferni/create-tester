// 方向键单选菜单 + 终端样式工具(共享给 login.cjs / test.cjs 用),无第三方依赖。
// 例:
//   const { pickItem } = require('./_menu.cjs');
//   const env = await pickItem('请选择环境', ['test', 'uat', 'prod'], 'test');
const readline = require('readline');

// ── 终端颜色/样式工具(非 TTY 时自动去掉颜色,避免管道里出现乱码) ──
const USE_COLOR = process.stdout.isTTY;
const wrap = (code) => (s) => (USE_COLOR ? `\u001b[${code}m${s}\u001b[0m` : String(s));
const style = {
  bold: wrap('1'),
  dim: wrap('2'),
  cyan: wrap('36'),
  green: wrap('32'),
  yellow: wrap('33'),
  red: wrap('31'),
  magenta: wrap('35')
};

/**
 * 在终端渲染一个可键盘操作的单选菜单。
 * @param {string} title 菜单标题
 * @param {string[]} items 选项列表
 * @param {string} [defaultItem] 初始高亮项
 * @returns {Promise<string>} 选中的项
 */
function pickItem(title, items, defaultItem) {
  return new Promise((resolve) => {
    // 非交互终端(管道/CI/无 TTY):不能用方向键,直接选默认项,避免卡住
    if (!process.stdin.isTTY) {
      const fallback = defaultItem || items[0];
      console.log(title);
      console.log(`  ${style.cyan('>')} ${fallback}${style.dim(' (非交互终端,直接使用默认项)')}`);
      resolve(fallback);
      return;
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let index = Math.max(0, items.indexOf(defaultItem));

    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();

    const render = () => {
      console.log(style.bold(title));
      items.forEach((item, i) => {
        if (i === index) console.log(`  ${style.cyan('❯')} ${style.bold(item)}`);
        else console.log(`    ${style.dim(item)}`);
      });
      console.log(`  ${style.dim('↑/↓ 移动 · 回车 确认')}`);
    };

    const clear = () => {
      // 向上清理掉已渲染的行数:标题 1 行 + 每项 1 行 + 底部提示 1 行
      const lines = items.length + 2;
      readline.moveCursor(process.stdout, 0, -lines);
      readline.clearScreenDown(process.stdout);
    };

    const onKey = (str, key) => {
      if (key.name === 'up' && index > 0) {
        index--;
        clear();
        render();
      } else if (key.name === 'down' && index < items.length - 1) {
        index++;
        clear();
        render();
      } else if (key.name === 'return' || key.name === 'enter') {
        finish();
      } else if (key.ctrl && key.name === 'c') {
        finishQuit();
      }
    };

    const finishQuit = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      rl.close();
      process.exit(1);
    };

    const finish = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      rl.close();
      resolve(items[index]);
    };

    render();
    process.stdin.on('keypress', onKey);
  });
}

/**
 * 终端文本框输入(带默认值,回车确认),适合"自定义账号名"等场景。
 * 非 TTY 时直接返回默认值。
 * @param {string} prompt 提示语
 * @param {string} [defaultValue] 默认值(回车直接用)
 * @returns {Promise<string>} 输入的值
 */
function inputText(prompt, defaultValue) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      const fallback = defaultValue || '';
      console.log(`${prompt} ${style.dim(`(${fallback})`)}`);
      resolve(fallback);
      return;
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const hint = defaultValue ? style.dim(` [${defaultValue}]`) : '';
    rl.question(`${prompt}${hint} `, (ans) => {
      rl.close();
      resolve(ans.trim() || defaultValue || '');
    });
  });
}

module.exports = { pickItem, style, spinner, inputText };

/**
 * 简易终端等待动画(spinner),适合"正在连接/等待结果"等短等待场景。
 * 非 TTY(管道/CI)时自动退化为不显示,避免乱码。
 * 用法:
 *   const spin = spinner('正在探测环境...');
 *   await doSomething();
 *   spin.stop('✓ 完成');   // 或 spin.fail('✗ 失败')
 */
function spinner(text) {
  if (!process.stdout.isTTY) {
    return {
      stop: () => {},
      fail: () => {}
    };
  }
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  let stopped = false;
  const timer = setInterval(() => {
    if (stopped) return;
    const frame = frames[i++ % frames.length];
    process.stdout.write(`\r  ${style.cyan(frame)} ${style.dim(text)}`);
  }, 80);
  const end = (label, color) => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    process.stdout.write(`\r  ${color(label)} ${style.dim(text)}`);
    process.stdout.write('\n');
  };
  return {
    stop: (label = '✓ 完成') => end(label, style.green),
    fail: (label = '✗ 失败') => end(label, style.red)
  };
}
