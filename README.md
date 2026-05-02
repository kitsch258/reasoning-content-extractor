# 推理内容提取器

推理内容提取器是一个 SillyTavern 前端扩展。它用于解决某些模型或中转服务把真正回复内容放进“原生推理块”，导致 SillyTavern 正文为空的问题。

扩展会从消息的 `message.extra.reasoning` 中查找指定标签或正则匹配内容，并自动写回可见正文。默认提取 `<content>...</content>`。

## 适用场景

当你的模型输出类似下面这种结果时，本扩展会很有用：

```html
<content>
角色真正要说的话在这里。
</content>
```

但 SillyTavern 里可见正文为空，内容只出现在推理块中。

安装本扩展后，它可以自动把 `<content>...</content>` 提取到正文，让消息正常显示、保存、翻译、TTS 或被其他扩展处理。

## 功能特点

- 自动处理新生成的 AI 消息。
- 在 MVU 额外解析模式下，可在推理流结束时提前修复消息，尽量缩短正文为空的时间窗口。
- 支持手动编辑推理块后自动提取。
- 支持切换 swipe 时自动修复当前候选。
- 默认只修复空正文消息，避免覆盖正常回复。
- 默认保留外层 `<content>...</content>` 标签。
- 可选只提取标签内部文本。
- 可选从推理块中移除已提取片段，避免上下文重复。
- 支持自定义一个或多个标签名，例如 `context`、`response`、`final`。
- 支持自定义正则表达式。
- 提供“修复最新消息”和“修复当前聊天”的手动按钮。

## 安装

### 方法一：通过 SillyTavern 扩展安装器

1. 打开 SillyTavern。
2. 进入扩展管理页面。
3. 选择从 GitHub 仓库安装扩展。
4. 填入本仓库地址。
5. 安装完成后刷新 SillyTavern 页面。
6. 在扩展设置中找到“推理内容提取器”。

### 方法二：手动安装

将本仓库文件夹放入 SillyTavern 的第三方扩展目录：

```text
SillyTavern/public/scripts/extensions/third-party/reasoning-content-extractor
```

然后刷新 SillyTavern 页面。

## 快速开始

默认设置保持兼容模式，仍然提取 `<content>...</content>`。

只要 AI 消息满足以下条件，扩展就会自动修复：

- 消息来自 AI，不是用户消息或系统消息。
- 可见正文为空、空白，或只有 `...`。
- 推理块中存在完整且非空的已配置标签，例如 `<content>...</content>`。

默认修复前：

```text
正文：空

推理块：
<content>
这是应该显示出来的正文。
还可以包含后续段落。
</content>
```

默认修复后：

```html
<content>
这是应该显示出来的正文。
还可以包含后续段落。
</content>
```

如果你需要提取 `</think>` 或 `</thinking>` 后的全部内容，请在设置中切换到“自定义正则”模式，并填写：

```regex
<\/(?:think|thinking)>\s*([\s\S]*?)$
```

正则标志填写：

```text
i
```

## 设置说明

### 启用

总开关。关闭后扩展不会自动修复，也不会响应手动修复按钮。

### 仅修复可见正文为空的消息

默认开启。

开启时，扩展只处理正文为空、空白或 `...` 的消息。这是最安全的模式，可以避免覆盖模型已经正常输出的正文。

关闭后，只要推理块中匹配到内容，扩展就会写入正文。这适合模型输出格式非常稳定、你明确希望强制覆盖正文的场景。

### 从推理块中移除已提取片段

默认开启。

开启后，扩展会在写入正文后，从 `message.extra.reasoning` 中删除匹配到的 `<content>...</content>` 片段。

这样可以避免同一段内容既存在于正文，又存在于推理块，并在后续上下文中重复出现。

### 提取到正文时保留外层标签

默认开启。

开启时，正文会保留完整标签：

```html
<content>这是正文。</content>
```

关闭时，正文只保留标签内部内容：

```text
这是正文。
```

### MVU 额外解析模式下提前修复

当检测到已安装 TavernHelper 且 MVU 设置中的“更新方式”不是“随AI输出”时，扩展会认为当前处于 MVU 额外解析模式。

在这个模式下，扩展会在 SillyTavern 的推理流结束后，对对应消息提前执行一次提取修复，让 MVU 额外解析读取楼层时更可能拿到真实正文。

这是一层针对 MVU 额外解析的兼容机制，不会替代原有的消息接收、渲染完成、消息更新等兜底修复逻辑。

### 修复后发送 MESSAGE_UPDATED 事件

默认开启。

开启后，扩展修复消息后会通知 SillyTavern 和其他扩展该消息已更新。

### 提取模式

#### 标签名

默认模式。可以填写一个或多个标签名。

