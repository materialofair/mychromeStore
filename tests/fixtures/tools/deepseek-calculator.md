这是您需要的中文加减乘除计算器HTML代码。它包含两个数字输入框和四个运算按钮，并已集成状态保存与恢复功能。
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="space-tool" content="1">
  <title>中文加减乘除 · 轻量计算器</title>
  <style>
    * {
      box-sizing: border-box;
    }
    body {
      margin: 0;
      min-height: 100vh;
      background: #f5f7fb;
      font-family: system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans', sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
    }
    .calculator {
      max-width: 560px;
      width: 100%;
      background: #ffffff;
      border-radius: 32px;
      box-shadow: 0 16px 30px rgba(0, 0, 0, 0.05), 0 6px 12px rgba(0, 0, 0, 0.03);
      padding: 2rem 1.8rem 1.8rem;
      transition: all 0.2s;
    }
    h2 {
      margin: 0 0 0.3rem 0;
      font-weight: 500;
      font-size: 1.8rem;
      letter-spacing: -0.5px;
      color: #1e293b;
    }
    .sub {
      font-size: 0.85rem;
      color: #64748b;
      margin-bottom: 2rem;
      border-left: 3px solid #94a3b8;
      padding-left: 12px;
    }
    .inputs {
      display: flex;
      gap: 1rem;
      flex-wrap: wrap;
      margin-bottom: 1.8rem;
    }
    .input-group {
      flex: 1 1 140px;
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
    }
    .input-group label {
      font-size: 0.8rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #475569;
    }
    .input-group input {
      width: 100%;
      padding: 0.9rem 1rem;
      font-size: 1.25rem;
      font-weight: 500;
      background: #f8fafc;
      border: 1.5px solid #e2e8f0;
      border-radius: 18px;
      color: #0f172a;
      outline: none;
      transition: 0.15s;
    }
    .input-group input:focus {
      border-color: #3b82f6;
      background: #ffffff;
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
    }
    .buttons {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 0.75rem;
      margin-bottom: 1.8rem;
    }
    .buttons button {
      background: #ffffff;
      border: 1.5px solid #e2e8f0;
      border-radius: 30px;
      padding: 0.9rem 0.2rem;
      font-size: 1.15rem;
      font-weight: 600;
      color: #1e293b;
      cursor: pointer;
      transition: background 0.1s, border-color 0.1s, transform 0.05s;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.02);
      letter-spacing: 0.5px;
    }
    .buttons button:hover {
      background: #f1f5f9;
      border-color: #cbd5e1;
    }
    .buttons button:active {
      transform: scale(0.96);
      background: #e2e8f0;
    }
    .result-area {
      background: #f1f5f9;
      border-radius: 22px;
      padding: 1.2rem 1.5rem;
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 0.5rem;
      border: 1px solid #e2e8f0;
      margin-bottom: 1rem;
    }
    .result-label {
      font-size: 0.95rem;
      font-weight: 500;
      color: #475569;
      letter-spacing: 0.3px;
    }
    .result-value {
      font-size: 2rem;
      font-weight: 600;
      color: #0f172a;
      line-height: 1.2;
      word-break: break-word;
      font-variant-numeric: tabular-nums;
    }
    .error-message {
      font-size: 0.85rem;
      color: #b91c1c;
      background: #fee2e2;
      border-radius: 16px;
      padding: 0.7rem 1.2rem;
      margin-top: 0.5rem;
      text-align: center;
      border: 1px solid #fecaca;
      display: none;
    }
    .error-message.show {
      display: block;
    }
    .footer-note {
      margin-top: 1.3rem;
      font-size: 0.75rem;
      color: #94a3b8;
      text-align: center;
      border-top: 1px solid #e2e8f0;
      padding-top: 1.2rem;
    }
    @media (max-width: 480px) {
      .calculator {
        padding: 1.5rem 1rem;
      }
      .buttons button {
        font-size: 1rem;
        padding: 0.7rem 0;
      }
      .result-value {
        font-size: 1.7rem;
      }
    }
  </style>
