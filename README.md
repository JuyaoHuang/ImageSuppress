# image-suppress

基于 [Squoosh](https://squoosh.app/) 编解码能力的本地图片批处理工具。

这个仓库不是浏览器端压缩服务，也不需要启动网页端口。它直接在本地调用 `squoosh/` 里的编解码模块，递归压缩目录中的图片，并在确认后把压缩结果发布回原目录。

## 项目特点

- 压缩过程在本地完成，不把图片上传到远端服务
- 不需要启动浏览器，也不需要封装 Web API
- 递归扫描目录，按图片所在目录生成 `imgs_outputs/`
- 输出固定为 `mozJPEG`
- 提供独立的“压缩”脚本和“覆盖发布”脚本
- 发布时可同步修正文档中的相对图片引用

## 脚本说明

- `scripts/compress-images.mjs`
  递归压缩图片，在每个图片所在目录下生成 `imgs_outputs/`
- `scripts/publish-compressed-images.mjs`
  将 `imgs_outputs/` 里的压缩结果覆盖发布回原目录，并更新 Markdown / HTML 图片引用

## 前置条件

- 已安装 `Node.js`
- 源图片仓库中的真实图片内容已经存在本地

如果源仓库使用了 `Git LFS`，必须先拉取真实对象。例如你的文章仓库是 `target_content`，先执行：

```bash
cd target_content
git lfs pull
```

否则脚本读到的只会是 Git LFS pointer 文本，而不是真实图片字节内容。

## 快速开始

```bash
cd D:\Coding\GitHub_Resuorse\image-suppress
node scripts/compress-images.mjs "target_content\Acknowledge" --quality 75
node scripts/publish-compressed-images.mjs "target_content\Acknowledge"
```

推荐流程是：

1. 先在文章仓库执行 `git lfs pull`
2. 运行压缩脚本生成 `imgs_outputs/`
3. 人工检查压缩结果
4. 运行覆盖发布脚本，把压缩图提升回原目录并更新引用
5. 在文章仓库中执行 `git status`、`git add`、`git commit`、`git push`

## 脚本 1：压缩图片

### 用法

最简调用：

```bash
node scripts/compress-images.mjs "target_content\Acknowledge"
```

显式指定质量和输入扩展名：

```bash
node scripts/compress-images.mjs "target_content\Acknowledge" --quality 75 --input-ext .jpg,.jpeg,.png
```

查看帮助：

```bash
node scripts/compress-images.mjs --help
```

### 参数

| 参数 | 说明 |
| --- | --- |
| `--quality` | 输出 `mozJPEG` 质量，范围 `1-100`，默认 `80` |
| `--input-ext` | 允许扫描的输入扩展名，逗号分隔，默认 `.jpg,.jpeg,.png` |

### 行为

- 递归扫描传入根目录
- 跳过已有的 `imgs_outputs/`，避免重复处理已输出内容
- 当前会按扩展名扫描 `.jpg`、`.jpeg`、`.png`
- 实际解码时会检查文件头，而不是只信任扩展名
- 对 JPEG 保持原文件名
- 对 PNG 输出同名 `.jpg`
- `.png` 转 `JPEG` 时，会把透明区域铺成白底
- 输出文件总是写入图片所在目录下的 `imgs_outputs/`
- 不直接覆盖原图

### 输出示例

原目录：

```text
session-1-计算机系统/
  1.png
  2.jpg
```

压缩后：

```text
session-1-计算机系统/
  1.png
  2.jpg
  imgs_outputs/
    1.jpg
    2.jpg
```

## 脚本 2：覆盖发布压缩结果

### 用法

```bash
node scripts/publish-compressed-images.mjs "target_content\Acknowledge"
```

### 行为

- 递归查找传入根目录下的所有 `imgs_outputs/`
- 将压缩结果移动回原图所在目录
- 对原有 `jpg/jpeg` 直接覆盖
- 对原有 `png` 删除原文件，并发布为同名 `.jpg`
- 递归扫描根目录子树内的 `.md` / `.mdx`
- 自动更新相对图片引用
- 自动更新 HTML `<img src="...">` 形式的本地引用
- 不修改外链、绝对 URL、Windows 绝对路径图片链接
- 发布完成后会删除已经清空的 `imgs_outputs/`

### 引用修正规则

支持的引用形式包括：

```md
![2](./img_for_前端三件套/2.png)
```

```html
<img src="./img_for_前端三件套/2.png" />
```

发布后会自动改成：

```md
![2](./img_for_前端三件套/2.jpg)
```

### 场景示例

场景 1：图片和文章在同一目录

```text
session-1-计算机系统/
  1.png
  2.jpg
  computer-system.md
  imgs_outputs/
    1.jpg
    2.jpg
```

发布后：

```text
session-1-计算机系统/
  1.jpg
  2.jpg
  computer-system.md
```

并且：

```md
![1](1.png)
```

会被改成：

```md
![1](1.jpg)
```

场景 2：文章在父目录，图片在子目录

- 文章：`target_content\WebFullStack\Fronted\BaseKnows\FrontedLanguages.md`
- 图片目录：`target_content\WebFullStack\Fronted\BaseKnows\img_for_前端三件套`

原引用：

```md
![2](./img_for_前端三件套/2.png)
```

发布后：

```md
![2](./img_for_前端三件套/2.jpg)
```

## 与 Squoosh 的关系

这个仓库的批处理能力建立在 `squoosh/` 子目录提供的编解码资源之上。

- Squoosh 原项目定位是图片压缩 Web App
- 本仓库没有把它改造成在线服务
- 当前脚本直接复用本地编解码模块做离线批处理
- 因此保留了 Squoosh “图片不上传到服务器”的核心优点

如果你需要单独开发或调试底层 Squoosh Web App，可进入 `squoosh/` 目录执行：

```bash
cd squoosh
npm install
npm run build
npm run dev
```

其中 `npm run dev` 会启动 Squoosh 自身的本地开发服务，但这不是运行本仓库两个批处理脚本的前置条件。

## 测试

```bash
node --test tests/*.test.mjs
```

## 已知提示

### `Git LFS pointer file detected`

说明当前文件只是 Git LFS 指针文本。先在源仓库执行：

```bash
git lfs pull
```

### `[MODULE_TYPELESS_PACKAGE_JSON]`

这是 `squoosh/` 某些生成模块的 Node 提示，不影响压缩和发布结果。

### `Unsupported image format ... BMP is not supported yet`

当前脚本支持读取 JPEG 和 PNG 内容，并输出 `mozJPEG`。如果目录里混有 BMP，需要先自行转换，或后续再扩展解码能力。