默认标签名：

```text
content
```

这会匹配：

```html
<content>...</content>
```

如果你把标签名改成 `context`，则会匹配：

```html
<context>...</context>
```

如果需要同时提取多个标签，可以用逗号或换行分隔：

```text
content, context, response
```

或：

```text
content
context
response
```

扩展会按这些标签在推理块中的出现顺序全部提取，并用空行合并到正文中。

#### 自定义正则

适合需要更复杂匹配规则的用户，例如提取 `</think>` 或 `</thinking>` 后的全部内容。

推荐正则：

```regex
<\/(?:think|thinking)>\s*([\s\S]*?)$
```

这条正则会匹配 `</think>` 或 `</thinking>` 之后的全部内容，并优先使用第一个捕获组作为提取结果。

扩展会优先使用第一个捕获组作为提取内容。如果没有捕获组，则使用完整匹配。

如果正则标志中包含 `g`，扩展会提取所有匹配项；否则只提取第一个匹配项。

## 手动修复

扩展面板中提供两个按钮：

- `修复最新消息`：从最后一条消息开始，找到第一条可修复消息并修复。
- `修复当前聊天`：扫描当前聊天内所有可修复消息。

如果你先前已经生成了一批正文为空的消息，可以使用“修复当前聊天”进行批量处理。

## 示例

### 示例一：默认 `<content>` 标签

推理块：

```html
<content>她轻轻抬眼，声音低了下来：“我知道你会回来。”</content>
```

默认提取到正文：

```html
<content>她轻轻抬眼，声音低了下来：“我知道你会回来。”</content>
```

### 示例二：改用 `<context>` 标签

在设置中将“标签名”改为：

```text
context
```

推理块：

```html
<context>
这是应该显示的正文。
</context>
```

扩展会提取该块。

### 示例三：只保留内部文本

关闭“提取到正文时保留外层标签”。

推理块：

```html
<content>这是正文。</content>
```

提取到正文：

```text
这是正文。
```

### 示例四：同时提取多个标签

在设置中将“标签名”填写为：

```text
content, context
```

推理块：

```html
分析内容……

<context>这是上下文补充。</context>
<content>这是应该显示的正文。</content>
```

默认提取到正文：

```html
<context>这是上下文补充。</context>

<content>这是应该显示的正文。</content>
```

## 常见问题

### 为什么我编辑推理块后没有立刻提取？

请确认你使用的是最新版本。本扩展会监听 SillyTavern 的 `MESSAGE_REASONING_EDITED` 事件，保存推理块编辑后会自动尝试修复。

### 为什么没有覆盖已有正文？

默认开启了“仅修复可见正文为空的消息”。这是为了避免误覆盖正常回复。

如果你确实希望无论正文是否为空都提取并覆盖，请关闭该选项。

### 为什么提取后正文里还有 `<content>` 标签？

这是默认行为。扩展默认保留外层标签。

如果你只想保留标签内部文本，请关闭“提取到正文时保留外层标签”。

### 为什么推理块里的 `<content>` 被删除了？

默认开启了“从推理块中移除已提取片段”。这样可以避免内容重复进入后续上下文。

如果你希望推理块保持原样，请关闭该选项。

### 这个扩展会修改 SillyTavern 核心文件吗？

不会。它是独立前端扩展，不修改 SillyTavern 核心代码。

## 兼容性

扩展依赖 SillyTavern 前端扩展 API，并使用以下事件：

- `STREAM_REASONING_DONE`
- `MESSAGE_RECEIVED`
- `CHARACTER_MESSAGE_RENDERED`
- `MESSAGE_SWIPED`
- `MESSAGE_REASONING_EDITED`
- `MESSAGE_UPDATED`

SillyTavern 当前没有 `CHAT_UPDATED` 事件，因此扩展使用语义最接近、也被其他扩展监听的 `MESSAGE_UPDATED`。

## 更新

如果你通过 GitHub 安装，可以在 SillyTavern 扩展管理中更新。

如果你手动安装，请下载最新版本并覆盖原文件夹。

## 文件结构

```text
.gitignore
LICENSE
manifest.json
index.js
index.html
style.css
README.md
```

## 反馈

如果你遇到以下问题，建议在反馈时附上：

- SillyTavern 版本。
- 使用的模型或中转服务。
- 推理块中的示例内容。
- 扩展设置截图或文字描述。
- 浏览器控制台是否有报错。

## 许可证

本项目使用 GNU Affero General Public License v3.0 only 发布，详见 [LICENSE](LICENSE)。

SPDX 标识：`AGPL-3.0-only`

SillyTavern 本体遵循其自身许可证。本扩展是独立前端扩展，不修改 SillyTavern 核心文件。
