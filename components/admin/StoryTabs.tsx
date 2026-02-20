import React from 'react';
import type { StoryWorkspaceTab } from '../../types';

type StoryTabsProps = {
  activeTab: StoryWorkspaceTab;
  onChange: (tab: StoryWorkspaceTab) => void;
  busy: boolean;
};

const tabs: Array<{ id: StoryWorkspaceTab; label: string }> = [
  { id: 'overview', label: '概览' },
  { id: 'versions', label: '版本' },
  { id: 'editor', label: '编辑器+AI' },
];

export function StoryTabs({ activeTab, onChange, busy }: StoryTabsProps) {
  return (
    <div className="border border-gray-700 p-2 overflow-x-auto">
      <div className="flex items-center gap-2 min-w-max">
        {tabs.map((tab) => {
          const selected = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              aria-label={`切换到${tab.label}`}
              className={`px-3 py-2 border text-sm transition disabled:opacity-50 ${
                selected
                  ? 'border-blue-500 bg-blue-950/40 text-blue-200'
                  : 'border-gray-700 text-gray-200 hover:border-gray-500'
              }`}
              onClick={() => onChange(tab.id)}
              disabled={busy}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
