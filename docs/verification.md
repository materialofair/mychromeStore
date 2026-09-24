# 验证记录

2026-09-24，本次实现范围：自建静态网站 + 自有 MV3 Demo；无需管理员权限的本地解压目录更新。

## 环境和结论

- macOS，Node v25.9.0，npm 11.12.1。
- Google Chrome for Testing / Chromium **148.0.7778.96**，独立临时资料目录。
- 本地真实目录授权、网站更新、自动重载、便签保留与恢复均已通过。
- 未安装 Edge，因此没有宣称 Windows Edge 已通过；公司具体策略也不在本机验证范围内。

## 执行命令与结果

| 命令 | 结果 |
|---|---|
| `npm run check` | TypeScript 类型检查通过 |
| `npm run build` | 版本产物生成、类型检查、Vite 生产构建通过 |
| `npm test` | 23/23 通过 |
| `npm audit --audit-level=moderate` | 0 vulnerabilities |
| `CHROMIUM_PATH=<本机测试浏览器> npm run test:e2e` | 4/4 通过（约 20.5 秒） |
| `CHROMIUM_PATH=<本机测试浏览器> node scripts/manual-browser-proof.mjs` | 完整原生目录流程通过；系统选目录/授权由 CUA 操作 |

`CHROMIUM_PATH` 只是选取本机已有的官方测试浏览器；正常使用可执行 `npx playwright install chromium` 后运行测试。

## 动态 QA 场景矩阵

| ID | 用户/异常模型 | 场景与执行入口 | 预期 | 实际结果 / 证据 | 清理 |
|---|---|---|---|---|---|
| N01 | 正常员工 | 原生选择框授权临时外部目录，网站点击更新 | 磁盘和运行版本 1.0→1.1 | native harness 输出 PASS | 测试浏览器和临时目录已清理 |
| N02 | 正常员工 | 更新前填写便签，更新后重开扩展 | 内容仍在；1.1 显示纸张功能 | native harness + real installed e2e PASS | 独立测试资料已清理 |
| N03 | 正常员工 | 刷新网站，再点击恢复 | 目录句柄/备份持久化，运行版本回到 1.0 | native harness 三条 PASS 输出 | 已清理 |
| A01 | 损坏或恶意更新清单 | 路径穿越、Windows 保留名、原型字段、重复/大小写冲突、损坏 hash、超限 | 写入前拒绝 | core.test.ts PASS | 内存 fixture |
| A02 | 选错目录/自行改源码 | manifest 不匹配，受管文件被修改，新路径与用户文件冲突 | 零次写入，保护本地文件 | core.test.ts PASS | 内存 fixture |
| A03 | 磁盘/存储异常 | 备份提交失败、中途写失败、恢复失败 | 不写入或恢复旧版本；无法恢复保留 pending | core.test.ts PASS | 内存 fixture |
| A04 | 中断/刷新 | 浏览器持久化 pending 后刷新网站 | 恢复提示、禁止新更新 | recovery e2e PASS | 浏览器资料自动清理 |
| A05 | 两个标签同时操作 | 第二页获取更新锁 | 拒绝并显示忙碌 | recovery e2e PASS | 释放锁、关闭测试浏览器 |
| A06 | 用户取消授权选择 | showDirectoryPicker 拒绝 AbortError | 明确取消，无假成功 | navigation e2e PASS；此取消场景模拟 API | 浏览器资料自动清理 |
| A07 | 选中目录副本 | 浏览器加载 A，网站更新 OPFS 副本 B，同 key/ID | 运行仍为 1.0，reloadAndVerify 返回 false | real installed e2e PASS | OPFS 在临时资料中 |
| A08 | 非可信网页 | 同主机不同端口发送 RELOAD；错误 scope | 无接受响应、不触发重载 | real installed e2e PASS | 临时 HTTP 服务关闭所有连接 |
| A09 | 窄屏/导航/下载 | 390px 页面、导航按钮、实际 ZIP 下载 | 无横向溢出，下载正确包 | navigation e2e PASS | 截图保留，下载自动清理 |
| A10 | 用户更新后又修改文件 | 对 applied 备份执行恢复 | 拒绝覆盖后续修改 | core.test.ts PASS | 内存 fixture |

自动 filesystem e2e 使用浏览器 OPFS 测试真实 FileSystemDirectoryHandle、IndexedDB 和文件写入；它不能单独证明外部目录授权。N01–N03 使用**真正的原生文件夹选择器与外部临时目录**补足该证据。real installed 自动测试中的实际扩展目录复制使用 Node 完成，单独验证通信和运行时重载；不把该复制步骤当成网页 FSA 测试。

没有 LLM 输入执行功能，因此提示注入场景不适用；界面把目录名/服务错误作为转义文本渲染。研究文档保留了实现前的方案背景。

## 发现与修复

- 代码审查发现保留文件名可影响普通对象字典：拒绝原型保留名并使用空原型字典，补充测试。
- 便签初始化读取期间可能覆盖输入：读取完成前禁用输入和主题操作，失败时保持禁用。
- RELOAD 回应通道可能先断开：不以回应失败直接判断更新失败，继续限时检查运行版本。
- 首轮测试资料的开发者模式没有开启：测试改为通过扩展管理页面显式开启，符合产品已有前提；未变更用户主浏览器配置。
- 扩展重载会关闭弹窗页：测试重开弹窗再检查笔记，避免把正常行为误报为产品失败。
- 未可信端口测试 HTTP 服务的 keep-alive 曾拖延关闭：结束时关闭测试连接，避免悬挂。
- 视觉检查发现装饰便签文字对比不足：修复纸张层叠和文字颜色，再跑响应式检查。

## 独立审查与收尾

- code-reviewer：修复后的结论 APPROVE，23 项单元测试与类型检查通过。
- architect：结论 CLEAR，要求保留「macOS Chromium 已验证、Windows Edge 待验证」边界。
- cleanup：仅整理本次新文件，删除一次性探针，去掉重复 CSS 导入，格式化源码。保留必要的手动重载和恢复失败提示，没有掩盖错误。
- 验证使用隔离浏览器和临时目录，避免修改日常浏览器资料。

## 剩余限制

网站无法证明所选目录就是浏览器实际加载的那个副本；只报告观察到的文件/运行版本。更新是可恢复的多文件写入，不是原子替换；浏览器数据被清理后备份不保证存在。当前为单 Demo MVP，没有账号、上传后台或公共部署。固定 manifest 公钥用于稳定 ID，并不为自托管网页发布提供独立签名信任。
