import React from 'react';

type UnsavedChangesConfirmProps = {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function UnsavedChangesConfirm({ open, onCancel, onConfirm }: UnsavedChangesConfirmProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md border border-gray-700 bg-black p-5 space-y-4">
        <h3 className="text-lg font-semibold text-gray-100">未保存修改</h3>
        <p className="text-sm text-gray-300">
          当前草稿有未保存内容。继续切换将丢失这些修改，是否继续？
        </p>
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            className="px-3 py-2 border border-gray-600 text-gray-200 hover:border-gray-400"
            onClick={onCancel}
          >
            取消
          </button>
          <button
            type="button"
            className="px-3 py-2 border border-red-700 bg-red-950/40 text-red-300 hover:bg-red-900/40"
            onClick={onConfirm}
          >
            丢弃并继续
          </button>
        </div>
      </div>
    </div>
  );
}
