# Schreibwerkstatt 手机版（iPhone）

电脑版 `schreibwerkstatt` 的手机版本。**不需要电脑开着**：整个程序（包括 Python 写的 `server.py`）直接在手机浏览器里运行，
模型还是用你自己的 Anthropic / DeepSeek / OpenAI 兼容接口。

## 它是怎么工作的

- 页面（`web/`）和电脑版一模一样。
- `server.py`、`llm.py`、`topics.py` 也一模一样，由 **Pyodide**（浏览器里的 Python，在 `docs/pyodide/`，约 13 MB）在手机上运行。
  页面原来发给 `server.py` 的请求（`/api/...`），在手机上交给后台线程里的这份 Python 处理。
- 练习记录（`german.db`）和设置（含 API Key）保存在手机浏览器的存储里，**和电脑上的记录是分开的两份**。
- 第一次打开要下载约 13 MB，之后所有文件都缓存在手机上，每次启动大约等 2–3 秒，没网也能打开（只是没网连不上模型）。

## 文件夹里有什么

| 路径 | 作用 |
|---|---|
| `docs/` | **要发布的网站**（GitHub Pages 从这里发布）。由 `build.py` 生成，不要手改（`docs/pyodide/` 除外，它不会被重新生成） |
| `mobile/` | 手机版自己的文件：`worker.js`（在后台运行 Python）、`boot.js`（启动画面、把 `/api` 请求转给 Python、备份按钮）、`mobile_glue.py`（连接 `server.py`）、`i18n_mobile.js`（把「server.py / run.bat」之类的提示换成手机上的说法）、`mobile.css`、图标、`sw.template.js`（离线缓存） |
| `build.py` | 从旁边的 `../schreibwerkstatt`（电脑版）重新生成 `docs/` |
| `tests/test_mobile.py` | 用 iPhone 尺寸的无头浏览器 + 假模型跑一遍完整流程 |

## 第一次发布（用你自己的 GitHub 账号，免费）

1. 在 GitHub 新建一个仓库，比如叫 `schreibwerkstatt`，选 **Public**（免费账号的 Pages 需要公开仓库；里面没有你的记录和 Key，只有程序）。
2. 把这个文件夹传上去，二选一：
   - **网页上传**：仓库页面点「uploading an existing file」，把 `docs` 文件夹（连同 `build.py`、`mobile`、`README.md`，可选）拖进去，点 Commit。
   - **git**（在这个文件夹里）：
     ```
     git init -b main
     git add .
     git commit -m "Schreibwerkstatt mobile"
     git remote add origin https://github.com/<你的用户名>/schreibwerkstatt.git
     git push -u origin main
     ```
3. 仓库 → **Settings → Pages** → Source 选「Deploy from a branch」，Branch 选 `main`，文件夹选 **`/docs`**，Save。
   大约一分钟后，网址是 `https://<你的用户名>.github.io/schreibwerkstatt/`。

## 装到 iPhone 上

1. 用 **Safari** 打开上面的网址，等启动画面消失。
2. 点底部的「分享」按钮 → **添加到主屏幕**。
3. **从主屏幕上的图标打开**，再点右上角的状态按钮设置模型：接口类型选 Anthropic，粘贴 API Key，模型从列表里选。
   - 注意：iOS 上「主屏幕 App」和「Safari 里的网页」是**两份分开的存储**，Key 和记录要在主屏幕 App 里设置。
   - Key 只保存在这台手机上，不会上传到 GitHub。

## 以后电脑版更新了怎么办

```
python build.py
```
然后把 `docs/` 再传一次（网页上传覆盖，或 `git add . && git commit -m update && git push`）。
手机上下次打开 App 时会在后台下载新文件，**再下一次打开**就是新版本。

## 备份和导入

设置窗口最下面有「导出备份 / 导入备份」：

- **导出**：把手机上的 `german.db` 存到「文件」App（或发给自己）。建议偶尔导出一次。
- **导入**：选一个备份文件，替换手机上的全部记录（原来的会先自动备份在手机里）。也可以把电脑上的 `data/german.db`（通过 iCloud Drive / AirDrop）导入手机，一次性把电脑的记录搬过来。

## 测试

```
pip install playwright
python -m playwright install chromium
python tests/test_mobile.py
```
测试用电脑版 `../schreibwerkstatt/tests/fake_llm.py` 里的假模型，不花钱。

## 已知限制

- 手机上没有 Ollama（手机跑不了本地大模型）。
- DeepSeek 是否允许网页直接调用还没在真机上确认过；如果连不上，设置里会显示网络错误，用 Anthropic 不受影响。
- 不要在同一个浏览器里同时开两个窗口练习（比如两个 Safari 标签页）：各自只认启动时的记录，后保存的会覆盖先保存的。主屏幕 App 和 Safari 标签页的存储本来就是分开的，互不影响。
