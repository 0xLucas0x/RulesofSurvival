import React, { useMemo, useState } from 'react';
import type { StoryListQueryState, StorySummary } from '../../types';

type StoryCreateInput = {
  slug: string;
  title: string;
  summary?: string;
  sourceLocale?: string;
  generateWithAi?: boolean;
  llmProvider?: 'gemini' | 'openai' | null;
  llmBaseUrl?: string | null;
  llmModel?: string | null;
  llmApiKey?: string | null;
};

type StoryListPanelProps = {
  stories: StorySummary[];
  selectedStoryId: string | null;
  currentStoryId: string | null;
  query: StoryListQueryState;
  onQueryChange: (patch: Partial<StoryListQueryState>) => void;
  onSelectStory: (storyId: string) => void;
  onCreateStory: (input: StoryCreateInput) => Promise<boolean>;
  generationModelSourceLabel: 'Lab' | 'Global';
  busy: boolean;
};

const statusMap: Record<StorySummary['status'], string> = {
  draft: '草稿',
  published: '已发布',
  archived: '已归档',
};

const statusClassMap: Record<StorySummary['status'], string> = {
  draft: 'border-yellow-700 text-yellow-300 bg-yellow-950/30',
  published: 'border-emerald-700 text-emerald-300 bg-emerald-950/30',
  archived: 'border-gray-700 text-gray-300 bg-gray-900/40',
};

const presetLocales = ['zh-CN', 'en-US', 'ja-JP'];

