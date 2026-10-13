下面是一个用 `space-ui` 代码块实现的本地计算器：两个数字输入（初始 `8` 和 `2`）以及加、减、乘、除四个按钮，结果显示在 `id="result"` 的输出区域中。所有样式均以内联 `style` 写在各元素上，没有 `<style>` 标签，也没有使用 JavaScript 或事件属性；交互逻辑放在唯一的 `<script type="application/space-ui+json">` 中。

```space-ui
<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;padding:24px 18px;background:#f6f7fb;">
  <div style="background:#ffffff;border:1px solid #e3e6ef;border-radius:16px;padding:22px 20px;box-shadow:0 6px 20px rgba(20,30,60,.08);">
    <div style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#8b93a7;margin-bottom:14px;">Calculator</div>

    <div style="display:flex;gap:12px;margin-bottom:14px;">
      <div style="flex:1;">
        <label style="display:block;font-size:12px;color:#6b7280;margin-bottom:6px;">A</label>
        <input id="a" type="number" value="8" style="width:100%;box-sizing:border-box;font-size:20px;padding:10px 12px;border:1px solid #d5d9e6;border-radius:10px;background:#fbfcfe;color:#1f2937;outline:none;">
      </div>
      <div style="flex:1;">
        <label style="display:block;font-size:12px;color:#6b7280;margin-bottom:6px;">B</label>
        <input id="b" type="number" value="2" style="width:100%;box-sizing:border-box;font-size:20px;padding:10px 12px;border:1px solid #d5d9e6;border-radius:10px;background:#fbfcfe;color:#1f2937;outline:none;">
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;margin-bottom:16px;">
      <button id="add" style="font-size:18px;padding:12px 0;border:1px solid #cfd6e6;border-radius:10px;background:#eef2ff;color:#3b4bd8;cursor:pointer;font-weight:600;">+</button>
      <button id="sub" style="font-size:18px;padding:12px 0;border:1px solid #cfd6e6;border-radius:10px;background:#eef2ff;color:#3b4bd8;cursor:pointer;font-weight:600;">−</button>
      <button id="mul" style="font-size:18px;padding:12px 0;border:1px solid #cfd6e6;border-radius:10px;background:#eef2ff;color:#3b4bd8;cursor:pointer;font-weight:600;">×</button>
      <button id="div" style="font-size:18px;padding:12px 0;border:1px solid #cfd6e6;border-radius:10px;background:#eef2ff;color:#3b4bd8;cursor:pointer;font-weight:600;">÷</button>
    </div>

    <div style="margin-top:6px;padding:14px 16px;border-radius:12px;background:#0f172a;">
      <div style="font-size:12px;color:#8ea0c0;margin-bottom:4px;">Result</div>
      <output id="result" style="display:block;font-size:30px;font-weight:700;color:#e6edf7;font-variant-numeric:tabular-nums;">0</output>
    </div>
  </div>
</div>

<script type="application/space-ui+json">
{
  "version": 1,
  "state": { "n": 0 },
  "views": [
    { "id": "result", "text": { "state": "n" } }
  ],
  "events": [
    {
      "id": "add",
      "event": "click",
      "do": [ { "op": "set", "key": "n", "value": ["+", ["num", { "input": "a" }], ["num", { "input": "b" }]] } ]
    },
    {
      "id": "sub",
      "event": "click",
      "do": [ { "op": "set", "key": "n", "value": ["-", ["num", { "input": "a" }], ["num", { "input": "b" }]] } ]
    },
    {
      "id": "mul",
      "event": "click",
      "do": [ { "op": "set", "key": "n", "value": ["*", ["num", { "input": "a" }], ["num", { "input": "b" }]] } ]
    },
    {
      "id": "div",
      "event": "click",
      "do": [
        {
          "op": "if",
          "test": ["==", ["num", { "input": "b" }], 0],
          "then": [ { "op": "set", "key": "n", "value": "除数不能为 0" } ],
          "else": [ { "op": "set", "key": "n", "value": ["/", ["num", { "input": "a" }], ["num", { "input": "b" }]] } ]
        }
      ]
    }
  ]
}
</script>
```

### 使用说明

- **输入框**：`a` 和 `b` 分别初始为 `8` 与 `2`，可直接在页面上修改。
- **运算按钮**：点击 + 、− 、× 、÷ 任一按钮，会读取当前输入并计算。
- **结果显示**：计算结果写入 `id="result"` 的 `<output>` 区域，初值为 `0`。
- **除零保护**：当 `b` 为 `0` 时，点击 ÷ 会显示"除数不能为 0"而不做除法。

整个文件不依赖任何外部资源，直接在本地渲染即可运行。

CHOICE_REQUEST:{"question":"接下来需要我做什么？","choices":["在计算器中加入取余、幂、开方等更多运算按钮","把结果显示区改成可以弹出历史算式记录的列表","保持当前版本不变，只解释 space-ui 表达式的写法细节"]}