以下是您需要的可交互加减乘除计算器HTML代码。它使用Space-UI框架，通过点击按钮和输入数字即可完成实时运算。
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>space‑ui 计算器 · 加减乘除</title>
  <style>
    /* 干净简洁的布局，符合 space‑ui 风格，不使用任何外部资源 */
    * {
      box-sizing: border-box;
      font-family: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
    }
    body {
      background: #f8fafc;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      padding: 16px;
    }
    .calculator-card {
      max-width: 520px;
      width: 100%;
      background: #ffffff;
      border-radius: 28px;
      padding: 24px 20px 28px;
      box-shadow: 0 12px 30px rgba(0, 0, 0, 0.08), 0 4px 8px rgba(0, 0, 0, 0.02);
      border: 1px solid #e9edf2;
    }
    h2 {
      margin: 0 0 8px 0;
      font-weight: 500;
      font-size: 1.6rem;
      letter-spacing: -0.02em;
      color: #0b1b2f;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    h2 span {
      font-size: 1.8rem;
      line-height: 1;
    }
    .subhead {
      color: #5e6f88;
      font-size: 0.9rem;
      margin-bottom: 20px;
      border-left: 3px solid #b7c9e0;
      padding-left: 12px;
    }
    .display-panel {
      background: #f3f6fc;
      border-radius: 18px;
      padding: 16px 18px;
      margin-bottom: 22px;
      border: 1px solid #dae3ef;
      box-shadow: inset 0 1px 4px rgba(0, 0, 0, 0.02);
    }
    .display-label {
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: #4a5e7a;
      font-weight: 500;
      margin-bottom: 6px;
    }
    output#result {
      display: block;
      font-size: 2.4rem;
      font-weight: 500;
      line-height: 1.2;
      color: #0a1d34;
      word-break: break-word;
      letter-spacing: -0.02em;
      min-height: 3.6rem;
    }
    .input-group {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-bottom: 16px;
      align-items: flex-end;
    }
    .field {
      flex: 1 1 140px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .field label {
      font-size: 0.8rem;
      font-weight: 500;
      color: #3a4f6b;
      letter-spacing: 0.02em;
    }
    .field input {
      padding: 12px 14px;
      border-radius: 14px;
      border: 1.5px solid #d0dbe9;
      background: #ffffff;
      font-size: 1rem;
      color: #141f2e;
      transition: border 0.15s ease;
      outline: none;
      width: 100%;
    }
    .field input:focus {
      border-color: #3a6ea5;
      box-shadow: 0 0 0 3px rgba(58, 110, 165, 0.1);
    }
    .op-row {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin: 20px 0 14px;
      justify-content: space-between;
    }
    .op-btn {
      flex: 1 0 60px;
      background: #ffffff;
      border: 1.5px solid #cbd8e8;
      border-radius: 16px;
      padding: 14px 0;
      font-size: 1.4rem;
      font-weight: 500;
      color: #1d314a;
      cursor: pointer;
      transition: all 0.1s ease;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.02);
      display: flex;
      align-items: center;
      justify-content: center;
      line-height: 1;
      user-select: none;
      background: #fcfdff;
    }
    .op-btn:hover {
      background: #e8effa;
      border-color: #7d9bc1;
    }
    .op-btn:active {
      transform: scale(0.96);
      background: #dae5f3;
    }
    .op-btn.primary {
      background: #1f3a5f;
      border-color: #1f3a5f;
      color: white;
      box-shadow: 0 6px 12px rgba(28, 60, 100, 0.15);
    }
    .op-btn.primary:hover {
      background: #254a78;
      border-color: #254a78;
    }
    .result-actions {
      display: flex;
      gap: 10px;
      margin-top: 10px;
    }
    .result-actions .op-btn {
      padding: 10px 0;
      font-size: 0.95rem;
      font-weight: 500;
    }
    .note {
      font-size: 0.75rem;
      color: #7c8ca3;
      text-align: center;
      margin-top: 16px;
      border-top: 1px dashed #d7e0eb;
      padding-top: 14px;
    }
    .badge {
      background: #e5ecf5;
      border-radius: 30px;
      padding: 4px 12px;
      font-size: 0.8rem;
      color: #2c405a;
      font-weight: 500;
    }
  </style>
