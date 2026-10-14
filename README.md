# 尾迹：临界航线

一款纯前端 2D 生存网页游戏。操控飞机诱导追踪导弹彼此相撞，在无限网格空域中尽可能生存并获得高分。

## 直接运行

这是纯静态网页，不需要安装依赖。双击 `index.html` 即可尝试；如果浏览器限制本地音频，建议在此目录启动静态服务器：

```powershell
python -m http.server 8000
```

然后打开 `http://127.0.0.1:8000/`。

## 文件结构

```text
.
├── index.html          # 页面入口
├── style.css           # 界面样式
├── game.js             # 游戏逻辑
├── audio/              # 背景音乐与全部音效
└── tools/
    └── package-toy.ps1 # 生成 B 站 Toy 上传包
```

## B 站 Toy 打包

在项目目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\package-toy.ps1
```

生成的 `release/尾迹-临界航线-B站Toy.zip` 可以直接上传。ZIP 根目录包含 `index.html`，所有资源均使用相对路径。

## GitHub Pages

仓库根目录就是可发布的网站目录。GitHub Pages 使用 `main` 分支根目录即可。

