```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="space-tool" content="1">
  <title>动态正弦波 · 原生Canvas</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      background: #0b0e14;
      color: #e3e9f2;
      font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
      min-height: 100vh;
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 16px;
    }
    .app {
      max-width: 820px;
      width: 100%;
      background: #151b24;
      border-radius: 28px;
      padding: 24px 20px 20px;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.6);
    }
    h2 {
      font-weight: 400;
      font-size: 1.25rem;
      letter-spacing: 0.5px;
      color: #9db2d0;
      margin-bottom: 12px;
      padding-left: 6px;
      border-left: 4px solid #3f8cff;
    }
    canvas {
      display: block;
      width: 100%;
      height: auto;
      background: #10161e;
      border-radius: 18px;
      border: 1px solid #2a3441;
      box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.6);
      aspect-ratio: 16 / 7;
      touch-action: none;
    }
    .controls {
      display: flex;
      flex-wrap: wrap;
      gap: 18px 24px;
      margin: 18px 0 12px;
      align-items: center;
    }
    .slider-group {
      display: flex;
      align-items: center;
      gap: 10px;
      flex: 1 1 200px;
      min-width: 160px;
    }
    .slider-group label {
      font-size: 0.9rem;
      font-weight: 500;
      color: #a6bbdd;
      min-width: 68px;
    }
    input[type="range"] {
      flex: 1;
      height: 6px;
      -webkit-appearance: none;
      background: #222c38;
      border-radius: 10px;
      outline: none;
    }
    input[type="range"]::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 18px;
      height: 18px;
      background: #3f8cff;
      border-radius: 50%;
      cursor: pointer;
      box-shadow: 0 2px 8px #3f8cff66;
      transition: 0.08s;
      border: 2px solid #c0d4ff;
    }
    input[type="range"]::-webkit-slider-thumb:hover {
      background: #5a9eff;
      transform: scale(1.15);
    }
    .value-badge {
      min-width: 32px;
      padding: 2px 8px;
      background: #1e2a38;
      border-radius: 20px;
      font-size: 0.9rem;
      font-weight: 600;
      color: #c9dbf5;
      text-align: center;
    }
    .buttons {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
      margin: 10px 0 4px;
    }
    button {
      background: #1e2a3a;
      color: #e7efff;
      border: 1px solid #33475e;
      padding: 10px 20px;
      border-radius: 40px;
      font-size: 0.95rem;
      font-weight: 500;
      cursor: pointer;
      transition: 0.15s;
      box-shadow: 0 4px 10px rgba(0, 0, 0, 0.3);
      letter-spacing: 0.3px;
      min-width: 76px;
      flex: 0 0 auto;
    }
    button:hover:not(:disabled) {
      background: #293b4f;
      border-color: #4f7fb0;
      transform: translateY(-1px);
    }
    button:active:not(:disabled) {
      transform: translateY(1px);
      box-shadow: none;
    }
    button:disabled {
      opacity: 0.45;
      cursor: not-allowed;
      filter: grayscale(0.5);
    }
    .frames-indicator {
      font-size: 0.95rem;
      background: #182230;
      padding: 8px 18px;
      border-radius: 40px;
      border: 1px solid #2c3c50;
      color: #b8cef0;
      margin-left: auto;
      white-space: nowrap;
    }
    .frames-indicator span {
      font-weight: 700;
      color: #fff;
      background: #2c3c50;
      padding: 2px 10px;
      border-radius: 30px;
      margin-left: 6px;
    }
    .error-msg {
      color: #ff9b9b;
      background: #2e1c1c;
      padding: 8px 16px;
      border-radius: 40px;
      font-size: 0.9rem;
      margin-top: 10px;
      border-left: 4px solid #d44;
      word-break: break-word;
    }
    @media (max-width: 500px) {
      .app { padding: 16px; }
      button { padding: 8px 14px; font-size: 0.85rem; min-width: 60px; }
      .slider-group { flex: 1 1 140px; }
    }
  </style>
</head>
<body>
<div class="app">
  <h2>⏦ 动态正弦波</h2>
  <canvas id="chart" width="800" height="350"></canvas>

  <div class="controls">
    <div class="slider-group">
      <label for="amplitude">振幅</label>
      <input type="range" id="amplitude" min="1" max="5" step="0.1" value="1">
      <span class="value-badge" id="ampVal">1.0</span>
    </div>
    <div class="slider-group">
      <label for="frequency">频率</label>
      <input type="range" id="frequency" min="1" max="5" step="0.1" value="1">
      <span class="value-badge" id="freqVal">1.0</span>
    </div>
  </div>

  <div class="buttons">
    <button id="run" title="开始动画">▶ 运行</button>
    <button id="stop" disabled title="暂停动画">⏸ 暂停</button>
    <button id="step" title="单步一帧">⏭ 单步</button>
    <span class="frames-indicator">帧数 <span id="frames">0</span></span>
  </div>
  <div id="errorMsg" class="error-msg" style="display: none;"></div>
</div>

<script>
(async function() {
  // ---------- 可信 SDK 加载状态 ----------
  const errorEl = document.getElementById('errorMsg');
  let savedError = null;

  // 默认状态
  const defaultState = {
    amplitude: 1,
    frequency: 1,
    phase: 0,
    frames: 0
  };

  let state = { ...defaultState };
  let running = false;
  let animationFrameId = null;

  // DOM 元素
  const canvas = document.getElementById('chart');
  const ctx = canvas.getContext('2d');
  const amplitudeSlider = document.getElementById('amplitude');
  const frequencySlider = document.getElementById('frequency');
  const ampValSpan = document.getElementById('ampVal');
  const freqValSpan = document.getElementById('freqVal');
  const framesSpan = document.getElementById('frames');
  const runBtn = document.getElementById('run');
  const stopBtn = document.getElementById('stop');
  const stepBtn = document.getElementById('step');

  // 在显示错误前先定义showError
  function showError(msg) {
    if (!errorEl) return;
    if (msg) {
      errorEl.textContent = msg;
      errorEl.style.display = 'block';
    } else {
      errorEl.style.display = 'none';
    }
  }

  // ---------- 初始化：恢复状态（异步）----------
  try {
    if (window.spaceTool && typeof window.spaceTool.loadState === 'function') {
      const restored = await spaceTool.loadState();
      if (restored && typeof restored === 'object') {
        // 仅合并已知字段，避免非法数据
        if (typeof restored.amplitude === 'number' && restored.amplitude >= 1 && restored.amplitude <= 5)
          state.amplitude = restored.amplitude;
        if (typeof restored.frequency === 'number' && restored.frequency >= 1 && restored.frequency <= 5)
          state.frequency = restored.frequency;
        if (typeof restored.phase === 'number' && isFinite(restored.phase))
          state.phase = restored.phase;
        if (typeof restored.frames === 'number' && restored.frames >= 0 && Number.isInteger(restored.frames))
          state.frames = restored.frames;
      }
    }
  } catch (e) {
    savedError = '恢复状态失败: ' + (e.message || '未知错误');
    showError(savedError);
  }

  // 同步 UI 滑块与显示
  function syncUIFromState() {
    amplitudeSlider.value = state.amplitude;
    frequencySlider.value = state.frequency;
    ampValSpan.textContent = state.amplitude.toFixed(1);
    freqValSpan.textContent = state.frequency.toFixed(1);
    framesSpan.textContent = state.frames;
  }

  syncUIFromState();

  // 保存状态（含错误处理）
  async function persistState() {
    if (!window.spaceTool || typeof window.spaceTool.saveState !== 'function') return;
    try {
      await spaceTool.saveState({
        amplitude: state.amplitude,
        frequency: state.frequency,
        phase: state.phase,
        frames: state.frames
      });
      showError('');
    } catch (e) {
      showError('保存状态失败: ' + (e.message || '未知错误'));
    }
  }

  // 更新结果接口
  function updateResult() {
    if (window.spaceTool && typeof window.spaceTool.setResult === 'function') {
      const summary = `振幅 ${state.amplitude.toFixed(1)}，频率 ${state.frequency.toFixed(1)}，帧数 ${state.frames}`;
      spaceTool.setResult({
        summary: summary,
        data: {
          amplitude: state.amplitude,
          frequency: state.frequency,
          phase: state.phase,
          frames: state.frames
        }
      });
    }
  }

  // ---------- 绘制正弦波 ----------
  function drawWave() {
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // 背景网格
    ctx.strokeStyle = '#26313e';
    ctx.lineWidth = 0.8;
    const gridStep = 40;
    for (let x = 0; x <= w; x += gridStep) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.strokeStyle = '#1d2835';
      ctx.stroke();
    }
    for (let y = 0; y <= h; y += gridStep) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.strokeStyle = '#1d2835';
      ctx.stroke();
    }

    // 中心轴线
    ctx.beginPath();
    ctx.moveTo(0, h/2);
    ctx.lineTo(w, h/2);
    ctx.strokeStyle = '#33455a';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // 绘制正弦波
    ctx.beginPath();
    const ampScale = (h / 2) * 0.85;       // 保留边距
    const cycles = state.frequency;        // 1~5 个完整周期
    const phase = state.phase;

    for (let px = 0; px <= w; px++) {
      const t = px / w;                   // 0..1
      const angle = 2 * Math.PI * cycles * t + phase;
      const y = h/2 - Math.sin(angle) * state.amplitude * ampScale;
      if (px === 0) ctx.moveTo(px, y);
      else ctx.lineTo(px, y);
    }

    ctx.strokeStyle = '#3f8cff';
    ctx.lineWidth = 3.2;
    ctx.shadowColor = '#3f8cff88';
    ctx.shadowBlur = 12;
    ctx.stroke();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;

    // 在角落标注当前参数
    ctx.font = 'bold 14px system-ui, monospace';
    ctx.fillStyle = '#b8cef0';
    ctx.textAlign = 'right';
    ctx.fillText(`A=${state.amplitude.toFixed(1)}  f=${state.frequency.toFixed(1)}`, w - 16, 28);
  }

  // 帧步进核心：更新 phase 与 frames，重绘，保存状态+结果
  async function advanceOneFrame() {
    // 根据频率调节相位增量速度, 使视觉速度合理
    const phaseStep = 0.08 * state.frequency; 
    state.phase += phaseStep;
    state.frames += 1;

    framesSpan.textContent = state.frames;
    drawWave();

    // 异步保存状态与结果 (不阻塞绘制)
    await persistState();
    updateResult();
  }

  // 动画循环
  function animationLoop() {
    if (!running) return;
    // 执行一帧
    advanceOneFrame().catch(e => {
      console.warn('帧更新异常', e);
    });
    // 继续下一帧
    animationFrameId = requestAnimationFrame(animationLoop);
  }

  // 开始动画
  function startAnimation() {
    if (running) return;
    running = true;
    runBtn.disabled = true;
    stopBtn.disabled = false;
    stepBtn.disabled = true;   // 运行中禁止单步

    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
    animationFrameId = requestAnimationFrame(animationLoop);
  }

  // 停止动画
  function stopAnimation(skipSave = false) {
    if (!running && !animationFrameId) {
      // 确保按钮状态
      runBtn.disabled = false;
      stopBtn.disabled = true;
      stepBtn.disabled = false;
      return;
    }
    running = false;
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
    runBtn.disabled = false;
    stopBtn.disabled = true;
    stepBtn.disabled = false;

    if (!skipSave) {
      persistState().catch(e => console.warn(e));
      updateResult();
    }
  }

  // 单步
  async function stepOnce() {
    if (running) return; // 运行中不可单步
    await advanceOneFrame();
    // 单步后persistState已经在advanceOneFrame调用
  }

  // ---------- 事件绑定 ----------
  // 滑块
  amplitudeSlider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    state.amplitude = val;
    ampValSpan.textContent = val.toFixed(1);
    drawWave();
    // 保存并更新结果 (不等待)
    persistState().catch(e => showError('保存失败: ' + e.message));
    updateResult();
  });

  frequencySlider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    state.frequency = val;
    freqValSpan.textContent = val.toFixed(1);
    drawWave();
    persistState().catch(e => showError('保存失败: ' + e.message));
    updateResult();
  });

  // 按钮
  runBtn.addEventListener('click', () => {
    startAnimation();
  });

  stopBtn.addEventListener('click', () => {
    stopAnimation(false);
  });

  stepBtn.addEventListener('click', () => {
    if (running) return;
    stepOnce().catch(e => showError('单步失败: ' + e.message));
  });

  // 注册暂停回调 (SDK)
  if (window.spaceTool && typeof spaceTool.onPause === 'function') {
    spaceTool.onPause(() => {
      if (running) {
        stopAnimation(true);  // 不重复保存，但保留暂停时状态
        // 额外确保保存
        persistState().catch(e => showError('暂停时保存出错: ' + e.message));
        updateResult();
      } else {
        // 如果已经停止，也保存一次以防止意外
        persistState().catch(e => {});
        updateResult();
      }
    });
  }

  // 响应式：调整canvas尺寸 (保持宽高比)
  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    // 使用显示尺寸设置实际像素尺寸保持清晰
    const displayWidth = rect.width;
    const displayHeight = displayWidth * (7 / 16); // 保持约16:7比例
    canvas.width = Math.round(displayWidth * dpr);
    canvas.height = Math.round(displayHeight * dpr);
    // 重置变换以匹配dpr
    // 不缩放ctx，我们直接以物理像素绘制，简单调整
    // 用物理像素绘制, 但为了清晰，不需要ctx.scale, 因为尺寸已按dpr放大
    // 但绘制坐标是基于物理像素，需要重新计算网格及线条宽度比例？我们简单按原逻辑绘制即可，因为尺寸变了。
    // 但为了不模糊，我们保留绘制逻辑，内部使用canvas.width/height
    drawWave();
  }

  window.addEventListener('resize', resizeCanvas);

  // 初始化绘制 (首帧)
  // 先设置合适尺寸
  const container = canvas.parentElement;
  const initialWidth = container.clientWidth - 40; // 近似
  // 直接调用resizeCanvas基于css
  canvas.style.width = '100%';
  canvas.style.height = 'auto';
  // 等待布局
  setTimeout(() => {
    resizeCanvas();
    // 初次绘制并确保状态持久化
    drawWave();
    updateResult();
    // 保存初始化后的状态(可能覆盖默认)
    persistState().catch(e => showError('初始化保存失败: ' + e.message));
  }, 0);

  // 暴露一点重置功能（没有要求重置按钮，但可以用stop清空？不需要）
  // 安全：运行中页面卸载不保存

  // 保持默认暂停，不自动开始
  // 清理: 关闭时取消动画
  window.addEventListener('beforeunload', () => {
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    // 最后保存一次
    if (window.spaceTool && typeof spaceTool.saveState === 'function') {
      spaceTool.saveState({ 
        amplitude: state.amplitude, 
        frequency: state.frequency, 
        phase: state.phase, 
        frames: state.frames 
      }).catch(()=>{});
    }
  });

  // 确保初始frames显示正确
  framesSpan.textContent = state.frames;
})();
</script>
</body>
</html>
```