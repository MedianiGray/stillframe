# 实训室镜像：把 Stillframe 网页端打成 nginx 静态站，语言包一并内置。
# 构建上下文是仓库根目录：docker build -f deploy/Dockerfile .

ARG NODE_IMAGE=node:22-alpine
ARG NGINX_IMAGE=nginx:1.27-alpine

FROM ${NODE_IMAGE} AS build
WORKDIR /app
# 内网/国内构建时换镜像源，避免 npm 卡住；可在 compose 里用 build.args 覆盖。
ARG NPM_REGISTRY=https://registry.npmmirror.com
COPY package.json package-lock.json ./
RUN npm ci --registry=${NPM_REGISTRY} --no-audit --no-fund
COPY . .
RUN npm run build

FROM ${NGINX_IMAGE}
ARG TESSDATA_BASE=https://tessdata.projectnaptha.com/4.0.0_fast
ARG TESS_LANGS="chi_sim eng"
RUN apk add --no-cache curl \
 && mkdir -p /usr/share/nginx/html/tessdata \
 && for lang in ${TESS_LANGS}; do \
      curl -fsSL --retry 3 --connect-timeout 10 \
        "${TESSDATA_BASE}/${lang}.traineddata.gz" \
        -o "/usr/share/nginx/html/tessdata/${lang}.traineddata.gz" \
        || echo "warn: ${lang} 语言包没下载成功，取字会回落到在线源"; \
    done

COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

# 容器退出时把连接收干净，避免学生端请求被硬断。
STOPSIGNAL SIGQUIT
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1

EXPOSE 80
