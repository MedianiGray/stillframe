import { useState } from 'react';
import { FolderOpen, Save, Trash2 } from 'lucide-react';
import type { Settings, TranslateProvider } from '../lib/settings';
import { autosaveSupported, chooseDirectory, clearDirectory, currentDirectoryName } from '../lib/autosave';
import { isDesktop } from '../lib/desktop';
import { useToast } from './Toasts';

interface SettingsViewProps {
  settings: Settings;
  onSave: (next: Settings) => void;
}

const PROVIDERS: Array<{ id: TranslateProvider; label: string; hint: string }> = [
  { id: 'none', label: '不启用', hint: '只取字，不翻译' },
  { id: 'openai', label: 'OpenAI 兼容', hint: '填 base 地址与 Key，例如中转站或本地 vLLM' },
  { id: 'deepl', label: 'DeepL', hint: '填 DeepL Key，免费版地址自动使用' },
  { id: 'libre', label: 'LibreTranslate', hint: '填自建实例地址，如 http://127.0.0.1:5000' },
];

export function SettingsView({ settings, onSave }: SettingsViewProps) {
  const toast = useToast();
  const [draft, setDraft] = useState<Settings>(settings);
  const [dirName, setDirName] = useState<string | null>(currentDirectoryName());

  const patch = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const pickDirectory = async () => {
    try {
      const name = await chooseDirectory();
      setDirName(name);
      toast(`已授权目录「${name}」，导出时会自动写入`, 'ok');
    } catch (error) {
      toast(error instanceof Error ? error.message : '目录授权失败', 'warn');
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
      <div className="mx-auto max-w-[760px] space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-[17px] font-semibold text-paper">设置</h2>
            <p className="mt-1 text-[12px] text-muted">这些配置只存在这台机器上，不随账号同步。</p>
          </div>
          <button
            type="button"
            className="btn btn-accent"
            onClick={() => {
              onSave(draft);
              toast('设置已保存', 'ok');
            }}
          >
            <Save size={14} /> 保存
          </button>
        </div>

        <section className="panel p-4">
          <span className="label">文字识别</span>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-[11px] text-muted">识别语言</span>
              <select className="field mt-1" value={draft.ocrLang} onChange={(event) => patch('ocrLang', event.target.value)}>
                <option value="chi_sim+eng">中文 + 英文</option>
                <option value="eng">仅英文</option>
                <option value="chi_sim">仅中文</option>
                <option value="jpn">日文</option>
                <option value="kor">韩文</option>
              </select>
            </label>
            <label className="block">
              <span className="text-[11px] text-muted">语言包地址</span>
              <input
                className="field mt-1"
                value={draft.tessdataPath}
                onChange={(event) => patch('tessdataPath', event.target.value)}
                placeholder="留空则用站点自带的 ./tessdata"
              />
            </label>
          </div>
          <p className="mt-2 text-[11px] leading-5 text-muted">
            留空时用随站点分发的语言包，离线与内网都可用；填地址则优先用该 mirror（探测不通会自动退回内置包）。首次识别会把语言包缓存在本地，之后不再下载。
          </p>
        </section>

        <section className="panel p-4">
          <span className="label">翻译接口</span>
          <div className="mt-3 grid gap-2 sm:grid-cols-4">
            {PROVIDERS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`border px-2.5 py-2 text-left text-[12px] transition-colors ${
                  draft.translateProvider === item.id
                    ? 'border-amber/70 bg-amber/10 text-amber'
                    : 'border-ink-600 text-muted hover:border-ink-500'
                }`}
                onClick={() => patch('translateProvider', item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted">
            {PROVIDERS.find((item) => item.id === draft.translateProvider)?.hint}
          </p>

          {draft.translateProvider !== 'none' ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-[11px] text-muted">接口地址</span>
                <input
                  className="field mt-1"
                  value={draft.translateEndpoint}
                  onChange={(event) => patch('translateEndpoint', event.target.value)}
                  placeholder={draft.translateProvider === 'openai' ? 'https://api.xxx.com/v1' : 'https://api-free.deepl.com/v2/translate'}
                />
              </label>
              <label className="block">
                <span className="text-[11px] text-muted">密钥</span>
                <input
                  className="field mt-1"
                  type="password"
                  value={draft.translateKey}
                  onChange={(event) => patch('translateKey', event.target.value)}
                  placeholder="sk-..."
                />
              </label>
              {draft.translateProvider === 'openai' ? (
                <label className="block">
                  <span className="text-[11px] text-muted">模型</span>
                  <input
                    className="field mt-1"
                    value={draft.translateModel}
                    onChange={(event) => patch('translateModel', event.target.value)}
                    placeholder="gpt-4o-mini"
                  />
                </label>
              ) : null}
              <label className="block">
                <span className="text-[11px] text-muted">默认目标语言</span>
                <select className="field mt-1" value={draft.translateTarget} onChange={(event) => patch('translateTarget', event.target.value)}>
                  <option value="zh">简体中文</option>
                  <option value="en">English</option>
                  <option value="ja">日本語</option>
                  <option value="ko">한국어</option>
                  <option value="fr">Français</option>
                  <option value="de">Deutsch</option>
                  <option value="ru">Русский</option>
                </select>
              </label>
            </div>
          ) : null}
          <p className="mt-2 text-[11px] leading-5 text-muted">
            密钥只写在本地存储里，请求由你的浏览器直接发出，不经过任何中转服务。
          </p>
        </section>

        <section className="panel p-4">
          <span className="label">导出与自动保存</span>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-[11px] text-muted">图片格式</span>
              <select
                className="field mt-1"
                value={draft.imageFormat}
                onChange={(event) => patch('imageFormat', event.target.value as 'png' | 'jpeg')}
              >
                <option value="png">PNG（无损）</option>
                <option value="jpeg">JPEG（体积小）</option>
              </select>
            </label>
            <label className="block">
              <span className="text-[11px] text-muted">JPEG 质量 {Math.round(draft.jpegQuality * 100)}%</span>
              <input
                type="range"
                min={0.5}
                max={1}
                step={0.02}
                value={draft.jpegQuality}
                className="mt-3 w-full accent-amber"
                onChange={(event) => patch('jpegQuality', Number(event.target.value))}
              />
            </label>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-ink-600 pt-3">
            {isDesktop() ? null : (
              <button type="button" className="btn" onClick={pickDirectory} disabled={!autosaveSupported()}>
                <FolderOpen size={14} /> 选择自动保存目录
              </button>
            )}
            {dirName ? (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  clearDirectory();
                  setDirName(null);
                  toast('已取消目录授权', 'ok');
                }}
              >
                <Trash2 size={13} /> 取消「{dirName}」
              </button>
            ) : null}
            <label className="flex items-center gap-2 text-[12px] text-muted">
              <input
                type="checkbox"
                className="accent-amber"
                checked={draft.autoSaveEnabled}
                onChange={(event) => patch('autoSaveEnabled', event.target.checked)}
              />
              {isDesktop() ? '导出时静默写入 图片\\Stillframe' : '导出时写入该目录'}
            </label>
          </div>
          <p className="mt-2 text-[11px] leading-5 text-muted">
            {isDesktop()
              ? '桌面端直接写入系统「图片\\Stillframe」目录，每次保存追加一张，不弹系统保存框；关掉上面这项则改走「另存为」。'
              : '浏览器重启后目录授权会失效，需要重新选择一次。不支持该接口的浏览器请直接用下载。'}
          </p>
        </section>

        <section className="panel p-4">
          <span className="label">关于</span>
          <p className="mt-2 text-[12px] leading-6 text-paper/75">
            定格 / Stillframe 是一个屏幕捕捉工具箱，包含区域截图、滚动长图、区域录屏、本地取字与屏幕翻译。
            网页端受浏览器沙箱限制，桌面端与移动端的原生实现放在同一个仓库里，可自行编译。
          </p>
          <p className="mt-2 font-mono text-[10px] text-muted">MIT License · 0.1.0</p>
        </section>
      </div>
    </div>
  );
}
