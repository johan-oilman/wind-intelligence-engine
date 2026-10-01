# Wind Intelligence Engine · 风电情报

以风电项目底表为中心，记录公告证据、复核事实变化、维护项目状态和时间线。

保留与 [KKKKhazix/AIHOT](https://github.com/KKKKhazix/AIHOT) 的 fork 关系和原始许可证，复用其采集、队列、后台权限和运行管理。原始说明见 [上游 README](docs/upstream-readme.zh-CN.md)。内部包名暂保留 `@aihot/*`，方便同步上游。

## 当前版本：v0.1 项目证据闭环

- CSV 底表导入：先预览差异，再确认；项目 ID、别名、容量校验；重复导入幂等，过期预览拒绝写入。
- 公告正文或附件文字录入：保存快照、哈希、来源和日期；生成规则候选，也可人工指定带原句的候选。
- 人工复核：接受、驳回、历史补录、显式更正；并发版本检查；原因和操作者留痕。
- 多维状态：核准、采购、施工、吊装、并网、异常、容量、开发主体、计划并网日期，按项目或标段分别记录。
- 已绑定信源的文章独立进入项目处理队列，不依赖新闻热度、评分或公开发布；缺正文、未匹配、来源暂停或失败可见。
- 项目列表、详情、证据、复核队列、覆盖检查、内部简报和 CSV 导出。
- 项目跟进过程：把旧监控报告、邮件里的每条项目事件归入底表项目，按事件日期展示连续进展；重复通知合并为一个节点，邮件作为节点的来源凭据。无法归属的事件进入待归属队列。

所有项目接口位于 `/api/admin/wind/*`，需要后台身份，写操作需要 CSRF。项目资料和全文证据不会通过原有公开 API、RSS 或 MCP 输出。

目前自动识别依赖明确项目名或已登记别名，以及简单中文里程碑表述，所有候选均须人工确认。未实现语义模型抽取、附件下载/OCR、主动搜索、微信接入、外部通知或私有项目 MCP。覆盖只反映已配置来源的检查状态。底表容量和开发主体是参考数据，已确认事实单独保存。

## 本机运行

需要 Node.js ≥ 24.11、npm 和 PostgreSQL 17。生产部署沿用 [部署说明](docs/deploy.md)，上线前还需配置身份、备份及确认条款和隐私模板。

```sh
npm ci
cp .env.example .env
```

设置 `.env` 的 `DATABASE_URL`、`SESSION_SECRET`、`IMG_PROXY_SIGN_SECRET`、`ADMIN_PASSWORD`（至少 12 位）。首版项目功能不需要模型密钥。本机配置示例：

```dotenv
DATABASE_URL=postgres://用户名:密码@127.0.0.1:5432/wind_dev
SITE_URL=http://127.0.0.1:3000
API_BASE_URL=http://127.0.0.1:3001
COLLECT_ENABLED=false
MODEL_CALLS_ENABLED=false
FEISHU_CONTENT_PUSH_ENABLED=false
FEISHU_INTERNAL_ENABLED=false
INDEXNOW_SUBMIT_ENABLED=false
```

免登录开发可额外设置 `DEV_AUTH_ROLE=admin`，仅限本机非生产环境；不要用于公开部署。

```sh
npm run db:migrate
# 三个终端分别启动：
npm run dev:api
npm run dev:web
npm run dev:worker
```

打开 `http://127.0.0.1:3000/admin/projects`。显式加载虚构演示数据：

```sh
node --env-file=.env scripts/wind-demo.ts --confirm-demo
```

生产环境禁止演示脚本。真实项目和信源未预置；原有 AI 示例信源已清空。

## 使用流程

1. 在“导入底表”上传或粘贴 CSV，预览后确认；同一项目始终使用同一 ID。
2. 在“提交公告”填写原始发布者、网址、正文和日期。复杂公告可人工指定字段、范围、日期和原句。
3. 到“待复核”核对归属、原句和范围，填写原因后确认。旧证据默认补历史，不回退较新的状态；发现原状态有误时才选“更正”。
4. 在详情查看已确认事实和历史。在“信源管理”新增 RSS、网页或 JSON 来源，再到项目详情绑定来源。
5. 当前采集安全阀关闭。配置并验证来源后才启用采集；“检查已入库材料”只处理现有文章，不会搜索互联网。
6. 查看覆盖与运行结果，下载内部简报。简报按北京时间前一日 09:00 至当日 09:00 的确认记录生成；待复核和覆盖是查询时的当前状态，消息推送尚未启用。
7. 从项目底表进入项目详情，查看“项目跟进过程”。旧邮件和报告中的事件按项目及事件日期排列，原始通知作为记录凭据。底表导入后自动按名称和别名匹配已有事件；匹配不唯一时到“待归属进展”逐事件确认，联合工程可人工选择多个项目。整份报告的资料关联不能决定其中各事件的归属。

历史导入格式为 `{ "records": [...] }`，每项包含 `origin`（gmail/conversation/file）、稳定 `externalId`、`title`、`body`，可选 `archiveUrl`、带时区的 `sourceAt`。邮件 `sentRecord=true` 仅在取得提供方的已发送记录时设置；会话中自称已发送不会被当作邮件发送证明。保留正文中的 JSON 事件，不能解析的记录也完整保存。同一来源和 ID 重复导入幂等，内容变化须另用版本 ID。

```sh
node --env-file=.env scripts/wind-history-import.ts /私有目录/archive.json --confirm-import
```

原始资料放在 `.data/` 或仓库外，禁止提交公开 GitHub。现有接口只导入，不连接邮箱、不改邮件标签、不发送新邮件。主入口 `/` 转入私有项目底表 `/admin/projects`；`/admin/wind/history` 是事件待归属队列。工程进展与复核后的当前状态同时呈现在项目内，不将中标候选人或审批前公示升级为完成节点。日期未知的事件不以邮件发送时间代替。

CSV 表头及虚构示例：

```csv
id,name,province,city,developer,capacityMw,aliases,priority
DEMO-GD-001,示例粤东一期海上风电项目,广东,示例市,示例能源,500,示例粤东一期项目,high
```

别名用分号分隔。容量支持 `500MW`、`50万千瓦` 等单位，统一存 MW。空容量、开发主体和地区不会清掉已有值。

## 验证

使用独立空测试库，名称必须以 `_test` 或 `_ci` 结尾；不要使用业务库。

```sh
DATABASE_URL=postgres://用户名:密码@127.0.0.1:5432/wind_test node scripts/migrate.ts
npm run typecheck
DATABASE_URL=postgres://用户名:密码@127.0.0.1:5432/wind_test MODEL_CALLS_ENABLED=true npm test
npm run build -w @aihot/web
node --test apps/web/tests/*.test.ts
node scripts/smoke.ts --base http://127.0.0.1:3000
```

后台开发时关闭模型安全阀；后端回归单独启用模型调用，只连接测试创建的本机模拟服务与假密钥，不加载真实凭据。采集和外部推送始终关闭。实现边界与后续工作见 [开发说明](docs/wind-development.md)。
