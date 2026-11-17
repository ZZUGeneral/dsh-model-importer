/**
 * Model importer — Client half.
 *
 * A wizard registered into the Models settings page (`settings.models.footer`)
 * that adds a third-party platform (Alibaba Bailian / DashScope first) as a
 * `llm-pi-ai` provider:
 *
 *   1. connect   — billing mode (one of the four Bailian endpoints), API key,
 *                  provider id, display name
 *   2. pick      — `llm.discoverModels` lists the endpoint's models, the user
 *                  selects the ones to expose (with hand-entry as a fallback)
 *   3. save      — the key goes to the credential store, everything else is a
 *                  path-op `settings.mutate` on the `llm-pi-ai` namespace
 *
 * Only `react` is required from the module table: the wizard is plain elements
 * and one scoped stylesheet, so it cannot break on an unknown primitive API.
 */

window.__ModuleLoader__.load({
  id: 'dsh-model-importer',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } = React
    // The wizard is rendered through a portal: the settings page nests the slot inside
    // scrolling/transformed containers, and a `position: fixed` child of those is clipped
    // (or sized against the wrong box), which collapses the model list.
    let createPortal = null
    try {
      createPortal = require('react-dom').createPortal
    } catch (error) {
      createPortal = null
    }

    /** Locale namespace of this plugin's copy. */
    const NS = 'modelImporter'
    /** The pi-ai bundle's settings namespace; its routes live under `providers`. */
    const SETTINGS_NS = 'llm-pi-ai'
    const SLOT = 'settings.models.footer'
    const ENTRY_ID = 'dsh-model-importer'

    /** Conservative capacities for models whose listing reports none. */
    const DEFAULT_CONTEXT_WINDOW = 131072
    const DEFAULT_MAX_TOKENS = 8192

    /** Models that are clearly not chat-completions models. */
    const NON_CHAT = /(embedding|embed-|rerank|tts|asr|speech|voice|cosyvoice|sambert|paraformer|whisper|ocr|drawing|image|video|wanx|wan2|kling|flux|stable-diffusion|text-to-image|image-to-image|sensevoice|-3d|music|pixverse)/i

    /**
     * 支持的平台与各自的计费方式。同一平台下的 plan 区别只有 Base URL 和
     * API Key 的类型，协议都是 OpenAI 兼容，所以是一组同平台的路由预设。
     *
     * `presetModels` 用于不提供 GET /models 列表的套餐入口（如 TokenHub
     * Token Plan）：在线发现失败时回退到内置的当期套餐模型。
     */
    const PLATFORMS = [
      {
        id: 'bailian',
        labelKey: 'platformBailian',
        hintKey: 'platformBailianHint',
        plans: [
          {
            id: 'bailian',
            api: 'openai-completions',
            nameKey: 'nameMetered',
            labelKey: 'planMetered',
            hintKey: 'planMeteredHint',
            keyHintKey: 'planMeteredKeyHint',
            baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            workspaceTemplate: 'https://{workspace}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
            keyURL: 'https://bailian.console.aliyun.com/cn-beijing/model/settings/api-key',
          },
          {
            id: 'bailian-coding',
            api: 'openai-completions',
            nameKey: 'nameCoding',
            labelKey: 'planCoding',
            hintKey: 'planCodingHint',
            keyHintKey: 'planCodingKeyHint',
            baseURL: 'https://coding.dashscope.aliyuncs.com/v1',
            keyURL: 'https://bailian.console.aliyun.com/cn-beijing/subscription/coding-plan',
          },
          {
            id: 'bailian-tpp',
            api: 'openai-completions',
            nameKey: 'nameTpp',
            labelKey: 'planTpp',
            hintKey: 'planTppHint',
            keyHintKey: 'planTppKeyHint',
            baseURL: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
            keyURL: 'https://bailian.console.aliyun.com/cn-beijing/subscription/token-plan/personal',
          },
          {
            id: 'bailian-tp',
            api: 'openai-completions',
            nameKey: 'nameTp',
            labelKey: 'planTp',
            hintKey: 'planTpHint',
            keyHintKey: 'planTpKeyHint',
            baseURL: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
            keyURL: 'https://bailian.console.aliyun.com/cn-beijing/subscription/overview',
          },
        ],
      },
      {
        id: 'siliconflow',
        labelKey: 'platformSiliconflow',
        hintKey: 'platformSiliconflowHint',
        plans: [
          {
            id: 'siliconflow',
            api: 'openai-completions',
            nameKey: 'nameSiliconflow',
            labelKey: 'planSfMetered',
            hintKey: 'planSfMeteredHint',
            keyHintKey: 'planSfMeteredKeyHint',
            baseURL: 'https://api.siliconflow.cn/v1',
            keyURL: 'https://cloud.siliconflow.cn/account/ak',
          },
        ],
      },
      {
        id: 'tokenhub',
        labelKey: 'platformTokenhub',
        hintKey: 'platformTokenhubHint',
        plans: [
          {
            id: 'tokenhub',
            api: 'openai-completions',
            nameKey: 'nameTokenhub',
            labelKey: 'planThMetered',
            hintKey: 'planThMeteredHint',
            keyHintKey: 'planThMeteredKeyHint',
            baseURL: 'https://tokenhub.tencentmaas.com/v1',
            keyURL: 'https://console.cloud.tencent.com/tokenhub/apikey',
          },
          {
            id: 'tokenhub-plan',
            api: 'openai-completions',
            nameKey: 'nameTokenhubPlan',
            labelKey: 'planThPlan',
            hintKey: 'planThPlanHint',
            keyHintKey: 'planThPlanKeyHint',
            baseURL: 'https://tokenhub.tencentmaas.com/plan/v3',
            keyURL: 'https://console.cloud.tencent.com/tokenhub/tokenplan',
            // 套餐入口没有 GET /models（实测 404），内置官方当期套餐模型。
            // 模型库动态更新，以控制台为准；列表来自官方套餐概览文档。
            presetModels: [
              { id: 'tc-code-latest', name: 'Auto (smart routing)' },
              { id: 'deepseek-v4.1-flash-1017', name: 'DeepSeek-V4.1-Flash-1017' },
              { id: 'deepseek-v4-pro-0813', name: 'DeepSeek-V4-Pro-0813' },
              { id: 'deepseek/deepseek-flash', name: 'DeepSeek-V4.1-Flash (vendor-direct)' },
              { id: 'deepseek-v4-flash-202605', name: 'DeepSeek-V4-Flash (vendor-direct)' },
              { id: 'deepseek-v4-pro-202606', name: 'DeepSeek-V4-Pro (vendor-direct)' },
              { id: 'hy4-flash', name: 'Hy4 flash' },
              { id: 'hy4', name: 'Hy4' },
              { id: 'minimax-m3', name: 'MiniMax-M3' },
              { id: 'glm-5.3', name: 'GLM-5.3' },
              { id: 'glm-5.3-flash', name: 'GLM-5.3-Flash' },
              { id: 'glm-5.2', name: 'GLM-5.2' },
              { id: 'kimi-k2.7-code', name: 'Kimi K2.7 Code' },
              { id: 'kimi-k3', name: 'Kimi K3' },
              { id: 'mimo-v2.6-flash', name: 'MiMo-V2.6-Flash' },
            ],
          },
        ],
      },
      {
        id: 'ark',
        labelKey: 'platformArk',
        hintKey: 'platformArkHint',
        plans: [
          {
            id: 'ark',
            api: 'openai-completions',
            nameKey: 'nameArk',
            labelKey: 'planArkMetered',
            hintKey: 'planArkMeteredHint',
            keyHintKey: 'planArkMeteredKeyHint',
            baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
            keyURL: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
          },
          {
            id: 'ark-coding',
            api: 'openai-completions',
            nameKey: 'nameArkCoding',
            labelKey: 'planArkCoding',
            hintKey: 'planArkCodingHint',
            keyHintKey: 'planArkCodingKeyHint',
            baseURL: 'https://ark.cn-beijing.volces.com/api/coding/v3',
            keyURL: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
          },
        ],
      },
    ]

    /** Flat plan list, kept for lookups by plan id. */
    const PLANS = PLATFORMS.flatMap((platform) => platform.plans)

    /**
     * Resolve the endpoint of a plan.
     *
     * The metered plan addresses a per-workspace gateway once a workspace is
     * given and falls back to the shared public endpoint otherwise.
     */
    function planBaseURL(plan, workspace) {
      const raw = String(workspace || '').trim()
      if (!plan.workspaceTemplate || raw.length === 0) return plan.baseURL
      const host = /^ws-/i.test(raw) ? raw : `ws-${raw}`
      return plan.workspaceTemplate.replace('{workspace}', host)
    }

    const ZH = {
      cardTitle: '从其他平台导入模型',
      cardDesc: '用图形化向导连接第三方平台，挑选模型后写入当前 profile 的提供商配置。支持阿里百炼、硅基流动、腾讯云 TokenHub 与火山引擎方舟。',
      open: '开始导入',
      wizardTitle: '导入第三方平台模型',
      stepConnect: '连接平台',
      stepSelect: '挑选模型',
      platform: '平台',
      platformBailian: '阿里百炼 DashScope',
      platformBailianHint: '四种计费方式都是 OpenAI 兼容协议，只是地址与密钥不同。',
      platformSiliconflow: '硅基流动 SiliconFlow',
      platformSiliconflowHint: '一个 API Key 调用模型广场中的开源与商业模型，OpenAI 兼容协议。',
      platformTokenhub: '腾讯云 TokenHub',
      platformTokenhubHint: '按量计费与 Token Plan 套餐两种入口，均为 OpenAI 兼容协议。',
      platformArk: '火山引擎方舟',
      platformArkHint: '按量计费与 Coding Plan 两种入口，OpenAI 兼容协议。',
      plan: '计费方式',
      planMetered: '按量计费',
      planMeteredHint: '控制台的普通 API Key（sk- 开头）。',
      planCoding: 'Coding Plan',
      planCodingHint: 'Coding Plan 专属 API Key，走 coding.dashscope.aliyuncs.com。',
      planTpp: 'Token Plan 个人版',
      planTppHint: 'Token Plan 个人版密钥，形如 sk-sp- 开头。',
      planTp: 'Token Plan 团队版',
      planTpHint: 'Token Plan 团队版专属 API Key。',
      planMeteredKeyHint: '普通百炼 API Key，sk- 开头。',
      planCodingKeyHint: 'Coding Plan 专属 API Key。',
      planTppKeyHint: 'Token Plan 个人版密钥，sk-sp- 开头。',
      planTpKeyHint: 'Token Plan 团队版专属 Key。',
      planSfMetered: '按量计费',
      planSfMeteredHint: '硅基流动统一 API Key，可调用模型广场中的模型。',
      planSfMeteredKeyHint: '硅基流动 API Key，sk- 开头。',
      planThMetered: '按量计费',
      planThMeteredHint: 'TokenHub 控制台创建的 API Key，按 token 用量计费。',
      planThMeteredKeyHint: 'TokenHub 按量计费 API Key。',
      planThPlan: 'Token Plan 套餐',
      planThPlanHint: '包月套餐（通用/Hy），接口不提供模型列表，已内置当期套餐模型。',
      planThPlanKeyHint: 'Token Plan 密钥，sk-tp- 开头，通用与 Hy 套餐共用。',
      planArkMetered: '按量计费',
      planArkMeteredHint: '方舟 API Key，模型可填模型名或 ep- 接入点。',
      planArkMeteredKeyHint: '火山方舟 API Key。',
      planArkCoding: 'Coding Plan',
      planArkCodingHint: '方舟 Coding Plan 订阅专属入口。',
      planArkCodingKeyHint: 'Coding Plan 专属 API Key。',
      workspace: 'Workspace ID',
      workspacePlaceholder: 'ws-...（可省略 ws- 前缀）',
      workspaceHint: '填写后走专属域名；留空则用公共域名。改写 Workspace ID 会覆盖下面的 Base URL。',
      nameMetered: '阿里百炼 · 按量计费',
      nameCoding: '阿里百炼 · Coding Plan',
      nameTpp: '阿里百炼 · Token Plan 个人版',
      nameTp: '阿里百炼 · Token Plan 团队版',
      nameSiliconflow: '硅基流动',
      nameTokenhub: '腾讯云 TokenHub · 按量计费',
      nameTokenhubPlan: '腾讯云 TokenHub · Token Plan',
      nameArk: '火山引擎方舟',
      nameArkCoding: '火山引擎方舟 · Coding Plan',
      baseURL: '接口地址（Base URL）',
      baseURLHint: '可直接改成私有部署或自定义接入点地址。',
      apiKey: 'API Key',
      apiKeyPlaceholder: 'sk-...',
      apiKeyHint: '只写入本机凭据库，配置文件里仅保存引用名，不存明文。',
      getKey: '去控制台获取 API Key',
      displayName: '显示名称',
      providerId: '提供商 ID',
      providerIdHint: '小写字母、数字和连字符，以字母开头；写入配置后不可改名。',
      advanced: '高级设置',
      contextWindow: '默认上下文窗口',
      maxTokens: '默认最大输出',
      advancedHint: '平台未返回容量时使用，单位为 token。',
      loadModels: '获取可用模型',
      loadingModels: '正在获取…',
      modelsTotal: '共 {m} 个模型',
      selectedCount: '已选 {n} / {m}',
      search: '搜索模型 ID 或名称',
      filterAll: '全部',
      filterChat: '仅对话模型',
      selectAll: '全选当前结果',
      clear: '清空',
      manual: '手动填写模型',
      manualHint: '每行一个模型 ID，例如 qwen3-max。',
      manualApply: '使用这些模型',
      cancel: '取消',
      save: '保存到 profile',
      saving: '正在保存…',
      saved: '已添加 {n} 个模型到「{name}」。',
      credentialFailed: 'API Key 保存失败：{message}',
      saveFailed: '写入配置失败：{message}',
      conflictRetry: '配置刚被修改，正在重试…',
      overwriteWarn: '提供商 ID「{id}」已存在，保存会覆盖它的同名配置。',
      idInvalid: 'ID 只能包含小写字母、数字和连字符，且以字母开头。',
      needKey: '请先填写 API Key。',
      needSelection: '请至少选择一个模型。',
      noModels: '这个接口没有返回任何模型，可以手动填写模型 ID。',
      presetNotice: '该套餐接口不提供模型列表，已载入内置的套餐模型（以控制台实际可用为准）。',
      emptyFilter: '没有匹配的模型。',
      truncated: '仅显示前 {n} 个，请用搜索缩小范围。',
      readonly: '当前 profile 不允许写入配置。',
      describeFailed: '读取现有提供商失败：{message}',
      noNamespace: '没有找到 llm-pi-ai 的配置命名空间。',
      unknownError: '未知错误',
      done: '完成',
      modelsTitle: '可用模型',
      back: '上一步',
    }

    const EN = {
      cardTitle: 'Import models from another platform',
      cardDesc: 'Connect a third-party platform with a graphical wizard and write the models you pick into this profile. Supports Alibaba Bailian, SiliconFlow, Tencent Cloud TokenHub and Volcano Engine Ark.',
      open: 'Start import',
      wizardTitle: 'Import a platform\'s models',
      stepConnect: 'Connect',
      stepSelect: 'Pick models',
      platform: 'Platform',
      platformBailian: 'Alibaba Bailian (DashScope)',
      platformBailianHint: 'All four billing modes speak the same OpenAI-compatible protocol.',
      platformSiliconflow: 'SiliconFlow',
      platformSiliconflowHint: 'One API key for the open-source and commercial models in the model plaza; OpenAI-compatible.',
      platformTokenhub: 'Tencent Cloud TokenHub',
      platformTokenhubHint: 'Pay-as-you-go and Token Plan subscription entries, both OpenAI-compatible.',
      platformArk: 'Volcano Engine Ark',
      platformArkHint: 'Pay-as-you-go and Coding Plan entries, OpenAI-compatible.',
      plan: 'Billing mode',
      planMetered: 'Pay as you go',
      planMeteredHint: 'A regular console API key (starts with sk-).',
      planCoding: 'Coding Plan',
      planCodingHint: 'A Coding Plan key; served from coding.dashscope.aliyuncs.com.',
      planTpp: 'Token Plan (personal)',
      planTppHint: 'A personal Token Plan key, usually starting with sk-sp-.',
      planTp: 'Token Plan (team)',
      planTpHint: 'A team Token Plan key.',
      planMeteredKeyHint: 'A regular Bailian key starting with sk-.',
      planCodingKeyHint: 'A Coding Plan key.',
      planTppKeyHint: 'A personal Token Plan key starting with sk-sp-.',
      planTpKeyHint: 'A team Token Plan key.',
      planSfMetered: 'Pay as you go',
      planSfMeteredHint: 'A unified SiliconFlow API key for the models in the model plaza.',
      planSfMeteredKeyHint: 'A SiliconFlow API key starting with sk-.',
      planThMetered: 'Pay as you go',
      planThMeteredHint: 'An API key created in the TokenHub console, billed by token usage.',
      planThMeteredKeyHint: 'A TokenHub pay-as-you-go API key.',
      planThPlan: 'Token Plan subscription',
      planThPlanHint: 'Monthly subscription (general/Hy). No model listing endpoint; built-in plan models are used.',
      planThPlanKeyHint: 'A Token Plan key starting with sk-tp-, shared by general and Hy plans.',
      planArkMetered: 'Pay as you go',
      planArkMeteredHint: 'An Ark API key; use a model name or an ep- endpoint id.',
      planArkMeteredKeyHint: 'A Volcano Ark API key.',
      planArkCoding: 'Coding Plan',
      planArkCodingHint: 'The dedicated entry for an Ark Coding Plan subscription.',
      planArkCodingKeyHint: 'A Coding Plan API key.',
      workspace: 'Workspace ID',
      workspacePlaceholder: 'ws-... (the ws- prefix is optional)',
      workspaceHint: 'Use the dedicated host when set; otherwise the public host. Editing it rewrites the Base URL below.',
      nameMetered: 'Alibaba Bailian · pay as you go',
      nameCoding: 'Alibaba Bailian · Coding Plan',
      nameTpp: 'Alibaba Bailian · Token Plan (personal)',
      nameTp: 'Alibaba Bailian · Token Plan (team)',
      nameSiliconflow: 'SiliconFlow',
      nameTokenhub: 'Tencent Cloud TokenHub · pay as you go',
      nameTokenhubPlan: 'Tencent Cloud TokenHub · Token Plan',
      nameArk: 'Volcano Engine Ark',
      nameArkCoding: 'Volcano Engine Ark · Coding Plan',
      baseURL: 'Base URL',
      baseURLHint: 'A private deployment or custom endpoint URL works too.',
      apiKey: 'API key',
      apiKeyPlaceholder: 'sk-...',
      apiKeyHint: 'Stored in the local credential store only; the profile keeps the reference name.',
      getKey: 'Get an API key',
      displayName: 'Display name',
      providerId: 'Provider ID',
      providerIdHint: 'Lowercase letters, digits and hyphens, starting with a letter. Permanent once saved.',
      advanced: 'Advanced',
      contextWindow: 'Default context window',
      maxTokens: 'Default max output',
      advancedHint: 'Used when the platform reports no capacity. Tokens.',
      loadModels: 'Fetch available models',
      loadingModels: 'Fetching…',
      modelsTotal: '{m} models',
      selectedCount: '{n} of {m} selected',
      search: 'Search model id or name',
      filterAll: 'All',
      filterChat: 'Chat models only',
      selectAll: 'Select all shown',
      clear: 'Clear',
      manual: 'Enter models by hand',
      manualHint: 'One model id per line, e.g. qwen3-max.',
      manualApply: 'Use these models',
      cancel: 'Cancel',
      save: 'Save to profile',
      saving: 'Saving…',
      saved: 'Added {n} models to "{name}".',
      credentialFailed: 'Could not save the API key: {message}',
      saveFailed: 'Could not write the configuration: {message}',
      conflictRetry: 'The configuration just changed; retrying…',
      overwriteWarn: 'Provider id "{id}" already exists; saving overwrites its settings.',
      idInvalid: 'Use lowercase letters, digits and hyphens, starting with a letter.',
      needKey: 'Enter the API key first.',
      needSelection: 'Select at least one model.',
      noModels: 'The endpoint returned no models; you can enter model ids by hand.',
      presetNotice: 'This subscription endpoint has no model listing; the built-in plan models are loaded (actual availability follows the console).',
      emptyFilter: 'No model matches.',
      truncated: 'Showing the first {n}; narrow it with search.',
      readonly: 'This profile does not accept writes.',
      describeFailed: 'Could not read the existing providers: {message}',
      noNamespace: 'No llm-pi-ai settings namespace was found.',
      unknownError: 'Unknown error',
      done: 'Done',
      modelsTitle: 'Available models',
      back: 'Back',
    }

    const CSS = `
.dsh-mi-card{display:flex;align-items:center;gap:16px;padding:14px 16px;border-radius:16px;
  border:1px dashed var(--dsw-alias-border-l3,rgba(127,127,127,.35));
  background:var(--dsw-alias-settings-card-fill,var(--dsw-alias-bg-layer-2,transparent));
  font-family:var(--dsw-font-family,system-ui);}
.dsh-mi-card-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;}
.dsh-mi-card-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,inherit);}
.dsh-mi-card-desc{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary,inherit);}
.dsh-mi-flash{font-size:12px;color:var(--dsw-alias-state-success-primary,#2e9e5b);}
.dsh-mi-btn{appearance:none;border:1px solid transparent;border-radius:999px;padding:6px 14px;
  font-size:12px;font-family:inherit;cursor:pointer;transition:background .15s,border-color .15s;white-space:nowrap;}
.dsh-mi-btn:disabled{opacity:.45;cursor:not-allowed;}
.dsh-mi-btn-primary{background:var(--dsw-alias-button-primary-fill,#247bbf);
  color:var(--dsw-alias-label-primary-foreground,#fff);}
.dsh-mi-btn-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,#1f6aa6);}
.dsh-mi-btn-ghost{background:transparent;border-color:var(--dsw-alias-border-l3,rgba(127,127,127,.35));
  color:var(--dsw-alias-label-primary,inherit);}
.dsh-mi-btn-ghost:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));}
.dsh-mi-overlay{position:fixed;inset:0;z-index:1200;display:flex;align-items:center;justify-content:center;
  padding:24px;overflow:auto;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.42));}
.dsh-mi-panel{display:flex;flex-direction:column;width:min(680px,100%);max-height:min(90vh,820px);
  border-radius:20px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28));
  background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base,#1b1b1b));
  color:var(--dsw-alias-label-primary,inherit);font-family:var(--dsw-font-family,system-ui);
  box-shadow:0 24px 64px rgba(0,0,0,.35);overflow:hidden;}
.dsh-mi-head{display:flex;align-items:center;gap:12px;padding:16px 20px;
  border-bottom:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.22));}
.dsh-mi-title{flex:1;font-size:14px;font-weight:600;}
.dsh-mi-steps{display:flex;gap:6px;align-items:center;font-size:11px;color:var(--dsw-alias-label-tertiary,inherit);}
.dsh-mi-step{padding:2px 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l3,rgba(127,127,127,.3));}
.dsh-mi-step.is-on{color:var(--dsw-alias-brand-primary,#247bbf);border-color:currentColor;}
.dsh-mi-close{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-tertiary,inherit);
  font-size:16px;line-height:1;cursor:pointer;padding:4px 6px;border-radius:8px;}
.dsh-mi-close:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));}
.dsh-mi-body{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;padding:16px 20px;
  display:flex;flex-direction:column;gap:14px;overscroll-behavior:contain;}
.dsh-mi-body > *{flex:0 0 auto;}
.dsh-mi-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 14px;}
.dsh-mi-field{display:flex;flex-direction:column;gap:5px;font-size:12px;min-width:0;}
.dsh-mi-field.is-wide{grid-column:1 / -1;}
.dsh-mi-label{color:var(--dsw-alias-label-secondary,inherit);font-weight:500;}
.dsh-mi-labelrow{display:flex;align-items:baseline;justify-content:space-between;gap:8px;}
.dsh-mi-link{color:var(--dsw-alias-brand-primary,#3b6ff5);text-decoration:none;font-size:11px;white-space:nowrap;
  border-radius:4px;padding:1px 2px;}
.dsh-mi-link:hover{text-decoration:underline;}
.dsh-mi-link:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#3b6ff5);outline-offset:1px;}
.dsh-mi-input,.dsh-mi-select,.dsh-mi-textarea{width:100%;box-sizing:border-box;font-family:inherit;font-size:12px;
  padding:7px 10px;border-radius:10px;border:1px solid var(--dsw-alias-border-l3,rgba(127,127,127,.35));
  background:var(--dsw-alias-bg-layer-2,transparent);color:var(--dsw-alias-label-primary,inherit);outline:none;}
.dsh-mi-input:focus,.dsh-mi-select:focus,.dsh-mi-textarea:focus{
  border-color:var(--dsw-alias-brand-primary,#247bbf);}
.dsh-mi-textarea{min-height:96px;resize:vertical;font-family:var(--ds-font-family-code,monospace);}
.dsh-mi-hint{font-size:11px;line-height:1.45;color:var(--dsw-alias-label-caption,var(--dsw-alias-label-tertiary,inherit));}
.dsh-mi-warn{font-size:11px;color:var(--dsw-alias-state-warn-primary,#b7791f);}
.dsh-mi-error{font-size:12px;color:var(--dsw-alias-label-error,#d9534f);word-break:break-word;}
.dsh-mi-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.dsh-mi-row.is-end{justify-content:flex-end;}
.dsh-mi-spacer{flex:1;}
.dsh-mi-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.dsh-mi-toolbar .dsh-mi-input{flex:1;min-width:160px;}
.dsh-mi-toggle{display:inline-flex;align-items:center;gap:6px;font-size:12px;
  color:var(--dsw-alias-label-secondary,inherit);cursor:pointer;user-select:none;}
.dsh-mi-models{flex:0 0 auto;display:flex;flex-direction:column;gap:2px;
  max-height:min(52vh,460px);overflow-y:auto;overscroll-behavior:contain;
  scrollbar-gutter:stable;
  border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.22));border-radius:12px;padding:6px;}
.dsh-mi-model{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;cursor:pointer;
  font-size:12px;}
.dsh-mi-model:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1));}
.dsh-mi-model.is-on{background:var(--dsw-alias-button-ghost-active-fill,rgba(36,123,191,.12));}
.dsh-mi-model input{accent-color:var(--dsw-alias-brand-primary,#247bbf);}
.dsh-mi-model-id{font-family:var(--ds-font-family-code,monospace);}
.dsh-mi-model-name{color:var(--dsw-alias-label-tertiary,inherit);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.dsh-mi-model-meta{margin-left:auto;font-size:11px;color:var(--dsw-alias-label-caption,inherit);}
.dsh-mi-foot{display:flex;align-items:center;gap:10px;padding:12px 20px;
  border-top:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.22));}
.dsh-mi-foot-note{flex:1;font-size:11px;color:var(--dsw-alias-label-tertiary,inherit);min-width:0;}
`

    /** `{name}` interpolation for the dictionaries above. */
    function fmt(text, vars) {
      return String(text).replace(/\{(\w+)\}/g, (whole, key) =>
        vars && Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : whole)
    }

    function formatCount(value) {
      if (!Number.isFinite(value)) return ''
      if (value >= 1024 * 1024) return `${Math.round(value / (1024 * 1024))}M`
      if (value >= 1024) return `${Math.round(value / 1024)}k`
      return String(value)
    }

    function isChatModel(model) {
      const id = String(model.id || '')
      return !NON_CHAT.test(id)
    }

    /** `<ROUTE>_API_KEY`, the same reference the Models page derives. */
    function deriveKeyRef(provider) {
      return `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
    }

    function freeRouteId(taken, base) {
      if (!taken.has(base)) return base
      for (let n = 2; n < 100; n += 1) {
        const candidate = `${base}-${n}`
        if (!taken.has(candidate)) return candidate
      }
      return `${base}-${Date.now().toString(36)}`
    }

    /** Subscribe to the locale revision so the card re-renders on a switch. */
    function useTranslate(ctx) {
      const subscribe = useCallback((notify) => ctx.locale.subscribe(notify), [ctx])
      const snapshot = useCallback(() => ctx.locale.getSnapshot().active, [ctx])
      const active = useSyncExternalStore(subscribe, snapshot)
      return useMemo(() => ctx.locale.bind(NS), [ctx, active])
    }

    function Field(props) {
      return h('label', { className: `dsh-mi-field${props.wide ? ' is-wide' : ''}` },
        h('span', { className: 'dsh-mi-label' }, props.label),
        props.children,
        props.hint ? h('span', { className: 'dsh-mi-hint' }, props.hint) : null,
      )
    }

    function ModelRow(props) {
      const model = props.model
      const checked = props.checked
      return h('label', { className: `dsh-mi-model${checked ? ' is-on' : ''}` },
        h('input', {
          type: 'checkbox',
          checked,
          onChange: () => props.onToggle(model.id),
        }),
        h('span', { className: 'dsh-mi-model-id' }, model.id),
        model.name && model.name !== model.id
          ? h('span', { className: 'dsh-mi-model-name' }, model.name)
          : null,
        model.contextWindow
          ? h('span', { className: 'dsh-mi-model-meta' }, formatCount(model.contextWindow))
          : null,
      )
    }

    /** The wizard. Mounted only while open, so its state resets every time. */
    function Wizard(props) {
      const { ctx, t, onClose, onSaved } = props
      const [platformId, setPlatformId] = useState(PLATFORMS[0].id)
      const platform = PLATFORMS.find((entry) => entry.id === platformId) || PLATFORMS[0]
      const [planId, setPlanId] = useState(PLATFORMS[0].plans[0].id)
      const plan = PLANS.find((entry) => entry.id === planId) || PLATFORMS[0].plans[0]

      const [workspace, setWorkspace] = useState('')
      const [baseURL, setBaseURL] = useState(planBaseURL(PLATFORMS[0].plans[0], ''))
      const [apiKey, setApiKey] = useState('')
      const [routeId, setRouteId] = useState('')
      const [routeTouched, setRouteTouched] = useState(false)
      const [displayName, setDisplayName] = useState(t(PLATFORMS[0].plans[0].nameKey))
      const [nameTouched, setNameTouched] = useState(false)
      const [providers, setProviders] = useState(null)
      const [writable, setWritable] = useState(true)
      const [describeError, setDescribeError] = useState('')

      const [models, setModels] = useState(null)
      const [selection, setSelection] = useState({})
      const bodyRef = useRef(null)
      const [discoverState, setDiscoverState] = useState('idle')
      const [discoverError, setDiscoverError] = useState('')
      const [discoverNotice, setDiscoverNotice] = useState('')
      const [query, setQuery] = useState('')
      const [onlyChat, setOnlyChat] = useState(true)

      const [advancedOpen, setAdvancedOpen] = useState(false)
      const [contextWindow, setContextWindow] = useState(String(DEFAULT_CONTEXT_WINDOW))
      const [maxTokens, setMaxTokens] = useState(String(DEFAULT_MAX_TOKENS))

      const [manualOpen, setManualOpen] = useState(false)
      const [manualText, setManualText] = useState('')

      const [saving, setSaving] = useState(false)
      const [saveError, setSaveError] = useState('')

      useEffect(() => {
        let alive = true
        async function load() {
          try {
            const res = await ctx.remote.settings.describe()
            if (!alive) return
            if (!res || res.ok !== true) {
              setDescribeError((res && res.error && res.error.message) || t('unknownError'))
              setWritable(false)
              return
            }
            const namespaces = (res.value && res.value.namespaces) || []
            const view = namespaces.find((entry) => entry.ns === SETTINGS_NS)
            if (!view) setDescribeError(t('noNamespace'))
            const current = (view && view.value && view.value.providers) || {}
            setProviders(new Set(Object.keys(current)))
            setWritable(res.value.writable !== false)
          } catch (error) {
            if (alive) setDescribeError(String((error && error.message) || error))
          }
        }
        load()
        return () => { alive = false }
        // The describe read runs once per opening; `t` is only used for copy.
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [ctx])

      useEffect(() => {
        if (routeTouched || providers === null) return
        setRouteId(freeRouteId(providers, plan.id))
      }, [providers, routeTouched, plan.id])

      // Discovery can leave the list below the fold; scroll it into view once rendered.
      useEffect(() => {
        if (discoverState !== 'ready' || !bodyRef.current) return
        const list = bodyRef.current.querySelector('.dsh-mi-models')
        if (list && typeof list.scrollIntoView === 'function') list.scrollIntoView({ block: 'nearest' })
      }, [discoverState])

      /** Drop any discovered list when the endpoint changes. */
      function resetDiscovery() {
        setModels(null)
        setSelection({})
        setDiscoverState('idle')
        setDiscoverError('')
        setDiscoverNotice('')
      }

      /** Switching platform selects its first plan and re-derives defaults. */
      function pickPlatform(nextPlatformId) {
        const nextPlatform = PLATFORMS.find((entry) => entry.id === nextPlatformId) || PLATFORMS[0]
        const nextPlan = nextPlatform.plans[0]
        setPlatformId(nextPlatform.id)
        setPlanId(nextPlan.id)
        setWorkspace('')
        setBaseURL(planBaseURL(nextPlan, ''))
        if (!nameTouched) setDisplayName(t(nextPlan.nameKey))
        resetDiscovery()
      }

      /** Switching the billing mode re-derives the endpoint and the default name. */
      function pickPlan(nextId) {
        const next = PLANS.find((entry) => entry.id === nextId) || PLATFORMS[0].plans[0]
        setPlanId(next.id)
        setBaseURL(planBaseURL(next, workspace))
        if (!nameTouched) setDisplayName(t(next.nameKey))
        resetDiscovery()
      }

      /** The metered plan rewrites the endpoint while the workspace id changes. */
      function pickWorkspace(value) {
        setWorkspace(value)
        if (plan.workspaceTemplate) setBaseURL(planBaseURL(plan, value))
      }

      const idValid = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(routeId)
      const idTaken = providers !== null && providers.has(routeId)
      const selectedIds = Object.keys(selection).filter((id) => selection[id])
      const selectedCount = selectedIds.length

      const filtered = useMemo(() => {
        const source = models || []
        const needle = query.trim().toLowerCase()
        return source.filter((model) => {
          if (onlyChat && !isChatModel(model)) return false
          if (!needle) return true
          return String(model.id).toLowerCase().includes(needle)
            || String(model.name || '').toLowerCase().includes(needle)
        })
      }, [models, query, onlyChat])

      const visible = filtered.slice(0, 300)

      function toggle(id) {
        setSelection((prev) => {
          const next = { ...prev }
          if (next[id]) delete next[id]
          else next[id] = true
          return next
        })
      }

      function selectAllShown() {
        setSelection((prev) => {
          const next = { ...prev }
          for (const model of filtered) next[model.id] = true
          return next
        })
      }

      function clearSelection() {
        setSelection({})
      }

      /** Load the plan's built-in models when the endpoint has no listing. */
      function usePresetModels() {
        const list = plan.presetModels.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)))
        setModels(list)
        setSelection({})
        setDiscoverState('ready')
        setDiscoverError('')
        setDiscoverNotice(t('presetNotice'))
      }

      async function handleDiscover() {
        setSaveError('')
        setDiscoverError('')
        setDiscoverNotice('')
        if (!apiKey.trim()) {
          setDiscoverError(t('needKey'))
          return
        }
        setDiscoverState('loading')
        try {
          const res = await ctx.remote.llm.discoverModels(SETTINGS_NS, {
            baseURL: baseURL.trim(),
            api: plan.api,
            apiKey: apiKey.trim(),
          })
          if (res && res.ok === true) {
            const list = (res.value || []).slice().sort((a, b) => String(a.id).localeCompare(String(b.id)))
            if (list.length === 0 && plan.presetModels) {
              usePresetModels()
              return
            }
            setModels(list)
            setSelection({})
            setDiscoverState('ready')
            if (list.length === 0) setDiscoverError(t('noModels'))
          } else if (plan.presetModels) {
            usePresetModels()
          } else {
            setModels(null)
            setDiscoverState('error')
            setDiscoverError((res && res.error && res.error.message) || t('unknownError'))
          }
        } catch (error) {
          if (plan.presetModels) {
            usePresetModels()
          } else {
            setDiscoverState('error')
            setDiscoverError(String((error && error.message) || error))
          }
        }
      }

      function applyManual() {
        const ids = manualText
          .split(/[\n,;]+/)
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
        if (ids.length === 0) return
        const unique = [...new Set(ids)]
        setModels(unique.map((id) => ({ id, name: id })))
        setSelection(Object.fromEntries(unique.map((id) => [id, true])))
        setDiscoverState('ready')
        setDiscoverError('')
        setManualOpen(false)
      }

      async function handleSave() {
        if (saving) return
        setSaveError('')
        if (selectedCount === 0) { setSaveError(t('needSelection')); return }
        if (!idValid) { setSaveError(t('idInvalid')); return }
        setSaving(true)
        try {
          const keyRef = deriveKeyRef(routeId)
          const credential = await ctx.remote.credentials.set(keyRef, apiKey.trim())
          if (!credential || credential.ok !== true) {
            setSaveError(fmt(t('credentialFailed'), {
              message: (credential && credential.error && credential.error.message) || t('unknownError'),
            }))
            return
          }

          const fallbackContext = Number.parseInt(contextWindow, 10)
          const fallbackMax = Number.parseInt(maxTokens, 10)
          const picked = selectedIds.map((id) => {
            const model = (models || []).find((entry) => entry.id === id) || { id, name: id }
            const entry = { id: model.id }
            if (model.name && model.name !== model.id) entry.name = model.name
            const window = model.contextWindow || fallbackContext
            if (Number.isFinite(window) && window > 0) entry.contextWindow = window
            const output = model.maxTokens || fallbackMax
            if (Number.isFinite(output) && output > 0) entry.maxTokens = output
            const input = (model.inputModalities || []).filter((kind) => kind === 'text' || kind === 'image')
            entry.input = input.length > 0 ? input : ['text']
            return entry
          })

          const ops = [
            { op: 'set', path: ['providers', routeId, 'displayName'], value: displayName.trim() || routeId },
            { op: 'set', path: ['providers', routeId, 'api'], value: plan.api },
            { op: 'set', path: ['providers', routeId, 'baseURL'], value: baseURL.trim() },
            { op: 'set', path: ['providers', routeId, 'apiKeyEnv'], value: keyRef },
            { op: 'set', path: ['providers', routeId, 'models'], value: picked },
          ]

          let written = false
          let lastError = ''
          for (let attempt = 0; attempt < 3 && !written; attempt += 1) {
            const described = await ctx.remote.settings.describe()
            if (!described || described.ok !== true) {
              lastError = (described && described.error && described.error.message) || t('unknownError')
              break
            }
            const view = ((described.value && described.value.namespaces) || [])
              .find((entry) => entry.ns === SETTINGS_NS)
            const res = await ctx.remote.settings.mutate(SETTINGS_NS, ops, view && view.revision)
            if (res && res.ok === true) { written = true; break }
            lastError = (res && res.error && res.error.message) || t('unknownError')
            if (!res || !res.error || res.error.code !== 'settings/conflict') break
            setSaveError(t('conflictRetry'))
          }

          if (!written) {
            setSaveError(fmt(t('saveFailed'), { message: lastError }))
            return
          }
          onSaved(displayName.trim() || routeId, selectedCount)
        } catch (error) {
          setSaveError(String((error && error.message) || error))
        } finally {
          setSaving(false)
        }
      }

      const canSave = writable && !saving && idValid && Boolean(baseURL.trim()) && selectedCount > 0
      const step = models === null && discoverState !== 'ready' ? 1 : 2

      const overlay = h('div', {
        className: 'dsh-mi-overlay',
        role: 'presentation',
        onMouseDown: (event) => {
          if (event.target === event.currentTarget && !saving) onClose()
        },
      },
      h('div', { className: 'dsh-mi-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('wizardTitle') },
        h('div', { className: 'dsh-mi-head' },
          h('div', { className: 'dsh-mi-title' }, t('wizardTitle')),
          h('div', { className: 'dsh-mi-steps' },
            h('span', { className: `dsh-mi-step${step === 1 ? ' is-on' : ''}` }, `1 · ${t('stepConnect')}`),
            h('span', { className: `dsh-mi-step${step === 2 ? ' is-on' : ''}` }, `2 · ${t('stepSelect')}`),
          ),
          h('button', {
            type: 'button', className: 'dsh-mi-close', 'aria-label': t('cancel'),
            disabled: saving, onClick: onClose,
          }, '×'),
        ),

        h('div', { className: 'dsh-mi-body', ref: bodyRef },
          describeError ? h('div', { className: 'dsh-mi-error' }, describeError) : null,
          writable ? null : h('div', { className: 'dsh-mi-error' }, t('readonly')),

          h('div', { className: 'dsh-mi-grid' },
            h(Field, { label: t('platform'), hint: t(platform.hintKey) },
              h('select', {
                className: 'dsh-mi-select', value: platform.id, 'data-field': 'platform',
                onChange: (event) => pickPlatform(event.target.value),
              }, PLATFORMS.map((entry) =>
                h('option', { key: entry.id, value: entry.id }, t(entry.labelKey)))),
            ),
            h(Field, { label: t('plan'), hint: t(plan.hintKey) },
              h('select', {
                className: 'dsh-mi-select', value: plan.id, 'data-field': 'plan',
                onChange: (event) => pickPlan(event.target.value),
              }, platform.plans.map((entry) =>
                h('option', { key: entry.id, value: entry.id }, t(entry.labelKey)))),
            ),
            plan.workspaceTemplate
              ? h(Field, { label: t('workspace'), hint: t('workspaceHint') },
                h('input', {
                  className: 'dsh-mi-input', value: workspace, spellCheck: false,
                  'data-field': 'workspace', placeholder: t('workspacePlaceholder'),
                  onChange: (event) => pickWorkspace(event.target.value),
                }),
              )
              : null,
            h(Field, { label: t('baseURL'), hint: t('baseURLHint'), wide: true },
              h('input', {
                className: 'dsh-mi-input', value: baseURL, spellCheck: false,
                'data-field': 'baseURL',
                onChange: (event) => setBaseURL(event.target.value),
              }),
            ),
            h('div', { className: 'dsh-mi-field is-wide' },
              h('div', { className: 'dsh-mi-labelrow' },
                h('span', { className: 'dsh-mi-label' }, t('apiKey')),
                h('a', {
                  className: 'dsh-mi-link', href: plan.keyURL, target: '_blank', rel: 'noreferrer noopener',
                  'data-field': 'keyLink',
                }, `${t('getKey')} ↗`),
              ),
              h('input', {
                className: 'dsh-mi-input', type: 'password', value: apiKey, autoComplete: 'off',
                'data-field': 'apiKey',
                placeholder: t('apiKeyPlaceholder'), spellCheck: false,
                onChange: (event) => setApiKey(event.target.value),
              }),
              h('span', { className: 'dsh-mi-hint' }, `${t(plan.keyHintKey)} ${t('apiKeyHint')}`),
            ),
            h(Field, { label: t('providerId'), hint: t('providerIdHint') },
              h('input', {
                className: 'dsh-mi-input', value: routeId, spellCheck: false,
                'data-field': 'routeId',
                onChange: (event) => { setRouteTouched(true); setRouteId(event.target.value.trim()) },
              }),
            ),
            h(Field, { label: t('displayName') },
              h('input', {
                className: 'dsh-mi-input', value: displayName, 'data-field': 'displayName',
                onChange: (event) => { setNameTouched(true); setDisplayName(event.target.value) },
              }),
            ),
          ),

          routeId.length > 0 && !idValid
            ? h('div', { className: 'dsh-mi-warn' }, t('idInvalid'))
            : null,
          idTaken ? h('div', { className: 'dsh-mi-warn' }, fmt(t('overwriteWarn'), { id: routeId })) : null,

          h('div', { className: 'dsh-mi-row' },
            h('button', {
              type: 'button', className: 'dsh-mi-btn dsh-mi-btn-ghost',
              disabled: discoverState === 'loading' || !apiKey.trim(),
              onClick: handleDiscover,
            }, discoverState === 'loading' ? t('loadingModels') : t('loadModels')),
            h('button', {
              type: 'button', className: 'dsh-mi-btn dsh-mi-btn-ghost',
              onClick: () => setAdvancedOpen((open) => !open),
            }, `${t('advanced')}${advancedOpen ? ' ▾' : ' ▸'}`),
          ),

          advancedOpen
            ? h('div', { className: 'dsh-mi-grid' },
              h(Field, { label: t('contextWindow'), hint: t('advancedHint') },
                h('input', {
                  className: 'dsh-mi-input', value: contextWindow, inputMode: 'numeric',
                  onChange: (event) => setContextWindow(event.target.value.replace(/[^0-9]/g, '')),
                }),
              ),
              h(Field, { label: t('maxTokens') },
                h('input', {
                  className: 'dsh-mi-input', value: maxTokens, inputMode: 'numeric',
                  onChange: (event) => setMaxTokens(event.target.value.replace(/[^0-9]/g, '')),
                }),
              ),
            )
            : null,

          discoverError
            ? h('div', { className: 'dsh-mi-error' }, discoverError)
            : null,
          discoverNotice
            ? h('div', { className: 'dsh-mi-warn' }, discoverNotice)
            : null,

          models !== null
            ? h('div', { className: 'dsh-mi-row' },
              h('span', { className: 'dsh-mi-label' }, t('modelsTitle')),
              h('span', { className: 'dsh-mi-hint' },
                fmt(t('selectedCount'), { n: selectedCount, m: models.length })),
              h('span', { className: 'dsh-mi-spacer' }),
              h('button', {
                type: 'button', className: 'dsh-mi-btn dsh-mi-btn-ghost',
                disabled: filtered.length === 0, onClick: selectAllShown,
              }, t('selectAll')),
              h('button', {
                type: 'button', className: 'dsh-mi-btn dsh-mi-btn-ghost',
                disabled: selectedCount === 0, onClick: clearSelection,
              }, t('clear')),
            )
            : null,

          models !== null
            ? h('div', { className: 'dsh-mi-toolbar' },
              h('input', {
                className: 'dsh-mi-input', value: query, placeholder: t('search'),
                onChange: (event) => setQuery(event.target.value),
              }),
              h('label', { className: 'dsh-mi-toggle' },
                h('input', {
                  type: 'checkbox', checked: onlyChat,
                  onChange: (event) => setOnlyChat(event.target.checked),
                }),
                t('filterChat'),
              ),
              filtered.length > visible.length
                ? h('span', { className: 'dsh-mi-hint' }, fmt(t('truncated'), { n: visible.length }))
                : null,
            )
            : null,

          models !== null
            ? h('div', { className: 'dsh-mi-models' },
              visible.length === 0
                ? h('div', { className: 'dsh-mi-hint' }, t('emptyFilter'))
                : visible.map((model) => h(ModelRow, {
                  key: model.id,
                  model,
                  checked: Boolean(selection[model.id]),
                  onToggle: toggle,
                })),
            )
            : null,

          h('div', { className: 'dsh-mi-row' },
            h('button', {
              type: 'button', className: 'dsh-mi-btn dsh-mi-btn-ghost',
              onClick: () => setManualOpen((open) => !open),
            }, t('manual')),
          ),

          manualOpen
            ? h('div', { className: 'dsh-mi-field is-wide' },
              h('span', { className: 'dsh-mi-hint' }, t('manualHint')),
              h('textarea', {
                className: 'dsh-mi-textarea', value: manualText, spellCheck: false,
                onChange: (event) => setManualText(event.target.value),
              }),
              h('div', { className: 'dsh-mi-row is-end' },
                h('button', {
                  type: 'button', className: 'dsh-mi-btn dsh-mi-btn-ghost',
                  disabled: !manualText.trim(), onClick: applyManual,
                }, t('manualApply')),
              ),
            )
            : null,
        ),

        h('div', { className: 'dsh-mi-foot' },
          h('div', { className: 'dsh-mi-foot-note' },
            saveError ? h('span', { className: 'dsh-mi-error' }, saveError) : '',
          ),
          h('button', {
            type: 'button', className: 'dsh-mi-btn dsh-mi-btn-ghost',
            disabled: saving, onClick: onClose,
          }, t('cancel')),
          h('button', {
            type: 'button', className: 'dsh-mi-btn dsh-mi-btn-primary',
            disabled: !canSave, onClick: handleSave,
          }, saving ? t('saving') : t('save')),
        ),
      ))

      const portalHost = typeof document === 'undefined' ? null : document.body
      return createPortal && portalHost ? createPortal(overlay, portalHost) : overlay
    }

    /** The card that owns the Models page footer seat. */
    function ModelImporter(props) {
      const { ctx } = props
      const t = useTranslate(ctx)
      const [wizardOpen, setWizardOpen] = useState(false)
      const [flash, setFlash] = useState('')

      return h(React.Fragment, null,
        h('style', { key: 'style', dangerouslySetInnerHTML: { __html: CSS } }),
        h('section', { key: 'card', className: 'dsh-mi-card' },
          h('div', { className: 'dsh-mi-card-main' },
            h('div', { className: 'dsh-mi-card-title' }, t('cardTitle')),
            h('div', { className: 'dsh-mi-card-desc' }, t('cardDesc')),
            flash ? h('div', { className: 'dsh-mi-flash' }, flash) : null,
          ),
          h('button', {
            type: 'button', className: 'dsh-mi-btn dsh-mi-btn-primary',
            onClick: () => { setFlash(''); setWizardOpen(true) },
          }, t('open')),
        ),
        wizardOpen
          ? h(Wizard, {
            key: 'wizard',
            ctx,
            t,
            onClose: () => setWizardOpen(false),
            onSaved: (name, count) => {
              setWizardOpen(false)
              setFlash(fmt(t('saved'), { n: count, name }))
            },
          })
          : null,
      )
    }

    return {
      inject: ['slots', 'locale', 'remote', 'remote.settings', 'remote.credentials', 'remote.llm'],
      apply(ctx) {
        ctx.effect(() => {
          const offZh = ctx.locale.register(NS, 'zh', ZH)
          const offEn = ctx.locale.register(NS, 'en', EN)
          return () => { offZh(); offEn() }
        }, 'dsh-model-importer: dictionaries')

        ctx.slots.inject(SLOT, () => ctx.slots.register({
          name: SLOT,
          id: ENTRY_ID,
          order: 20,
        }, () => h(ModelImporter, { ctx })))
      },
    }
  },
})
