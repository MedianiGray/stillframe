# 实训室部署：容器化网页版 + 预热

这个目录不是演示用的占位配置，镜像就是本仓库的 `dist`：学生在实训室打开的是同一套 Stillframe 网页端（截图、长图、取字、译屏），语言包随镜像发到本地，取字不再依赖外网。

> 桌面壳（`desktop/`）不走这条链路，它是单独装到教师机/学生机上的本地程序，负责系统级截屏、全局热键、置顶贴图与快捷浮窗。

## 一条命令起、一条命令停

```bash
# 仓库根目录
docker compose -f deploy/docker-compose.yml up -d --build

# 平时不用就停掉，不占内存；第二天实训前再起 + 预热
docker compose -f deploy/docker-compose.yml stop
docker compose -f deploy/docker-compose.yml start
```

访问 `http://<服务器IP>:8080`。容器名 `stillframe-web`，健康检查是 `/healthz`，失败会被编排层重建。

## 预热（压冷启动的关键一步）

```powershell
# Windows 教师机（实测口径：首轮 vs 第三轮的毫秒数）
powershell -ExecutionPolicy Bypass -File deploy\prewarm.ps1 http://127.0.0.1:8080 3
```

```sh
# Linux / PVE 里的容器
sh deploy/prewarm.sh http://192.168.1.20:8080 3
```

脚本做三件事：等 `/healthz` 通过 → 从首页解析出真实的 `/assets/*.js|css` → 连跑三轮首页、`quick.html`、`chi_sim/eng` 语言包。第一轮把文件读进 nginx/内核页缓存，第二、三轮就是学生实际会遇到的延迟。

## 冷启动的三档策略（对应“不浪费资源”）

| 档位 | 做法 | 代价 | 适用 |
| --- | --- | --- | --- |
| 常驻热实例 | `restart: unless-stopped`，容器一直在 | 约 20–40 MB 内存 | 实训周、白天连续上课 |
| 温实例 | 平时 `stop`，课前 `start` + 预热脚本 | 启动 1–3 秒 + 预热 2 秒 | 一周只有几次实训 |
| 冷实例 | 完全 `down`，用时 `up` | 首次拉镜像/建容器数十秒 | 只在演示或验收时开 |

镜像和语言包都在本地 Docker 里，`down` 后再 `up` 不会重新下载，这才是“冷启动可接受”的前提。

## PVE 上的落位

- 单独开一个 2C / 2G 的 Debian 或 Ubuntu **LXC/VM** 跑 Docker，不要和教学用 Windows 虚拟机挤在同一台宿主的内存；
- 给这个容器配 `bridge` 网络与固定 IP，学生机只需记住一个内网地址；
- 升级流程：`up -d --build` → 跑一次预热 → 让学生刷新页面（首页已设 `no-cache`，会立刻拿到新版本）；
- 日志统一走 `docker logs stillframe-web`（compose 已限制 `10m × 3`，不会把 PVE 磁盘写满）；要集中采集再接 Loki/Filebeat。

## 为什么不是长期开虚拟机

老做法的痛点是闲置空耗与版本漂移；这里把「环境」固化成镜像（版本一致、可复制），把「常驻」变成可停可起（不浪费），把「第一次慢」用预热压掉。K8s 对 20–40 台机的实训室属于过度设计，Compose 足够；真要按需伸缩再加一层反向代理和副本即可。

## 当前验证状态（如实说明）

- `npm run build` 与 23 条单测通过，`dist`、`quick.html` 由本仓库真实产出；
- `Dockerfile` / `compose` / 预热脚本已按 Compose v2 与 nginx 官方镜像写法落地，但**本机没有安装 Docker，镜像构建与容器健康检查未在真机跑过**；
- 预热脚本的 HTTP 逻辑可用任意静态服务器验证（例如 `npm run preview -- --port 8080` 后执行 `prewarm.ps1 http://127.0.0.1:8080`，语言包两项会 404，这是预期的，因为语言包由 Dockerfile 注入）。
