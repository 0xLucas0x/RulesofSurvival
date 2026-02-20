import React from 'react';
import type { StoryDetail, StoryVersionSummary } from '../../types';

type StoryVersionPanelProps = {
  story: StoryDetail | null;
  versions: StoryVersionSummary[];
  busy: boolean;
  onPublishVersion: (versionId?: string) => Promise<void>;
  onLoadEditorFromSource: (source: 'draft' | 'published') => void;
};

const sourceLabelMap: Record<StoryVersionSummary['source'], string> = {
  manual: '手工',
  ai: 'AI',
  seed: 'Seed',
};

export function StoryVersionPanel({
  story,
  versions,
  busy,
  onPublishVersion,
  onLoadEditorFromSource,
}: StoryVersionPanelProps) {
  if (!story) {
    return (
      <section className="border border-gray-700 p-5">
        <h3 className="text-lg font-semibold mb-2">版本管理</h3>
        <p className="text-sm text-gray-400">请先选择故事。</p>
      </section>
    );
  }

  return (
    <section className="border border-gray-700 p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold">版本管理</h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="px-3 py-2 border border-gray-600 text-gray-200 hover:border-gray-400 disabled:opacity-50"
            disabled={busy || !story.publishedPayload}
            onClick={() => onLoadEditorFromSource('published')}
          >
            加载已发布到编辑器
          </button>
          <button
            type="button"
            className="px-3 py-2 border border-gray-600 text-gray-200 hover:border-gray-400 disabled:opacity-50"
            disabled={busy || !story.draftPayload}
            onClick={() => onLoadEditorFromSource('draft')}
          >
            加载当前草稿到编辑器
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 text-sm">
        <button
          type="button"
          className="px-3 py-2 border border-emerald-700 bg-emerald-950/30 text-emerald-200 hover:bg-emerald-900/30 disabled:opacity-50"
          disabled={busy || !story.draftVersionId}
          onClick={() => { void onPublishVersion(); }}
        >
          发布当前草稿
        </button>
      </div>

      <div className="space-y-2 max-h-72 overflow-auto pr-1">
        {versions.length === 0 && (
          <div className="text-sm text-gray-400 border border-gray-800 p-3">暂无版本</div>
        )}

        {versions.map((version) => {
          const isPublished = version.id === story.publishedVersionId;
          const isDraft = version.id === story.draftVersionId;

          return (
            <div key={version.id} className="border border-gray-800 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm text-gray-100 font-medium">v{version.versionNo}</div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="px-2 py-1 border border-gray-700 text-gray-300">{sourceLabelMap[version.source]}</span>
                  {isPublished && (
                    <span className="px-2 py-1 border border-emerald-700 text-emerald-300">已发布</span>
                  )}
                  {isDraft && (
                    <span className="px-2 py-1 border border-blue-700 text-blue-300">当前草稿</span>
                  )}
                </div>
              </div>

              <div className="text-xs text-gray-400">创建时间：{new Date(version.createdAt).toLocaleString()}</div>
              {version.changeNote && <div className="text-xs text-gray-300">备注：{version.changeNote}</div>}

              <div>
                <button
                  type="button"
                  className="px-3 py-1.5 border border-emerald-700 text-emerald-300 bg-emerald-950/20 hover:bg-emerald-900/30 disabled:opacity-50"
                  disabled={busy || isPublished}
                  onClick={() => { void onPublishVersion(version.id); }}
                >
                  发布此版本
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