</head>
<body>
  <div class="calculator">
    <h2>🧮 加减乘除</h2>
    <div class="sub">中文计算器 · 状态自动恢复</div>

    <div class="inputs">
      <div class="input-group">
        <label for="a">数字 A</label>
        <input type="number" id="a" value="8" step="any" inputmode="decimal">
      </div>
      <div class="input-group">
        <label for="b">数字 B</label>
        <input type="number" id="b" value="2" step="any" inputmode="decimal">
      </div>
    </div>

    <div class="buttons">
      <button id="add" title="加法">＋</button>
      <button id="subtract" title="减法">−</button>
      <button id="multiply" title="乘法">×</button>
      <button id="divide" title="除法">÷</button>
    </div>

    <div class="result-area">
      <span class="result-label">结果</span>
      <span class="result-value" id="answer">8</span>
    </div>

    <div id="errorMessage" class="error-message"></div>
    <div class="footer-note">保存输入与结果 · 重开恢复</div>
  </div>

  <script>
    (function() {
      'use strict';

      // ---------- DOM 引用 ----------
      const aInput = document.getElementById('a');
      const bInput = document.getElementById('b');
      const answerEl = document.getElementById('answer');
      const errorEl = document.getElementById('errorMessage');
      const addBtn = document.getElementById('add');
      const subBtn = document.getElementById('subtract');
      const mulBtn = document.getElementById('multiply');
      const divBtn = document.getElementById('divide');

      // ---------- 应用状态 (JSON 可序列化) ----------
      let state = {
        a: 8,
        b: 2,
        result: 8,
        lastOperation: 'add'   // 记录最后一次操作，便于恢复后显示一致
      };

      // 是否已从 spaceTool 恢复
      let restored = false;

      // ---------- 辅助函数 ----------
      function showError(msg) {
        if (msg) {
          errorEl.textContent = msg;
          errorEl.classList.add('show');
        } else {
          errorEl.textContent = '';
          errorEl.classList.remove('show');
        }
      }

      // 根据当前 a 和 b 计算并更新结果 (不触发保存)
      function computeAndUpdateUI(operation) {
        const a = parseFloat(aInput.value);
        const b = parseFloat(bInput.value);

        // 检查非法数字
        if (isNaN(a) || isNaN(b)) {
          answerEl.textContent = '—';
          showError('请输入有效的数字');
          state.result = null;
          state.a = isNaN(a) ? 0 : a;   // 但保留输入框的值，不覆盖
          state.b = isNaN(b) ? 0 : b;
          return;
        }

        let result;
        let errorMsg = '';

        try {
          switch (operation) {
            case 'add':
              result = a + b;
              break;
            case 'subtract':
              result = a - b;
              break;
            case 'multiply':
              result = a * b;
              break;
            case 'divide':
              if (b === 0) {
                errorMsg = '除数不能为零';
                result = null;
              } else {
                result = a / b;
              }
              break;
            default:
              result = a + b; // fallback
          }
        } catch (e) {
          errorMsg = '计算错误';
          result = null;
        }

        if (errorMsg) {
          answerEl.textContent = '错误';
          showError(errorMsg);
          state.result = null;
        } else {
          // 格式化结果：去除浮点误差，保留合理小数位
          let displayResult;
          if (typeof result === 'number' && !isNaN(result) && isFinite(result)) {
            // 避免 0.30000000000000004 这类问题：四舍五入到12位小数后转为数字
            const rounded = Math.round(result * 1e12) / 1e12;
            // 对于非常接近整数的值，转为整数显示
            if (Math.abs(rounded - Math.round(rounded)) < 1e-12) {
              displayResult = Math.round(rounded);
            } else {
              displayResult = rounded;
            }
          } else {
            displayResult = result;
          }
          answerEl.textContent = displayResult;
          showError('');
          state.result = displayResult;
        }

        // 更新输入对应的 state 值（保留用户输入原始值，但存储数字）
        state.a = isNaN(a) ? 0 : a;
        state.b = isNaN(b) ? 0 : b;
      }

      // 保存状态到 spaceTool (异步)
      async function persistState() {
        try {
          // 确保只保存有限 JSON 数据，不存 DOM 或函数
          const stateToSave = {
            a: state.a,
            b: state.b,
            result: state.result,
            lastOperation: state.lastOperation
          };
          await spaceTool.saveState(stateToSave);
        } catch (err) {
          // 保存错误需要在界面明确展示
          showError('状态保存失败: ' + (err.message || '未知错误'));
          console.warn('saveState error:', err);
        }
      }

      // 通知结果变化 (每次都调用 setResult)
      function notifyResult() {
        try {
          const summary = `结果: ${state.result !== null ? state.result : '错误'} (A=${state.a}, B=${state.b})`;
          spaceTool.setResult({
            summary: summary,
            data: {
              a: state.a,
              b: state.b,
              result: state.result,
              operation: state.lastOperation
            }
          });
        } catch (e) {
          // 静默失败不影响主要功能（不展示错误，因为可能未定义）
          console.warn('setResult 不可用或出错', e);
        }
      }

      // 执行计算并同步 UI + 保存 + 通知
      async function performOperation(operation) {
        // 更新 lastOperation
        state.lastOperation = operation;

        // 根据当前输入框的值计算
        computeAndUpdateUI(operation);

        // 保存状态 (包含最新输入和结果)
        await persistState();

        // 通知结果变化
        notifyResult();
      }

      // 从输入框同步 state.a / state.b (仅在输入变化时调用，不自动计算)
      function syncInputState() {
        const a = parseFloat(aInput.value);
        const b = parseFloat(bInput.value);
        state.a = isNaN(a) ? 0 : a;
        state.b = isNaN(b) ? 0 : b;
        // 不清除结果，但保存新输入
        persistState().catch(e => showError('保存失败: ' + e.message));
        // 同时更新 setResult ？ 因为结果暂时未变，但输入变了，可以更新描述
        notifyResult();
      }

      // ---------- 恢复状态和初始化 ----------
      async function init() {
        try {
          // 1. 异步载入保存的状态
          const restoredState = await spaceTool.loadState();
          restored = true;

          if (restoredState && typeof restoredState === 'object') {
            // 安全地合并，避免 __proto__ 污染
            if (typeof restoredState.a === 'number' && isFinite(restoredState.a)) state.a = restoredState.a;
            if (typeof restoredState.b === 'number' && isFinite(restoredState.b)) state.b = restoredState.b;
            if (restoredState.result !== undefined && (typeof restoredState.result === 'number' || restoredState.result === null)) {
              state.result = restoredState.result;
            }
            if (typeof restoredState.lastOperation === 'string') state.lastOperation = restoredState.lastOperation;
          } else {
            // 默认值
            state.a = 8;
            state.b = 2;
            state.result = 8;
            state.lastOperation = 'add';
          }
        } catch (err) {
          console.warn('loadState 失败，使用默认值', err);
          // 使用默认值，并且显示错误（但不要覆盖计算区域）
          showError('读取保存状态失败，已重置为默认值');
          state.a = 8;
          state.b = 2;
          state.result = 8;
          state.lastOperation = 'add';
          // 稍后自动清除错误（5秒后隐藏，但保留错误信息不影响）
          setTimeout(() => {
            // 但如果一直没其他错误，可以清除错误
            if (errorEl.textContent.includes('读取保存状态失败')) {
              showError('');
            }
          }, 5000);
        }

        // 2. 根据 state 设置输入框的值
        aInput.value = state.a;
        bInput.value = state.b;

        // 3. 根据 state 计算并显示结果 (但不要再次保存/通知，避免循环；使用计算逻辑)
        //    这里用 computeAndUpdateUI 但不传异步保存
        //    如果 state.result 已经是数字，直接用；但为了保证一致性，根据 lastOperation 重新计算？ 
        //    更稳健：直接使用保存的 result，但如果 lastOperation 存在且输入与结果逻辑可能不一致（比如用户手动改输入后没按按钮），
        //    恢复时最好根据保存的 result 和 lastOperation 重新计算一次结果以保证一致。但我们信任保存状态。
        //    为了显示正确，根据 lastOperation 重新计算一次（因为保存的输入和操作符与结果匹配）
        //    但注意可能用户手动改了输入还没按按钮就关闭，保存的状态里result是旧结果。这里按照保存的result展示更忠实于历史。
        //    所以直接用 state.result，如果为 null 显示“错误”
        if (state.result !== null && !isNaN(state.result) && isFinite(state.result)) {
          // 格式化一下
          let disp = state.result;
          if (Math.abs(disp - Math.round(disp)) < 1e-12) disp = Math.round(disp);
          answerEl.textContent = disp;
          showError(''); // 清除任何启动错误
        } else {
          answerEl.textContent = '—';
          // 如果是因为除零导致的 null，可以显示错误，但避免混乱，显示为错误样式
          if (state.lastOperation === 'divide' && parseFloat(bInput.value) === 0) {
            showError('除数不能为零');
            answerEl.textContent = '错误';
          } else if (state.result === null) {
            // 可能保存的是错误状态，显示“错误”
            answerEl.textContent = '错误';
          } else {
            answerEl.textContent = '—';
          }
        }

        // 如果恢复的状态中 lastOperation 是 divide 且 b=0，则应该显示错误
        if (state.lastOperation === 'divide' && parseFloat(bInput.value) === 0) {
          showError('除数不能为零');
          answerEl.textContent = '错误';
          state.result = null;
        }

        // 4. 首次加载时也调用一次 setResult 让外部知道当前结果
        notifyResult();

        // 5. 清除任何过时的错误消息（如果接下来没有错误）
        //    但如果是我们主动 showError 的错误，保留。若没有错误，清除。
        //    已经在上面 showError('') 处理了
      }

      // ---------- 绑定事件（真正 JavaScript 函数）----------
      // 输入变化时仅更新 state 并保存，不重算（除非用户按按钮）
      aInput.addEventListener('input', function() {
        syncInputState();
        // 可选：输入变化后如果用户期望实时计算？但需要按按钮才计算，保留按钮语义。
        // 但输入变化也可能导致之前结果显示不匹配，但为了符合计算器习惯，不自动计算。
      });
      bInput.addEventListener('input', function() {
        syncInputState();
      });

      // 按钮点击使用 async 包装
      addBtn.addEventListener('click', function() {
        performOperation('add').catch(e => showError('操作失败: ' + e.message));
      });
      subBtn.addEventListener('click', function() {
        performOperation('subtract').catch(e => showError('操作失败: ' + e.message));
      });
      mulBtn.addEventListener('click', function() {
        performOperation('multiply').catch(e => showError('操作失败: ' + e.message));
      });
      divBtn.addEventListener('click', function() {
        performOperation('divide').catch(e => showError('操作失败: ' + e.message));
      });

      // ---------- 注册暂停回调 (SDK 要求) ----------
      if (window.spaceTool && typeof spaceTool.onPause === 'function') {
        spaceTool.onPause(function() {
          // 这个工具没有动画/模拟，但是为了符合 SDK 规范，我们保存当前状态
          // 因为没有 running 变量，我们只做状态保存
          // 注意：不要用字符串定时器，这里只是持久化
          persistState().catch(function(err) {
            showError('暂停时保存失败: ' + (err.message || '未知错误'));
          });
        });
      }

      // 页面可见性变化或者 beforeunload 不是必须，但可以额外保存 (但 SDK 已经提供)
      // 为了更安全，可以在页面隐藏时保存？但空间工具通常有暂停回调。不加也可以。

      // 启动异步初始化
      init().catch(function(err) {
        console.error('初始化错误', err);
        showError('初始化失败: ' + (err.message || '未知错误'));
        // 使用默认值
        aInput.value = 8;
        bInput.value = 2;
        state.a = 8;
        state.b = 2;
        state.result = 8;
        state.lastOperation = 'add';
        answerEl.textContent = '8';
      });

      // 额外：当用户点击按钮后，可能希望立即在界面上反馈保存失败（已处理）。
      // 并且每次计算后保存与setResult都在 performOperation 中调用。

      // 确保恢复后如果用户直接按按钮，基于当前输入框的值计算（由 performOperation 处理）。

      // 暴露给控制台调试（可选）但不需要，不暴露。
    })();
  </script>
</body>
</html>
```
### 状态管理与计算逻辑

这个计算器能记住您上次的输入和结果，方便您继续操作。它的核心是让每次点击按钮都同时完成计算、界面更新和状态保存。

- **输入与计算**：页面中有两个数字输入框（默认值为8和2），以及加、减、乘、除四个按钮。点击按钮后，它会根据当前输入的数字执行相应运算，并将结果显示在下方的区域。如果除数为零，会显示明确的错误提示。
- **状态保存与恢复**：每次您执行计算或修改输入时，工具都会自动把当前的两个数字和计算结果保存下来。当您重新打开页面时，它会自动读取上次保存的状态，恢复输入框和结果，做到无缝衔接。
- **结果通知**：每次结果发生变化时，工具会通过一个内置接口将当前结果摘要和详细数据发送出去，方便其他组件或功能引用计算结果。