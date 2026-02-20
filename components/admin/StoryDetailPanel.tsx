import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { StoryDetail } from '../../types';

type StoryMetadataUpdateInput = {
  slug?: string;
  title?: string;
  summary?: string | null;
  sourceLocale?: string;
  llmProvider?: 'gemini' | 'openai' | null;
  llmBaseUrl?: string | null;
  llmModel?: string | null;
  llmApiKey?: string | null;
};

type StoryDetailPanelProps = {
  story: StoryDetail | null;
  busy: boolean;
  saveRequestNonce: number;
  onCanSaveChange?: (canSave: boolean) => void;
  onSaveMetadata: (payload: StoryMetadataUpdateInput) => Promise<void>;
};

const presetLocales = ['zh-CN', 'en-US', 'ja-JP'];

export function StoryDetailPanel({
  story,
  busy,
  saveRequestNonce,
  onCanSaveChange,
  onSaveMetadata,
}: StoryDetailPanelProps) {
  const [slug, setSlug] = useState('');
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [localePreset, setLocalePreset] = useState('zh-CN');
  const [customLocale, setCustomLocale] = useState('');
  const [useCustomLocale, setUseCustomLocale] = useState(false);

  const [llmProvider, setLlmProvider] = useState('');
  const [llmBaseUrl, setLlmBaseUrl] = useState('');
  const [llmModel, setLlmModel] = useState('');
  const [llmApiKey, setLlmApiKey] = useState('');
  const [llmApiKeyTouched, setLlmApiKeyTouched] = useState(false);

  const lastSaveRequestNonceRef = useRef(saveRequestNonce);

  useEffect(() => {
    if (!story) {
      return;
    }

    setSlug(story.slug || '');
    setTitle(story.title || '');
    setSummary(story.summary || '');

    const locale = story.sourceLocale || 'zh-CN';
    if (presetLocales.includes(locale)) {
      setUseCustomLocale(false);
      setLocalePreset(locale);
      setCustomLocale('');
    } else {
      setUseCustomLocale(true);
      setLocalePreset('zh-CN');
      setCustomLocale(locale);
    }

    setLlmProvider(story.llmProvider || '');
    setLlmBaseUrl(story.llmBaseUrl || '');
    setLlmModel(story.llmModel || '');
    setLlmApiKey('');
    setLlmApiKeyTouched(false);
  }, [story]);

  const sourceLocale = useMemo(() => {
    return useCustomLocale ? customLocale.trim() : localePreset;
  }, [customLocale, localePreset, useCustomLocale]);

  const canSave = !!story && !!slug.trim() && !!title.trim() && !!sourceLocale;

  const handleSave = useCallback(async () => {
    if (!canSave) {
      return;
    }

    const payload: StoryMetadataUpdateInput = {
      slug: slug.trim(),
      title: title.trim(),
      summary: summary.trim() || null,
      sourceLocale,
      llmProvider: llmProvider ? (llmProvider as 'gemini' | 'openai') : null,
      llmBaseUrl: llmBaseUrl.trim() || null,
      llmModel: llmModel.trim() || null,
    };

    if (llmApiKeyTouched) {
      payload.llmApiKey = llmApiKey.trim() || null;
    }

    await onSaveMetadata(payload);
  }, [
    canSave,
    slug,
    title,
    summary,
    sourceLocale,
    llmProvider,
    llmBaseUrl,
    llmModel,
    llmApiKeyTouched,
    llmApiKey,
    onSaveMetadata,
  ]);

  useEffect(() => {
    onCanSaveChange?.(canSave);
  }, [canSave, onCanSaveChange]);

  useEffect(() => {
    if (saveRequestNonce === lastSaveRequestNonceRef.current) {
      return;
    }
    lastSaveRequestNonceRef.current = saveRequestNonce;
    void handleSave();
  }, [handleSave, saveRequestNonce]);

  if (!story) {
    return (
      <section className="border border-gray-700 p-5">
        <h3 className="text-lg font-semibold mb-2">故事概览</h3>
        <p className="text-sm text-gray-400">请先在左侧选择一个故事。</p>
      </section>
    );
  }

  return (
    <section className="border border-gray-700 p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold">故事概览</h3>
        <div className="text-xs text-gray-400">通过顶部操作栏保存元数据</div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="text-sm">Slug
          <input
            className="w-full mt-1 bg-black border border-gray-600 p-2"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            disabled={busy}
          />
        </label>

        <label className="text-sm">标题
          <input
            className="w-full mt-1 bg-black border border-gray-600 p-2"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={busy}
          />
        </label>

        <label className="text-sm md:col-span-2">简介
          <input
            className="w-full mt-1 bg-black border border-gray-600 p-2"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            disabled={busy}
          />
        </label>

        <div className="text-sm space-y-2">
          <div className="flex items-center gap-2">
            <input
              id="detail-source-locale-custom"
              type="checkbox"
              checked={useCustomLocale}
              onChange={(e) => setUseCustomLocale(e.target.checked)}
              disabled={busy}
            />
            <label htmlFor="detail-source-locale-custom">自定义 sourceLocale</label>
          </div>

          {useCustomLocale ? (
            <input
              className="w-full bg-black border border-gray-600 p-2"
              value={customLocale}
              onChange={(e) => setCustomLocale(e.target.value)}
              placeholder="例如 fr-FR"
              disabled={busy}
            />
          ) : (
            <select
              className="w-full bg-black border border-gray-600 p-2"
              value={localePreset}
              onChange={(e) => setLocalePreset(e.target.value)}
              disabled={busy}
            >
              {presetLocales.map((locale) => (
                <option key={locale} value={locale}>{locale}</option>
              ))}
            </select>
          )}
        </div>

        <label className="text-sm">LLM 覆盖 Provider
          <select
            className="w-full mt-1 bg-black border border-gray-600 p-2"
            value={llmProvider}
            onChange={(e) => setLlmProvider(e.target.value)}
            disabled={busy}
          >
            <option value="">跟随全局</option>
            <option value="gemini">gemini</option>
            <option value="openai">openai</option>
          </select>
        </label>

        <label className="text-sm">LLM 覆盖 Base URL
          <input
            className="w-full mt-1 bg-black border border-gray-600 p-2"
            value={llmBaseUrl}
            onChange={(e) => setLlmBaseUrl(e.target.value)}
            disabled={busy}
          />
        </label>

        <label className="text-sm">LLM 覆盖 Model
          <input
            className="w-full mt-1 bg-black border border-gray-600 p-2"
            value={llmModel}
            onChange={(e) => setLlmModel(e.target.value)}
            disabled={busy}
          />
        </label>

        <label className="text-sm">LLM 覆盖 API Key
          <input
            type="password"
            className="w-full mt-1 bg-black border border-gray-600 p-2"
            value={llmApiKey}
            onChange={(e) => {
              setLlmApiKey(e.target.value);
              setLlmApiKeyTouched(true);
            }}
            placeholder={story.hasLlmApiKeyOverride ? '已设置覆盖；留空并保存将清除' : '可选'}
            disabled={busy}
          />
        </label>
      </div>
    </section>
  );
}
