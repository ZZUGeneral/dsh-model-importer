# 分享与发布

三种由轻到重的分享方式，按对方的使用习惯挑一种。

## 一、直接发 tarball（最快，不用账号）

```sh
npm pack          # 在插件目录执行，得到 dsh-model-importer-<version>.tgz
```

对方安装：

- GUI：设置 → 插件 → 安装本地插件，选中这个 `.tgz`
- 命令行：`dsh plugin --profile <profile> add ./dsh-model-importer-0.2.3.tgz`
- Agent：`plugin_manager({ action: "install_bundle", target: "<绝对路径>.tgz" })`

装完刷新页面（⌘R）即可。包内只有 9 个文件、约 17 KB，无构建步骤、无运行时依赖。

## 二、发到 npm（别人一行命令装）

```sh
npm login                     # 需要 npm 账号
npm publish --access public   # 名字 dsh-model-importer 目前未被占用
```

发布后：

```sh
dsh plugin --profile <profile> add dsh-model-importer
```

发布前自查：

- `npm pack --dry-run` 确认只打 `files` 白名单里的文件（当前 9 个）。
- 版本号遵循 semver；`0.x` 阶段每次行为变更都 +0.0.1。
- `package.json` 的 `dsh` 字段是宿主识别插件的唯一依据：`bundle.patch` 指向 `cordis.patch.yml`，`client.platform` 为 `web`，`client.inject` 列出运行时依赖的客户端包。

## 三、收录进插件市场（可被搜索到）

DSH 的插件市场读的是外部策展目录（插件市场插件里 `registry` 数据源，条目形如 `plugins.json`），每个条目至少要有：

| 字段 | 含义 |
| --- | --- |
| `name` | 展示名，通常与包名一致 |
| `npm` | npm 包名，市场据此定位安装源 |
| `category` | 分类（可多个） |
| `description` | 一句话说明 |

提交流程：先把包发到 npm（第二步），再向该目录的仓库提 PR 增加条目。市场端安装走的是 npm，所以「npm 上装得下来」是收录的硬前提。仓库地址与 PR 模板以 `dshmarket` 插件 README 里标注的 `awesome-dsh-plugin` 项目为准。

## 四、从源码分发

推 GitHub 后，对方可以直接：

```sh
dsh plugin --profile <profile> add github:<owner>/<repo>
```

这种装法 pnpm 会询问是否执行包的构建脚本；本项目没有构建脚本，一路默认即可。

## 发布检查清单

- [ ] `node --check client.js index.js` 通过
- [ ] `locale/zh.json`、`locale/en.json` 键集一致（脚本已校验）
- [ ] 无 `console.log` 残留；颜色只用 `--dsw-alias-*` 主题变量
- [ ] `README.md` 的安装段与本文不冲突
- [ ] `npm pack --dry-run` 文件清单正确
- [ ] 装上后刷新页面，卡片出现在 设置 → 模型 底部