export function StoryListPanel({
  stories,
  selectedStoryId,
  currentStoryId,
  query,
  onQueryChange,
  onSelectStory,
  onCreateStory,
  generationModelSourceLabel,
  busy,
}: StoryListPanelProps) {
  const [showCreate, setShowCreate] = useState(false);
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
  const [generateWithAi, setGenerateWithAi] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const filteredStories = useMemo(() => {
    const keyword = query.keyword.trim().toLowerCase();
    return stories.filter((story) => {
      if (query.status !== 'all' && story.status !== query.status) {
        return false;
      }
      if (!keyword) {
        return true;
      }

      const haystack = `${story.title} ${story.slug} ${story.summary || ''}`.toLowerCase();
      return haystack.includes(keyword);
    });
  }, [query.keyword, query.status, stories]);

  const stats = useMemo(() => {
    return {
      total: stories.length,
      draft: stories.filter((story) => story.status === 'draft').length,
      published: stories.filter((story) => story.status === 'published').length,
      archived: stories.filter((story) => story.status === 'archived').length,
    };
  }, [stories]);

  const handleCreate = async () => {
    setLocalError(null);

    if (!slug.trim()) {
      setLocalError('请填写 slug');
      return;
    }
    if (!title.trim()) {
      setLocalError('请填写标题');
      return;
    }
    if (generateWithAi && !summary.trim()) {
      setLocalError('勾选 AI 生成时，简介必填（用于故事真相与规则生成）');
      return;
    }

    const sourceLocale = useCustomLocale ? customLocale.trim() : localePreset;
    if (!sourceLocale) {
      setLocalError('请填写 sourceLocale');
      return;
    }

    const success = await onCreateStory({
      slug: slug.trim(),
      title: title.trim(),
      summary: summary.trim() || undefined,
      sourceLocale,
      generateWithAi,
      llmProvider: llmProvider ? (llmProvider as 'gemini' | 'openai') : null,
      llmBaseUrl: llmBaseUrl.trim() || null,
      llmModel: llmModel.trim() || null,
      llmApiKey: llmApiKey.trim() || null,
    });

    if (!success) {
      return;
    }

    setSlug('');
    setTitle('');
    setSummary('');
    setLocalePreset('zh-CN');
    setCustomLocale('');
    setUseCustomLocale(false);
    setLlmProvider('');
    setLlmBaseUrl('');
    setLlmModel('');
    setLlmApiKey('');
    setGenerateWithAi(false);
    setShowCreate(false);
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">故事管理</h2>
        <button
          type="button"
          className="px-3 py-2 border border-blue-500 bg-blue-950/40 text-blue-200 hover:bg-blue-900/40 disabled:opacity-50"
          onClick={() => setShowCreate((prev) => !prev)}
          disabled={busy}
        >
          {showCreate ? '收起创建' : '新建故事'}
        </button>
      </div>

      <div className="space-y-2">
        <label className="text-xs text-gray-400 block">
          搜索
          <input
            className="w-full mt-1 bg-black border border-gray-600 p-2 text-sm"
            placeholder="按标题 / slug / 简介搜索"
            value={query.keyword}
            onChange={(e) => onQueryChange({ keyword: e.target.value })}
            disabled={busy}
          />
        </label>

        <label className="text-xs text-gray-400 block">
          状态筛选
          <select
            className="w-full mt-1 bg-black border border-gray-600 p-2 text-sm"
            value={query.status}
            onChange={(e) => onQueryChange({ status: e.target.value as StoryListQueryState['status'] })}
            disabled={busy}
          >
            <option value="all">全部</option>
            <option value="draft">草稿</option>
            <option value="published">已发布</option>
            <option value="archived">已归档</option>
          </select>
        </label>
      </div>

      {showCreate && (
        <div className="border border-gray-800 p-4 space-y-3 bg-black/30">
          <h3 className="font-semibold text-gray-100">创建故事</h3>
          {localError && <div className="text-sm text-red-300 border border-red-700 bg-red-950/40 p-2">{localError}</div>}

          <div className="grid grid-cols-1 gap-3">
            <label className="text-sm">Slug
              <input
                className="w-full mt-1 bg-black border border-gray-600 p-2"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="chongshan-hospital"
                disabled={busy}
              />
            </label>

            <label className="text-sm">标题
              <input
                className="w-full mt-1 bg-black border border-gray-600 p-2"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="崇山医院"
                disabled={busy}
              />
            </label>

            <label className="text-sm">简介
              <input
                className="w-full mt-1 bg-black border border-gray-600 p-2"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder={generateWithAi ? '必填：包含上帝视角真相，用于生成规则/干扰规则/结局结构' : '可选'}
                disabled={busy}
              />
            </label>

            <div className="text-sm space-y-2 border border-gray-800 p-3 bg-black/20">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={generateWithAi}
                  onChange={(e) => setGenerateWithAi(e.target.checked)}
                  disabled={busy}
                />
                <span>创建后 AI 生成完整故事草稿</span>
              </label>
              <div className="text-xs text-gray-400">
                简介将作为“上帝视角真相”输入；生成后自动保存为 draft 并载入编辑器。
              </div>
              <div className="text-xs text-cyan-300">
                当前生成模型来源：{generationModelSourceLabel}
              </div>
            </div>

            <div className="text-sm space-y-2">
              <div className="flex items-center gap-2">
                <input
                  id="story-locale-custom"
                  type="checkbox"
                  checked={useCustomLocale}
                  onChange={(e) => setUseCustomLocale(e.target.checked)}
                  disabled={busy}
                />
                <label htmlFor="story-locale-custom">自定义 sourceLocale</label>
              </div>

              {useCustomLocale ? (
                <input
                  className="w-full bg-black border border-gray-600 p-2"
                  value={customLocale}
                  onChange={(e) => setCustomLocale(e.target.value)}
                  placeholder="例如 de-DE"
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
                placeholder="可选"
                disabled={busy}
              />
            </label>

            <label className="text-sm">LLM 覆盖 Model
              <input
                className="w-full mt-1 bg-black border border-gray-600 p-2"
                value={llmModel}
                onChange={(e) => setLlmModel(e.target.value)}
                placeholder="可选"
                disabled={busy}
              />
            </label>

            <label className="text-sm">LLM 覆盖 API Key
              <input
                type="password"
                className="w-full mt-1 bg-black border border-gray-600 p-2"
                value={llmApiKey}
                onChange={(e) => setLlmApiKey(e.target.value)}
                placeholder="可选"
                disabled={busy}
              />
            </label>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              className="px-3 py-2 border border-emerald-600 bg-emerald-900/40 text-emerald-200 hover:bg-emerald-800/40 disabled:opacity-50"
              onClick={() => { void handleCreate(); }}
              disabled={busy}
            >
              创建
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2 max-h-[52vh] overflow-auto pr-1">
        {filteredStories.length === 0 && (
          <div className="text-sm text-gray-400 border border-gray-800 p-3">当前筛选下没有故事</div>
        )}

        {filteredStories.map((story) => {
          const selected = story.id === selectedStoryId;
          const isCurrent = story.id === currentStoryId;

          return (
            <button
              key={story.id}
              type="button"
              className={`w-full text-left border p-3 transition ${
                selected ? 'border-blue-500 bg-blue-950/20' : 'border-gray-800 hover:border-gray-600'
              }`}
              onClick={() => onSelectStory(story.id)}
              disabled={busy}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="font-medium text-gray-100 truncate">{story.title}</div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-xs px-2 py-1 border ${statusClassMap[story.status]}`}>
                    {statusMap[story.status]}
                  </span>
                  {isCurrent && (
                    <span className="text-xs px-2 py-1 border border-cyan-700 text-cyan-300 bg-cyan-950/20">默认</span>
                  )}
                </div>
              </div>
              <div className="text-xs text-gray-400 mt-1">slug: {story.slug}</div>
              <div className="text-xs text-gray-500 mt-1">更新于 {new Date(story.updatedAt).toLocaleString()}</div>
            </button>
          );
        })}
      </div>

      <div className="border border-gray-800 p-3 text-xs text-gray-400 grid grid-cols-2 gap-2">
        <div>总数：{stats.total}</div>
        <div>草稿：{stats.draft}</div>
        <div>已发布：{stats.published}</div>
        <div>已归档：{stats.archived}</div>
      </div>
    </section>
  );
}
