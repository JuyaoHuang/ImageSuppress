# image-suppress

本项目提供两个本地脚本，用于批量压缩博客仓库中的图片，并在确认无误后用压缩结果覆盖原图、同步修改 Markdown 引用。

## 目录说明

- [scripts/compress-images.mjs](/D:/Coding/GitHub_Resuorse/image-suppress/scripts/compress-images.mjs)
  递归压缩图片，在每个图片所在目录生成 `imgs_outputs/`
- [scripts/publish-compressed-images.mjs](/D:/Coding/GitHub_Resuorse/image-suppress/scripts/publish-compressed-images.mjs)
  使用 `imgs_outputs/` 中的压缩结果覆盖原图，并更新 Markdown 引用

## 前置条件

- 已安装 `Node.js`
- 图片源仓库如果使用了 `Git LFS`，必须先把真实图片拉到本地

如果你的文章仓库是 `D:\Coding\Wrote_Codes\blogs`，先执行：

```bash
cd D:\Coding\Wrote_Codes\blogs
git lfs pull
```

否则脚本看到的会只是 LFS pointer 文本，而不是真实图片。

## 脚本 1：压缩图片

### 作用

- 递归扫描指定根目录
- 处理 `.jpg`、`.jpeg`、`.png`
- 输出固定为 `mozJPEG`
- 在每个图片所在目录生成 `imgs_outputs/`
- `jpg/jpeg` 保持原文件名
- `png` 会输出为同名 `.jpg`

例如：

- 原图：`...\session-1-计算机系统\1.png`
- 压缩结果：`...\session-1-计算机系统\imgs_outputs\1.jpg`

### 用法

最常用：

```bash
node scripts/compress-images.mjs "D:\Coding\Wrote_Codes\blogs\Acknowledge"
```

带参数：

```bash
node scripts/compress-images.mjs "D:\Coding\Wrote_Codes\blogs\Acknowledge" --quality 75 --input-ext .jpg,.jpeg,.png
```

### 参数

- `--quality`
  JPEG 压缩质量，范围 `1-100`，默认 `75`
- `--input-ext`
  允许处理的输入扩展名，逗号分隔，默认 `.jpg,.jpeg,.png`

### 行为说明

- 会跳过已有的 `imgs_outputs/` 目录，避免重复压缩
- `.png` 转 `JPEG` 时会用白底合成透明区域
- 不会直接覆盖原图，只会写入 `imgs_outputs/`

## 脚本 2：覆盖发布压缩结果

### 作用

- 递归查找指定根目录下所有 `imgs_outputs/`
- 将压缩后的图片提升回原图片目录
- 覆盖原有 `jpg/jpeg`
- 对原来的 `png`：
  删除原 `png`
  将压缩后的 `jpg` 放回同层目录
- 递归扫描根目录子树内所有 `.md/.mdx`
- 自动更新相对图片引用

支持的引用形式：

- Markdown 图片：
  `![2](./img_for_前端三件套/2.png)`
- HTML 图片：
  `<img src="./img_for_前端三件套/2.png" />`

例如，发布后会自动改成：

```md
![2](./img_for_前端三件套/2.jpg)
```

### 用法

```bash
node scripts/publish-compressed-images.mjs "D:\Coding\Wrote_Codes\blogs\Acknowledge"
```

### 行为说明

- 只处理传入根目录子树内的 Markdown 文件
- 不会跨仓库追踪引用
- 不会修改外链、绝对 URL、Windows 绝对路径图片链接
- 发布成功后，会删除空的 `imgs_outputs/` 目录

## 推荐工作流

先压缩，再检查，再发布：

```bash
cd D:\Coding\Wrote_Codes\blogs
git lfs pull

cd D:\Coding\GitHub_Resuorse\image-suppress
node scripts/compress-images.mjs "D:\Coding\Wrote_Codes\blogs\Acknowledge"
node scripts/publish-compressed-images.mjs "D:\Coding\Wrote_Codes\blogs\Acknowledge"
```

## 典型场景

### 场景 1：图片和文章在同一目录

原始结构：

```text
session-1-计算机系统/
  1.png
  2.jpg
  computer-system.md
```

压缩后：

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

并且 `computer-system.md` 中的：

```md
![1](1.png)
```

会被改成：

```md
![1](1.jpg)
```

### 场景 2：文章在父目录，图片在子目录

例如：

- 文章：
  `D:\Coding\Wrote_Codes\blogs\WebFullStack\Fronted\BaseKnows\FrontedLanguages.md`
- 图片目录：
  `D:\Coding\Wrote_Codes\blogs\WebFullStack\Fronted\BaseKnows\img_for_前端三件套`

原引用：

```md
![2](./img_for_前端三件套/2.png)
```

发布后会自动改成：

```md
![2](./img_for_前端三件套/2.jpg)
```

## 已知提示

运行时可能会看到类似下面的 Node 警告：

```text
[MODULE_TYPELESS_PACKAGE_JSON]
```

这是 `squoosh` 生成物的模块格式提示，不影响压缩和发布结果。
