import React from 'react';
import type { StoryDraftEditorState } from '../../types';

type StoryDraftEditorProps = {
  editor: StoryDraftEditorState;
  busy: boolean;
  onEditorChange: (patch: Partial<StoryDraftEditorState>) => void;
  onSaveDraft: () => Promise<void>;
};

export function StoryDraftEditor({ editor, busy, onEditorChange, onSaveDraft }: StoryDraftEditorProps) {
  return (
    <section className="border border-gray-700 p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold">草稿编辑器</h3>
        <button
          type="button"
          className="px-3 py-2 border border-blue-500 bg-blue-950/40 text-blue-200 hover:bg-blue-900/40 disabled:opacity-50"
          onClick={() => { void onSaveDraft(); }}
          disabled={busy}
        >
          保存为新草稿版本
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-3">
          <label className="text-sm">变更备注（可选）
            <input
              className="w-full mt-1 bg-black border border-gray-600 p-2"
              value={editor.changeNote}
              onChange={(e) => onEditorChange({ changeNote: e.target.value, dirty: true })}
              disabled={busy}
            />
          </label>

          <label className="text-sm">initialStateJson
            <textarea
              className="w-full mt-1 bg-black border border-gray-600 p-2 min-h-[220px] font-mono text-xs"
              value={editor.initialStateJsonText}
              onChange={(e) => onEditorChange({
                initialStateJsonText: e.target.value,
                initialStateError: null,
                dirty: true,
              })}
              disabled={busy}
            />
          </label>
          {editor.initialStateError && (
            <div className="text-xs text-red-300 border border-red-700 bg-red-950/40 p-2">
              {editor.initialStateError}
            </div>
          )}

          <label className="text-sm">instructionSectionsJson
            <textarea
              className="w-full mt-1 bg-black border border-gray-600 p-2 min-h-[220px] font-mono text-xs"
              value={editor.instructionSectionsJsonText}
              onChange={(e) => onEditorChange({
                instructionSectionsJsonText: e.target.value,
                instructionSectionsError: null,
                dirty: true,
              })}
              disabled={busy}
            />
          </label>
          {editor.instructionSectionsError && (
            <div className="text-xs text-red-300 border border-red-700 bg-red-950/40 p-2">
              {editor.instructionSectionsError}
            </div>
          )}
        </div>

        <div className="space-y-3">
          <label className="text-sm">instructionTemplateRaw
            <textarea
              className="w-full mt-1 bg-black border border-gray-600 p-2 min-h-[540px] font-mono text-xs"
              value={editor.instructionTemplateRaw}
              onChange={(e) => onEditorChange({
                instructionTemplateRaw: e.target.value,
                instructionTemplateError: null,
                dirty: true,
              })}
              disabled={busy}
            />
          </label>
          {editor.instructionTemplateError && (
            <div className="text-xs text-red-300 border border-red-700 bg-red-950/40 p-2">
              {editor.instructionTemplateError}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
