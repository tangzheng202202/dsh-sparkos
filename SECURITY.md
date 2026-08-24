# 安全说明（SECURITY.md）

## 部署边界（本机部署模型）

本插件设计运行在**单用户本机** DSH 宿主内：

- 宿主 webServer 默认监听 loopback；工作台页面只应经本机浏览器访问
- VAULT、SQLite、产物目录都在用户主目录下，依赖操作系统文件权限
- 插件**不提供**多用户认证/授权；任何能访问宿主端口的人即被视为该用户
- 若把宿主绑到 `0.0.0.0` 或暴露到网络，超出本插件的安全模型，风险自负

## HTTP 写端点安全边界（插件内实现，DSH webServer 未提供 auth/CSRF API）

全部 mutation POST 经过 `src/server/security.ts` 的三重守卫：

1. **Content-Type**：必须是 `application/json`（charset 参数允许），否则 415 —— 阻断 no-cors 表单走私
2. **同源校验**：浏览器请求的 `Origin` 必须与 `Host` 同源（`Sec-Fetch-Site` 非同源同样拒绝），否则 403
3. **CSRF token**：浏览器请求必须携带有效 `x-sparkos-csrf`（页面内嵌或 `GET /sparkos/csrf` 签发；随机 256-bit、12h 过期、进程内存储、跨站页面不可读取），否则 403

错误一律返回结构化 JSON（`{ok:false,error:{code,message}}`），不含任何凭据或 token 值。

## CSP

两个工作台页面（`/sparkos/app`、`/sparkos/app-v2`）：

- 每请求唯一 nonce（128-bit）；`script-src 'self' 'nonce-…'`，**无 unsafe-inline**
- 保留最小权限：同源 style（`style-src 'unsafe-inline'` 用于现有内联样式）、`img-src 'self' data: blob:`（图片预览）、`frame-src 'self'`、`connect-src 'self'`、`object-src 'none'`、`base-uri 'none'`
- 内联 JSON 数据注入使用唯一安全序列化（`< > & U+2028 U+2029` 全转义），杜绝 `</script>` 突破

## 外部 URL 处理

动态可点击外链（evidenceUrls、evidence[].url 等）双重防护：

- **服务端提交校验**：只接受 `http:`/`https:` 绝对地址；拒绝 `javascript:`、`data:`、`file:`、`vbscript:`、混合大小写变体、空白/控制字符前缀、协议相对地址（`//host`）及一切无法解析的 URL
- **前端渲染**：同一白名单规则（`isSafeUrl`）；历史脏数据**不渲染为链接**，只显示为转义普通文本

## 附件与路径处理

- 视觉附件只接受 DSH attachments 服务的完整附件引用（`sha256:…`）；**禁止 path、URL、base64**
- 回读后校验：SHA-256 一致、字节一致、MIME 白名单（PNG/JPEG/WebP，GIF/SVG 拒绝）、5MiB / 40M 像素上限、**真实像素三方一致**（从实际字节解析 PNG IHDR / JPEG SOF / WebP VP8 系列并做结构校验，拒绝伪造头部）
- 所有 VAULT 文件读取先做 lstat（拒绝 symlink）+ realpath（拒绝越界）+ SHA/bytes 比对；任何缺失/损坏统一归一化为结构化完整性错误（HTTP 422），不会把原生 ENOENT 或可疑内容返回给浏览器
- 产物写入：staging 目录 + rename 原子落盘；可变 JSON 状态走同目录 tmp + fsync + rename

## 凭据处理

- 插件**自身不持有任何 API 密钥**；生图由 agent 调用宿主 `image_generate` 工具完成，凭据归 DSH/各插件配置管理
- 重试补充意见校验明确拒绝本地路径、URL、附件 ID、Provider 密钥模式
- 日志与错误响应不输出任何凭据或 CSRF token 值

## 漏洞报告

- 请通过 GitHub 仓库的 **Security Advisories**（Report a vulnerability）私密报告，或在 issue 中先避免公开可利用细节、私下联系维护者
- 报告请包含：受影响 commit、复现步骤、影响评估
- 修复将在确认后以独立提交发布
