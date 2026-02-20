import React from 'react';
import type { StoryAiGenerateFormState } from '../../types';

type StoryAIGeneratorFormProps = {
  form: StoryAiGenerateFormState;
  busy: boolean;
  modelSourceLabel: 'Lab' | 'Global';
  onChange: (patch: Partial<StoryAiGenerateFormState>) => void;
  onGenerate: () => Promise<void>;
};

export function StoryAIGeneratorForm({ form, busy, modelSourceLabel, onChange, onGenerate }: StoryAIGeneratorFormProps) {
  return (
    <section className="border border-gray-700 p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold">AI 生成草稿</h3>
        <button
          type="button"
          className="px-3 py-2 border border-amber-600 bg-amber-950/30 text-amber-200 hover:bg-amber-900/40 disabled:opacity-50"
          onClick={() => { void onGenerate(); }}
          disabled={busy}
        >
          生成并保存草稿
        </button>
      </div>
      <div className="text-xs text-cyan-300 border border-cyan-900/40 bg-cyan-950/20 p-2">
        当前生成模型来源：{modelSourceLabel}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="text-sm">标题提示
          <input
            className="w-full mt-1 bg-black border border-gray-600 p-2"
            value={form.titleHint}
            onChange={(e) => onChange({ titleHint: e.target.value })}
            disabled={busy}
          />
        </label>

        <label className="text-sm">场景设定
          <input
            className="w-full mt-1 bg-black border border-gray-600 p-2"
            value={form.setting}
            onChange={(e) => onChange({ setting: e.target.value })}
            disabled={busy}
          />
        </label>

        <label className="text-sm md:col-span-2">核心 premise
          <input
            className="w-full mt-1 bg-black border border-gray-600 p-2"
            value={form.corePremise}
            onChange={(e) => onChange({ corePremise: e.target.value })}
            disabled={busy}
          />
        </label>

        <label className="text-sm">基调
          <input
            className="w-full mt-1 bg-black border border-gray-600 p-2"
            value={form.tone}
            onChange={(e) => onChange({ tone: e.target.value })}
            disabled={busy}
          />
        </label>

        <label className="text-sm">目标回合（可选）
          <input
            className="w-full mt-1 bg-black border border-gray-600 p-2"
            value={form.targetTurns}
            onChange={(e) => onChange({ targetTurns: e.target.value })}
            placeholder="例如 14"
            disabled={busy}
          />
        </label>

        <label className="text-sm">必须包含规则（每行一条）
          <textarea
            className="w-full mt-1 bg-black border border-gray-600 p-2 min-h-[120px]"
            value={form.mustHaveRules}
            onChange={(e) => onChange({ mustHaveRules: e.target.value })}
            disabled={busy}
          />
        </label>

        <label className="text-sm">必须包含结局（每行一条）
          <textarea
            className="w-full mt-1 bg-black border border-gray-600 p-2 min-h-[120px]"
            value={form.mustHaveEndings}
            onChange={(e) => onChange({ mustHaveEndings: e.target.value })}
            disabled={busy}
          />
        </label>

        <label className="text-sm md:col-span-2">难度/节奏要求
          <textarea
            className="w-full mt-1 bg-black border border-gray-600 p-2 min-h-[90px]"
            value={form.difficultyNotes}
            onChange={(e) => onChange({ difficultyNotes: e.target.value })}
            disabled={busy}
          />
        </label>

        <label className="text-sm md:col-span-2">生成备注（用于版本 changeNote）
          <input
            className="w-full mt-1 bg-black border border-gray-600 p-2"
            value={form.changeNote}
            onChange={(e) => onChange({ changeNote: e.target.value })}
            disabled={busy}
          />
        </label>
      </div>
    </section>
  );
}
