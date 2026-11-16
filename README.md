# dsh-model-importer

在 DeepSeek Harness 的 **设置 → 模型** 页加入一个图形化向导：连接第三方平台，勾选要用的模型，一次写入当前 profile。首期支持 **阿里百炼（DashScope，OpenAI 兼容模式）**。

## 它做了什么

向导在 `settings.models.footer` 槽位渲染一张卡片，点开后分两步：

1. **连接平台** — 选计费方式（决定 Base URL 与 Key 类型）、粘贴 API Key、确认提供商 ID 与显示名称：

   | 计费方式 | Provider ID | Base URL | API Key | Key 获取页 |
   | --- | --- | --- | --- | --- |
   | 按量计费 | `bailian` | `https://dashscope.aliyuncs.com/compatible-mode/v1`，填了 Workspace ID 则用 `https://{ws}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1` | 普通 `sk-` Key | 控制台 API-KEY 页 |
   | Coding Plan | `bailian-coding` | `https://coding.dashscope.aliyuncs.com/v1` | `sk-sp-` 开头 | Coding Plan 订阅页 |
   | Token Plan 个人版 | `bailian-tpp` | `https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1` | `sk-sp-` 开头 | Token Plan 个人版页 |
   | Token Plan 团队版 | `bailian-tp` | 同上 | 团队版专属 Key | 订阅总览页 |

   Provider ID 默认取表中值，已存在时自动加 `-2`、`-3` 后缀；Base URL 仍可手改。**API Key 字段右侧有「去控制台获取 API Key ↗」链接**，按当前计费方式跳到对应的控制台页面，点击后在系统浏览器打开。
2. **挑选模型** — 调 `llm.discoverModels` 向该接入点拉取模型列表（百炼的 `GET /compatible-mode/v1/models`），可搜索、可按「仅对话模型」过滤、可全选；接口没返回列表时可以手动逐行填写模型 ID。

保存时：

- API Key 写入本机凭据库，引用名为 `<ROUTE>_API_KEY`（如 `BAILIAN_2_API_KEY`，与模型页自身的派生规则一致），配置文件里**不存明文**；
- 其余字段通过 `settings.mutate` 的路径操作写到 `llm-pi-ai` 命名空间的 `providers.<route>`：`displayName`、`api`、`baseURL`、`apiKeyEnv`、`models[]`；
- 写入带 `revision` 校验，遇到 `settings/conflict` 会重新读取后自动重试（最多 3 次）。

保存后关闭向导，卡片上给出「已添加 N 个模型」的提示；重新打开设置页即可在提供商列表里看到新路由。

## 安装

在 DeepSeek Harness 的设置 → 插件页选择「安装本地插件」，指向本目录；或让 Agent 用 `plugin_manager` 的 `install_bundle` 安装（`target` 传本目录的绝对路径）。插件管理器会：

1. 在 profile（`~/.dsh/profiles/desktop`）里以 `link:` 依赖这份源码；
2. 把 `dsh-model-importer` 追加进 `package.json` 的 `dsh.profile.bundles`；
3. 热装载 Host 半边的 cordis 条目（0.2.2-rc.3 上状态为 `applied`，无需重启）。

装好后**刷新页面**（⌘R），再打开 设置 → 模型，页面底部会出现「导入第三方平台模型」卡片。

手动方式（等价于插件管理器做的事）：

```bash
cd ~/.dsh/profiles/desktop
pnpm add link:/path/to/dsh-model-importer
# 再把 "dsh-model-importer" 追加进 package.json 的 dsh.profile.bundles
```

手动改完需要重启 DeepSeek Harness 并刷新页面。

## 卸载

```bash
dsh plugin remove dsh-model-importer
```

已写入的提供商配置和凭据不会自动删除；在 设置 → 模型 里删除该提供商即可。

## 结构

```
package.json        # dsh.bundle.patch + dsh.client（platform: web）
cordis.patch.yml    # 向 composition 插入 id: model-importer 的条目
index.js            # Host 半边：空实现，向导全部在客户端
client.js           # 卡片 + 向导（原生 React 元素 + 作用域样式，只 require react）
locale/zh.json      # 插件列表里的标题与描述
locale/en.json
icon.svg
```

客户端只从模块表取 `react`，其余能力（`remote.settings`、`remote.credentials`、`remote.llm`、`slots`、`locale`）都通过 cordis 注入获得，因此不依赖任何 UI 基础组件包的内部 API。

## 已知限制

- 提供商 ID 写入后不可改名（与模型页一致）；重复保存同一个 ID 会覆盖它的同名配置，向导会提前提示。
- 平台目前只有百炼（四种计费方式见上表）；新增平台只需在 `client.js` 的 `PLANS` 里补一项（`id`、`api`、`baseURL`，可选 `workspaceTemplate`）。
- 平台没有返回容量时，模型按「高级设置」里的默认上下文窗口 / 最大输出写入（默认 131072 / 8192 token）。
- 模型列表固定在弹窗内滚动（占屏幕高度的一半左右，约 12–15 行），上百个模型时用搜索框或「全选当前结果」配合过滤更快。
