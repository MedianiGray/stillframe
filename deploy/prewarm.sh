#!/usr/bin/env sh
# 实训室预热：等健康检查 → 拉首页/浮窗页/语言包/实际构建资源 → 连跑多轮并给出首轮与预热后延迟。
# 用法：sh deploy/prewarm.sh http://192.168.1.20:8080 3
set -eu

URL="${1:-http://127.0.0.1:8080}"
ROUNDS="${2:-3}"
URL="${URL%/}"

echo "预热目标：$URL"

i=0
until curl -fsS --max-time 3 "$URL/healthz" >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -gt 60 ]; then
    echo "健康检查超时：先 docker compose -f deploy/docker-compose.yml up -d" >&2
    exit 1
  fi
  sleep 1
done

ASSETS=$(curl -fsS "$URL/" | grep -oE '(src|href)="[^"]+/assets/[^"]+"' | sed -E 's/^(src|href)="//; s/"$//' | sed 's#^\./##' | sort -u)

TARGETS="$URL/ $URL/quick.html $URL/tessdata/eng.traineddata.gz $URL/tessdata/chi_sim.traineddata.gz"
for asset in $ASSETS; do
  case "$asset" in
    http*) TARGETS="$TARGETS $asset" ;;
    *) TARGETS="$TARGETS $URL/${asset#/}" ;;
  esac
done

round=1
while [ "$round" -le "$ROUNDS" ]; do
  for target in $TARGETS; do
    start=$(date +%s%N 2>/dev/null || date +%s)
    case "$target" in
      */tessdata/*)
        code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 -H 'Range: bytes=0-1023' "$target" || echo 000)
        ;;
      *)
        code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$target" || echo 000)
        ;;
    esac
    end=$(date +%s%N 2>/dev/null || date +%s)
    if [ "${#start}" -gt 10 ]; then
      ms=$(( (end - start) / 1000000 ))
    else
      ms=$(( (end - start) * 1000 ))
    fi
    printf '第%s轮  %-4s  %5sms  %s\n' "$round" "$code" "$ms" "${target#"$URL"}"
  done
  round=$((round + 1))
done

echo "完成：容器已热，学生端首次打开不必再等镜像和语言包冷读。"
