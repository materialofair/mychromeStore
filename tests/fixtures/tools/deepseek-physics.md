```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="space-tool" content="1">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>重力弹跳小球 · 物理模拟</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0f1422;font-family:system-ui,sans-serif;padding:12px}
  .app{width:100%;max-width:640px;background:#1a2332;border-radius:24px;padding:18px;box-shadow:0 12px 30px rgba(0,0,0,.6)}
  h2{margin:0 0 12px;color:#e8edf5;font-weight:500;font-size:18px;display:flex;justify-content:space-between;align-items:center}
  h2 span{font-size:13px;color:#8798b0;font-weight:400}
  canvas{display:block;width:100%;height:auto;background:#0b0f1a;border-radius:16px;border:1px solid #2d3c55;touch-action:none}
  .panel{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px}
  .field{display:flex;flex-direction:column;gap:4px}
  .field label{font-size:12px;color:#98a9c3;letter-spacing:.3px}
  input[type=number]{background:#0e1622;border:1px solid #2f405c;color:#dbe6f5;padding:8px 10px;border-radius:12px;font-size:15px;width:100%}
  input[type=number]:focus{outline:2px solid #4b8cff;border-color:transparent}
  .btns{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
  button{flex:1 1 auto;padding:10px 6px;border-radius:14px;border:1px solid #354a68;background:#212f44;color:#e2ebf7;font-size:15px;font-weight:500;cursor:pointer;transition:.15s;min-width:70px}
  button:hover{background:#2d405d}
  button:active{transform:scale(.97)}
  button.primary{background:#3b72e0;border-color:#3b72e0}
  button.primary:hover{background:#4d82f0}
  .stats{display:flex;gap:18px;margin-top:14px;padding:10px 6px 4px;border-top:1px solid #253147;color:#a7b8d4;font-size:14px;flex-wrap:wrap}
  .stats div{display:flex;gap:6px;align-items:baseline}
  .stats output{color:#fff;font-weight:600;font-size:16px;min-width:48px;font-variant-numeric:tabular-nums}
  .err{color:#ff8a8a;font-size:13px;margin-top:8px;min-height:18px}
</style>
</head>
<body>
<div class="app">
  <h2>⚡ 重力弹跳 <span>固定步长 · 地面反弹</span></h2>
  <canvas id="world" width="640" height="360"></canvas>
  <div class="panel">
    <div class="field">
      <label>重力 (m/s²)</label>
      <input id="gravity" type="number" step="0.1" value="9.8" min="0">
    </div>
    <div class="field">
      <label>弹性系数 (0–1)</label>
      <input id="restitution" type="number" step="0.05" value="0.82" min="0" max="1">
    </div>
  </div>
  <div class="btns">
    <button id="run" class="primary">▶ 运行</button>
    <button id="stop">⏸ 暂停</button>
    <button id="step">⏭ 单步</button>
    <button id="reset">↺ 重置</button>
  </div>
  <div class="stats">
    <div>步数 <output id="steps">0</output></div>
    <div>模拟时间 <output id="time">0.00</output> s</div>
    <div>速度 <output id="vel">0.00</output> m/s</div>
  </div>
  <div id="err" class="err"></div>
</div>

<script>
(async function(){
  // -------- SDK & 错误展示 --------
  const errEl = document.getElementById('err');
  const showErr = (msg) => { errEl.textContent = msg; };
  const clearErr = () => { errEl.textContent = ''; };

  const canvas = document.getElementById('world');
  const ctx = canvas.getContext('2d');
  const gravityInput = document.getElementById('gravity');
  const restitutionInput = document.getElementById('restitution');
  const stepsOut = document.getElementById('steps');
  const timeOut = document.getElementById('time');
  const velOut = document.getElementById('vel');

  // -------- 物理常量 --------
  const GROUND = canvas.height - 28;   // 地面 y 坐标
  const RADIUS = 18;
  const DT = 1 / 120;                  // 固定时间步长
  const SUBSTEPS = 4;                  // 每帧子步数（保证稳定）

  // -------- 状态 --------
  let state = {
    gravity: 9.8,
    restitution: 0.82,
    position: { x: canvas.width / 2, y: 90 },
    velocity: { x: 0, y: 0 },
    time: 0,
    steps: 0,
    running: false,
    rng: 0.42
  };

  // 恢复默认值
  const defaultState = JSON.parse(JSON.stringify(state));

  // -------- 加载状态 --------
  let loadError = '';
  try {
    if (window.spaceTool && typeof spaceTool.loadState === 'function') {
      const restored = await spaceTool.loadState();
      if (restored && typeof restored === 'object') {
        // 合并有限字段
        if (typeof restored.gravity === 'number') state.gravity = restored.gravity;
        if (typeof restored.restitution === 'number') state.restitution = restored.restitution;
        if (restored.position && typeof restored.position.x === 'number' && typeof restored.position.y === 'number')
          state.position = { x: restored.position.x, y: restored.position.y };
        if (restored.velocity && typeof restored.velocity.x === 'number' && typeof restored.velocity.y === 'number')
          state.velocity = { x: restored.velocity.x, y: restored.velocity.y };
        if (typeof restored.time === 'number') state.time = restored.time;
        if (typeof restored.steps === 'number') state.steps = restored.steps;
        if (typeof restored.restitution === 'number') state.restitution = restored.restitution;
        // running 强制为 false（默认暂停）
        state.running = false;
      }
    }
  } catch (e) {
    loadError = '状态恢复失败: ' + (e && e.message ? e.message : e);
    showErr(loadError);
    // 回退默认
    state = JSON.parse(JSON.stringify(defaultState));
    state.running = false;
  }

  // -------- 同步 UI 输入 --------
  gravityInput.value = state.gravity;
  restitutionInput.value = state.restitution;

  // -------- 保存状态（带错误展示）--------
  async function persist() {
    if (!window.spaceTool || typeof spaceTool.saveState !== 'function') return;
    try {
      const toSave = {
        gravity: state.gravity,
        restitution: state.restitution,
        position: { x: state.position.x, y: state.position.y },
        velocity: { x: state.velocity.x, y: state.velocity.y },
        time: state.time,
        steps: state.steps,
        // 不保存 running 为了“重开默认暂停”
      };
      await spaceTool.saveState(toSave);
      clearErr();
    } catch (e) {
      showErr('保存失败: ' + (e && e.message ? e.message : e));
    }
  }

  // -------- 结果接口 --------
  function reportResult() {
    if (!window.spaceTool || typeof spaceTool.setResult !== 'function') return;
    const summary = `第 ${state.steps} 步 | t=${state.time.toFixed(3)}s | 高度 ${(GROUND - RADIUS - state.position.y).toFixed(1)} px | vy=${state.velocity.y.toFixed(2)} m/s`;
    spaceTool.setResult({
      summary,
      data: {
        steps: state.steps,
        time: state.time,
        position: { ...state.position },
        velocity: { ...state.velocity },
        gravity: state.gravity,
        restitution: state.restitution
      }
    });
  }

  // -------- 绘制 --------
  function draw() {
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    // 背景
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#0b0f1a');
    grad.addColorStop(1, '#141e30');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // 地面
    ctx.fillStyle = '#1e2b40';
    ctx.fillRect(0, GROUND, W, H - GROUND);
    ctx.strokeStyle = '#3b5578';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, GROUND);
    ctx.lineTo(W, GROUND);
    ctx.stroke();

    // 高度参考虚线
    ctx.setLineDash([4, 8]);
    ctx.strokeStyle = '#2a3c55';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 80);
    ctx.lineTo(W, 80);
    ctx.stroke();
    ctx.setLineDash([]);

    // 小球
    const bx = state.position.x;
    const by = state.position.y;
    const ballGrad = ctx.createRadialGradient(bx - 5, by - 5, 3, bx, by, RADIUS);
    ballGrad.addColorStop(0, '#a8d0ff');
    ballGrad.addColorStop(1, '#2f76e0');
    ctx.beginPath();
    ctx.arc(bx, by, RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = ballGrad;
    ctx.fill();
    ctx.strokeStyle = '#ffffff40';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 速度矢量
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + state.velocity.x * 8, by + state.velocity.y * 8);
    ctx.strokeStyle = '#7affb0';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  // -------- 固定步长物理推进（一步 = 一个固定时间步长）--------
  function physicsStep() {
    const g = Math.max(0, state.gravity);
    // 更新速度
    state.velocity.y += g * DT;
    // 更新位置
    state.position.x += state.velocity.x * DT;
    state.position.y += state.velocity.y * DT;

    // 左右墙壁反弹
    if (state.position.x - RADIUS < 0) {
      state.position.x = RADIUS;
      state.velocity.x = -state.velocity.x * state.restitution;
    }
    if (state.position.x + RADIUS > canvas.width) {
      state.position.x = canvas.width - RADIUS;
      state.velocity.x = -state.velocity.x * state.restitution;
    }

    // 地面反弹（带静止阈值防止抖动）
    const floorY = GROUND - RADIUS;
    if (state.position.y > floorY) {
      state.position.y = floorY;
      if (Math.abs(state.velocity.y) < 0.25) {
        state.velocity.y = 0;
      } else {
        state.velocity.y = -state.velocity.y * state.restitution;
      }
      // 水平摩擦（轻微）
      state.velocity.x *= 0.995;
    }

    // 天花板（可选，防止飞出）
    if (state.position.y - RADIUS < 0) {
      state.position.y = RADIUS;
      state.velocity.y = -state.velocity.y * state.restitution;
    }

    state.time += DT;
    state.steps += 1;

    // 数值保护
    if (!isFinite(state.position.x) || !isFinite(state.position.y) ||
        !isFinite(state.velocity.x) || !isFinite(state.velocity.y)) {
      resetSim();
      showErr('数值发散，已重置');
    }
  }

  // -------- 更新 UI 输出 --------
  function updateUI() {
    stepsOut.textContent = state.steps;
    timeOut.textContent = state.time.toFixed(2);
    velOut.textContent = state.velocity.y.toFixed(2);
  }

  // -------- 完整渲染+UI+结果 --------
  function renderAll() {
    draw();
    updateUI();
    reportResult();
  }

  // -------- 运行循环（requestAnimationFrame）--------
  let rafId = null;
  let lastTimestamp = 0;

  function loop(ts) {
    if (!state.running) { rafId = null; return; }

    if (!lastTimestamp) lastTimestamp = ts;
    let elapsed = (ts - lastTimestamp) / 1000;
    lastTimestamp = ts;

    // 防止页面隐藏时巨大跳变
    if (elapsed > 0.1) elapsed = 0.1;

    // 固定时间步长积分：将 elapsed 拆分为多个 DT，每帧最多 SUBSTEPS 个物理步
    let stepCount = 0;
    while (elapsed >= DT && stepCount < SUBSTEPS) {
      physicsStep();
      elapsed -= DT;
      stepCount++;
    }
    // 剩余时间丢弃（或可累加，这里简单丢弃保证固定步长）

    renderAll();

    if (state.running) {
      rafId = requestAnimationFrame(loop);
    } else {
      rafId = null;
    }
  }

  // -------- 运行 / 暂停 / 单步 / 重置 --------
  function start() {
    if (state.running) return;
    state.running = true;
    lastTimestamp = 0;
    if (rafId === null) {
      rafId = requestAnimationFrame(loop);
    }
  }

  function pause() {
    state.running = false;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    persist();
    // 暂停时也更新一次结果
    renderAll();
  }

  function singleStep() {
    // 暂停状态下单步
    state.running = false;
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    physicsStep();
    renderAll();
    persist();
  }

  function resetSim() {
    state.running = false;
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    state.gravity = 9.8;
    state.restitution = 0.82;
    state.position = { x: canvas.width / 2, y: 90 };
    state.velocity = { x: 0, y: 0 };
    state.time = 0;
    state.steps = 0;
    gravityInput.value = state.gravity;
    restitutionInput.value = state.restitution;
    renderAll();
    persist();
  }

  // -------- 用户输入事件 --------
  gravityInput.addEventListener('input', () => {
    const v = parseFloat(gravityInput.value);
    if (isFinite(v) && v >= 0) {
      state.gravity = v;
      persist();
      reportResult();
    }
  });

  restitutionInput.addEventListener('input', () => {
    const v = parseFloat(restitutionInput.value);
    if (isFinite(v) && v >= 0 && v <= 1) {
      state.restitution = v;
      persist();
      reportResult();
    }
  });

  // -------- 按钮绑定 --------
  document.getElementById('run').addEventListener('click', start);
  document.getElementById('stop').addEventListener('click', pause);
  document.getElementById('step').addEventListener('click', singleStep);
  document.getElementById('reset').addEventListener('click', resetSim);

  // -------- SDK 暂停回调（必须用 onPause）--------
  if (window.spaceTool && typeof spaceTool.onPause === 'function') {
    spaceTool.onPause(() => {
      state.running = false;
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
      persist();
      renderAll();
    });
  }

  // -------- 初始化渲染（默认暂停）--------
  state.running = false;
  renderAll();
  // 如果恢复后有数据，先保存一次（确保恢复的也是最新）
  await persist();

  // 窗口大小自适应（仅重绘，canvas 尺寸保持固定逻辑分辨率）
  window.addEventListener('resize', () => {
    // 保持 canvas 内部尺寸，仅重绘
    renderAll();
  });

})();
</script>
</body>
</html>
```