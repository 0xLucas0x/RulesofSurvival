import React from 'react';

type StoryWorkspaceLayoutProps = {
  leftPanel: React.ReactNode;
  header: React.ReactNode;
  children: React.ReactNode;
};

export function StoryWorkspaceLayout({ leftPanel, header, children }: StoryWorkspaceLayoutProps) {
  return (
    <section className="border border-gray-700 p-4 md:p-5">
      <div className="grid grid-cols-1 lg:grid-cols-[340px_minmax(0,1fr)] gap-4">
        <aside className="min-w-0">
          <details open className="border border-gray-800 bg-black/20 lg:border-0 lg:bg-transparent">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-gray-200 lg:hidden">
              故事列表
            </summary>
            <div className="p-3 pt-2 lg:p-0">
              {leftPanel}
            </div>
          </details>
        </aside>

        <div className="min-w-0 space-y-4">
          <div className="lg:sticky lg:top-4 z-10">
            {header}
          </div>
          <div>{children}</div>
        </div>
      </div>
    </section>
  );
}
