import React from 'react';
import type { StoryDetail, StoryWorkspaceTab } from '../../types';

type StoryHeaderBarProps = {
  story: StoryDetail | null;
  activeTab: StoryWorkspaceTab;
  isCurrentDefault: boolean;
  canSaveMetadata: boolean;
  busy: boolean;
  onSaveMetadata: () => void;
  onSetDefaultStory: () => Promise<void>;
  onArchiveStory: () => Promise<void>;
};

export function StoryHeaderBar({
  story,
  activeTab,
  isCurrentDefault,
  canSaveMetadata,
  busy,
  onSaveMetadata,
  onSetDefaultStory,
  onArchiveStory,
}: StoryHeaderBarProps) {
  if (!story) {
    return (
      <section className="border border-gray-700 p-4">
        <h3 className="text-lg font-semibold text-gray-100">故事工作台</h3>
        <p className="text-sm text-gray-400 mt-1">请先在左侧选择故事。</p>
      </section>
    );
  }

  const canSetDefault = story.status === 'published' && !isCurrentDefault;
  const canArchive = story.status !== 'archived';
  const canSave = activeTab === 'overview' && canSaveMetadata && story.status !== 'archived';

  return (
    <section className="border border-gray-700 bg-black/60 p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-gray-100 truncate">{story.title}</h3>
          <div className="text-xs text-gray-400 mt-1 truncate">slug: {story.slug}</div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="px-2 py-1 border border-gray-700 text-gray-300">状态：{story.status}</span>
          {isCurrentDefault && (
            <span className="px-2 py-1 border border-cyan-700 text-cyan-300">当前默认</span>
          )}
          <span className="px-2 py-1 border border-gray-700 text-gray-300">标签：{activeTab}</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-label="保存故事元数据"
          className="px-3 py-2 border border-blue-500 bg-blue-950/40 text-blue-200 hover:bg-blue-900/40 disabled:opacity-50"
          onClick={onSaveMetadata}
          disabled={busy || !canSave}
        >
          保存元数据
        </button>

        <button
          type="button"
          aria-label="设为默认故事"
          className="px-3 py-2 border border-cyan-600 bg-cyan-950/30 text-cyan-200 hover:bg-cyan-900/30 disabled:opacity-50"
          onClick={() => { void onSetDefaultStory(); }}
          disabled={busy || !canSetDefault}
        >
          {isCurrentDefault ? '已是默认故事' : '设为默认故事'}
        </button>

        <button
          type="button"
          aria-label="归档故事"
          className="px-3 py-2 border border-red-700 bg-red-950/30 text-red-300 hover:bg-red-900/30 disabled:opacity-50"
          onClick={() => {
            if (window.confirm('归档后该故事不可直接用于新开局，确认继续吗？')) {
              void onArchiveStory();
            }
          }}
          disabled={busy || !canArchive}
        >
          归档故事
        </button>
      </div>
    </section>
  );
}