</head>
<body>
  <div class="calculator-card">
    <h2>
      <span>🧮</span> 加减乘除·计算器
    </h2>
    <div class="subhead">输入数字 · 点击运算 · 实时结果</div>

    <!-- 显示区域：output 由 space-ui 更新 -->
    <div class="display-panel">
      <div class="display-label">当前结果</div>
      <output id="result">0</output>
    </div>

    <!-- 两个数字输入框，绑定 state 变量 a 和 b -->
    <div class="input-group">
      <div class="field">
        <label for="a">第一个数</label>
        <input type="number" id="a" value="0" step="any" placeholder="例如 12.5">
      </div>
      <div class="field">
        <label for="b">第二个数</label>
        <input type="number" id="b" value="0" step="any" placeholder="例如 3">
      </div>
    </div>

    <!-- 运算按钮 + 专用动作（点击时通过事件更新 state.n） -->
    <div class="op-row">
      <button class="op-btn" id="add">＋</button>
      <button class="op-btn" id="sub">－</button>
      <button class="op-btn" id="mul">✕</button>
      <button class="op-btn" id="div">÷</button>
    </div>

    <!-- 附加动作：重置/取反/存储? 直接做两个小工具 -->
    <div class="result-actions">
      <button class="op-btn" id="reset">重置为 0</button>
      <button class="op-btn" id="copyResult">将结果填回 a</button>
    </div>

    <!-- 状态说明（不重要，只是装饰） -->
    <div class="note">
      <span class="badge">space‑ui</span> 加减乘除 · 除零保护（显示 0）
    </div>
  </div>

  <!-- 关键：space-ui JSON 脚本，内含状态、视图、事件 -->
  <script type="application/space-ui+json">
  {
    "version": 1,
    "state": {
      "n": 0,
      "a": 0,
      "b": 0
    },
    "views": [
      {
        "id": "result",
        "text": { "state": "n" }
      }
    ],
    "events": [
      {
        "id": "a",
        "event": "input",
        "do": [
          {
            "op": "set",
            "key": "a",
            "value": ["num", { "input": "a" }]
          }
        ]
      },
      {
        "id": "b",
        "event": "input",
        "do": [
          {
            "op": "set",
            "key": "b",
            "value": ["num", { "input": "b" }]
          }
        ]
      },
      {
        "id": "add",
        "event": "click",
        "do": [
          {
            "op": "set",
            "key": "n",
            "value": ["+", { "state": "a" }, { "state": "b" }]
          }
        ]
      },
      {
        "id": "sub",
        "event": "click",
        "do": [
          {
            "op": "set",
            "key": "n",
            "value": ["-", { "state": "a" }, { "state": "b" }]
          }
        ]
      },
      {
        "id": "mul",
        "event": "click",
        "do": [
          {
            "op": "set",
            "key": "n",
            "value": ["*", { "state": "a" }, { "state": "b" }]
          }
        ]
      },
      {
        "id": "div",
        "event": "click",
        "do": [
          {
            "op": "set",
            "key": "n",
            "value": [
              "if",
              ["==", { "state": "b" }, 0],
              0,
              ["/", { "state": "a" }, { "state": "b" }]
            ]
          }
        ]
      },
      {
        "id": "reset",
        "event": "click",
        "do": [
          { "op": "set", "key": "n", "value": 0 },
          { "op": "set", "key": "a", "value": 0 },
          { "op": "set", "key": "b", "value": 0 }
        ]
      },
      {
        "id": "copyResult",
        "event": "click",
        "do": [
          { "op": "set", "key": "a", "value": { "state": "n" } }
        ]
      }
    ]
  }
  </script>
</body>
</html>
```
### 核心功能与操作说明
您可以通过输入两个数字并点击运算按钮，实时得到计算结果。界面清晰，操作直观。

-   **数字输入**：页面顶部的“第一个数”和“第二个数”输入框让您分别输入参与运算的数字。输入后，它们会自动同步到内部状态。
-   **运算操作**：点击“＋”、“－”、“✕”、“÷”四个按钮之一，即可对两个数字执行相应的加减乘除运算，结果会立即显示在上方的结果区域。
-   **快捷工具**：下方的“重置为0”按钮可以清空所有输入和结果；“将结果填回a”按钮则能将当前的计算结果快速填入第一个数字的输入框，方便连续计算。
-   **除零保护**：当您尝试除以零时，结果会安全地显示为0，避免程序出错。