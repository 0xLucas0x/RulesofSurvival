import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  archiveStoryAdminApi,
  createStoryAdminApi,
  createStoryDraftAdmin,
  fetchCurrentStoryAdmin,
  fetchStoriesAdmin,
  fetchStoryAdmin,
  fetchStoryVersionsAdmin,
  generateStoryDraftAdmin,
  publishStoryAdminApi,
  readLabModelConfig,
  setCurrentStoryAdminApi,
  updateStoryAdminApi,
} from '../../services/geminiService';
import type {
  GenerateStoryDraftInput,
  LabModelConfig,
  StoryAiGenerateFormState,
  StoryDetail,
  StoryDraftEditorState,
  StoryListQueryState,
  StorySummary,
  StoryVersionPayload,
  StoryVersionSummary,
  StoryWorkspaceTab,
} from '../../types';
import { StoryAIGeneratorForm } from './StoryAIGeneratorForm';
import { StoryDetailPanel } from './StoryDetailPanel';
import { StoryDraftEditor } from './StoryDraftEditor';
import { StoryHeaderBar } from './StoryHeaderBar';
import { StoryListPanel } from './StoryListPanel';
import { StoryTabs } from './StoryTabs';
import { StoryVersionPanel } from './StoryVersionPanel';
import { StoryWorkspaceLayout } from './StoryWorkspaceLayout';
import { UnsavedChangesConfirm } from './UnsavedChangesConfirm';

type PendingSwitch =
  | { type: 'story'; storyId: string }
  | { type: 'editorSource'; source: 'draft' | 'published' }
  | { type: 'tab'; tab: StoryWorkspaceTab };

type StoryManagerProps = {
  onError?: (message: string | null) => void;
  onOk?: (message: string | null) => void;
};

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

type GenerationModelSelection = {
  sourceLabel: 'Lab' | 'Global';
  patch: Pick<GenerateStoryDraftInput, 'modelSource' | 'llmOverride'>;
};

const emptyDraftEditor = (): StoryDraftEditorState => ({
  changeNote: '',
  initialStateJsonText: '{\n  \n}',
  instructionSectionsJsonText: '{\n  \n}',
  instructionTemplateRaw: '',
  initialStateError: null,
  instructionSectionsError: null,
  instructionTemplateError: null,
  dirty: false,
});

const emptyAiForm = (): StoryAiGenerateFormState => ({
  titleHint: '',
  setting: '',
  corePremise: '',
  tone: '',
  mustHaveRules: '',
  mustHaveEndings: '',
  targetTurns: '',
  difficultyNotes: '',
  changeNote: 'AI generated draft',
});

const toPrettyJson = (value: unknown): string => {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return '{\n  \n}';
  }
};

const editorFromPayload = (payload?: StoryVersionPayload | null): StoryDraftEditorState => {
  if (!payload) {
    return emptyDraftEditor();
  }

  return {
    changeNote: payload.changeNote || '',
    initialStateJsonText: toPrettyJson(payload.initialStateJson),
    instructionSectionsJsonText: toPrettyJson(payload.instructionSectionsJson),
    instructionTemplateRaw: payload.instructionTemplateRaw || '',
    initialStateError: null,
    instructionSectionsError: null,
    instructionTemplateError: null,
    dirty: false,
  };
};

const parseMultilineList = (value: string): string[] => {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
};

const asErrorMessage = (error: unknown, fallback: string): string => {
  if (error && typeof error === 'object' && 'message' in error && typeof (error as any).message === 'string') {
    return (error as any).message;
  }
  return fallback;
};

const sanitizeLabModelConfig = (raw: LabModelConfig | null): LabModelConfig | null => {
  if (!raw) {
    return null;
  }
  if (!raw.apiKey?.trim() || !raw.model?.trim()) {
    return null;
  }
  if (raw.provider === 'openai' && !raw.baseUrl?.trim()) {
    return null;
  }
  return {
    provider: raw.provider,
    baseUrl: raw.baseUrl.trim(),
    model: raw.model.trim(),
    apiKey: raw.apiKey.trim(),
  };
};

export function StoryManager({ onError, onOk }: StoryManagerProps) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [stories, setStories] = useState<StorySummary[]>([]);
  const [currentStoryId, setCurrentStoryId] = useState<string | null>(null);
  const [selectedStoryId, setSelectedStoryId] = useState<string | null>(null);
  const [selectedStory, setSelectedStory] = useState<StoryDetail | null>(null);
  const [versions, setVersions] = useState<StoryVersionSummary[]>([]);
  const [listQuery, setListQuery] = useState<StoryListQueryState>({ keyword: '', status: 'all' });
  const [activeTab, setActiveTab] = useState<StoryWorkspaceTab>('overview');

  const [draftEditor, setDraftEditor] = useState<StoryDraftEditorState>(emptyDraftEditor());
  const [editorSource, setEditorSource] = useState<'draft' | 'published' | null>(null);
  const [aiForm, setAiForm] = useState<StoryAiGenerateFormState>(emptyAiForm());
  const [generationModelSourceLabel, setGenerationModelSourceLabel] = useState<'Lab' | 'Global'>('Global');

  const [canSaveMetadata, setCanSaveMetadata] = useState(false);
  const [saveMetadataNonce, setSaveMetadataNonce] = useState(0);

  const [pendingSwitch, setPendingSwitch] = useState<PendingSwitch | null>(null);
  const [showUnsavedConfirm, setShowUnsavedConfirm] = useState(false);

  const selectedStoryIdRef = useRef<string | null>(null);
  const onErrorRef = useRef(onError);
  const onOkRef = useRef(onOk);

  useEffect(() => {
    selectedStoryIdRef.current = selectedStoryId;
  }, [selectedStoryId]);

  useEffect(() => {
    onErrorRef.current = onError;
    onOkRef.current = onOk;
  }, [onError, onOk]);

  const clearMessages = useCallback(() => {
    onErrorRef.current?.(null);
    onOkRef.current?.(null);
  }, []);

  const resolveGenerationModelSelection = useCallback((): GenerationModelSelection => {
    const labConfig = sanitizeLabModelConfig(readLabModelConfig());
    if (labConfig) {
      return {
        sourceLabel: 'Lab',
        patch: {
          modelSource: 'lab',
          llmOverride: labConfig,
        },
      };
    }
    return {
      sourceLabel: 'Global',
      patch: {
        modelSource: 'global',
      },
    };
  }, []);

  const refreshGenerationModelSourceLabel = useCallback(() => {
    setGenerationModelSourceLabel(resolveGenerationModelSelection().sourceLabel);
  }, [resolveGenerationModelSelection]);

  const loadStoryDetail = useCallback(async (storyId: string, options?: { resetEditor?: boolean }) => {
    const [detail, versionItems] = await Promise.all([
      fetchStoryAdmin(storyId),
      fetchStoryVersionsAdmin(storyId),
    ]);

    setSelectedStoryId(storyId);
    setSelectedStory(detail);
    setVersions(versionItems);

    if (options?.resetEditor !== false) {
      const source = detail.draftPayload ? 'draft' : detail.publishedPayload ? 'published' : null;
      const payload = source === 'draft' ? detail.draftPayload : source === 'published' ? detail.publishedPayload : null;
      setEditorSource(source);
      setDraftEditor(editorFromPayload(payload));
    }
  }, []);

  const refreshAll = useCallback(async (
    preferredStoryId?: string | null,
    options?: { resetEditor?: boolean },
  ) => {
    const [storyItems, current] = await Promise.all([
      fetchStoriesAdmin(),
      fetchCurrentStoryAdmin(),
    ]);

    setStories(storyItems);
    setCurrentStoryId(current.currentStoryId);

    let nextStoryId = preferredStoryId !== undefined ? preferredStoryId : selectedStoryIdRef.current;
    if (nextStoryId && !storyItems.some((story) => story.id === nextStoryId)) {
      nextStoryId = null;
    }

    if (!nextStoryId) {
      nextStoryId = current.currentStoryId || storyItems[0]?.id || null;
    }

    if (!nextStoryId) {
      setSelectedStoryId(null);
      setSelectedStory(null);
      setVersions([]);
      setCanSaveMetadata(false);
      if (options?.resetEditor !== false) {
        setDraftEditor(emptyDraftEditor());
        setEditorSource(null);
      }
      return;
    }

    await loadStoryDetail(nextStoryId, options);
  }, [loadStoryDetail]);

  useEffect(() => {
    let alive = true;
    const boot = async () => {
      setLoading(true);
      clearMessages();
      try {
        await refreshAll(undefined, { resetEditor: true });
      } catch (error) {
        if (!alive) {
          return;
        }
        onErrorRef.current?.(asErrorMessage(error, '加载故事管理数据失败'));
      } finally {
        if (alive) {
          setLoading(false);
        }
      }
    };

    void boot();
    return () => {
      alive = false;
    };
  }, [clearMessages, refreshAll]);

  useEffect(() => {
    refreshGenerationModelSourceLabel();
    if (typeof window === 'undefined') {
      return;
    }

    const handleRefresh = () => {
      refreshGenerationModelSourceLabel();
    };
    window.addEventListener('storage', handleRefresh);
    window.addEventListener('focus', handleRefresh);
    return () => {
      window.removeEventListener('storage', handleRefresh);
      window.removeEventListener('focus', handleRefresh);
    };
  }, [refreshGenerationModelSourceLabel]);

  const runAction = useCallback(async (action: () => Promise<void>): Promise<boolean> => {
    clearMessages();
    setBusy(true);
    try {
      await action();
      return true;
    } catch (error) {
      onErrorRef.current?.(asErrorMessage(error, '操作失败'));
      return false;
    } finally {
      setBusy(false);
    }
  }, [clearMessages]);

  const requestStorySelect = (storyId: string) => {
    if (storyId === selectedStoryId) {
      return;
    }

    if (draftEditor.dirty) {
      setPendingSwitch({ type: 'story', storyId });
      setShowUnsavedConfirm(true);
      return;
    }

    void runAction(async () => {
      await loadStoryDetail(storyId, { resetEditor: true });
      setActiveTab('overview');
    });
  };

  const applyEditorSource = useCallback((source: 'draft' | 'published') => {
    if (!selectedStory) {
      return;
    }
    const payload = source === 'draft' ? selectedStory.draftPayload : selectedStory.publishedPayload;
    if (!payload) {
      onErrorRef.current?.('当前故事没有可加载的该版本内容');
      return;
    }

    setEditorSource(source);
    setDraftEditor(editorFromPayload(payload));
    setActiveTab('editor');
  }, [selectedStory]);

  const requestEditorSourceSwitch = (source: 'draft' | 'published') => {
    if (draftEditor.dirty) {
      setPendingSwitch({ type: 'editorSource', source });
      setShowUnsavedConfirm(true);
      return;
    }
    applyEditorSource(source);
  };

  const requestTabSwitch = (tab: StoryWorkspaceTab) => {
    if (tab === activeTab) {
      return;
    }

    if (activeTab === 'editor' && draftEditor.dirty && tab !== 'editor') {
      setPendingSwitch({ type: 'tab', tab });
      setShowUnsavedConfirm(true);
      return;
    }

    setActiveTab(tab);
  };

  const confirmDiscardAndContinue = () => {
    const pending = pendingSwitch;
    setPendingSwitch(null);
    setShowUnsavedConfirm(false);
    if (!pending) {
      return;
    }

    if (pending.type === 'story') {
      void runAction(async () => {
        await loadStoryDetail(pending.storyId, { resetEditor: true });
        setActiveTab('overview');
      });
      return;
    }

    if (pending.type === 'tab') {
      setActiveTab(pending.tab);
      return;
    }

    applyEditorSource(pending.source);
  };

  const buildDraftGenerationInput = useCallback((base: Omit<GenerateStoryDraftInput, 'modelSource' | 'llmOverride'>) => {
    const selection = resolveGenerationModelSelection();
    return {
      sourceLabel: selection.sourceLabel,
      payload: {
        ...base,
        ...selection.patch,
      } as GenerateStoryDraftInput,
    };
  }, [resolveGenerationModelSelection]);

  const validateDraftPayload = (): {
    payload: StoryVersionPayload | null;
  } => {
    let initialStateError: string | null = null;
    let instructionSectionsError: string | null = null;
    let instructionTemplateError: string | null = null;

    let initialStateJson: Record<string, unknown> | null = null;
    let instructionSectionsJson: Record<string, unknown> | null = null;

    try {
      const parsed = JSON.parse(draftEditor.initialStateJsonText);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        initialStateError = 'initialStateJson 必须是 JSON 对象';
      } else {
        initialStateJson = parsed as Record<string, unknown>;
      }
    } catch {
      initialStateError = 'initialStateJson 不是合法 JSON';
    }

    try {
      const parsed = JSON.parse(draftEditor.instructionSectionsJsonText);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        instructionSectionsError = 'instructionSectionsJson 必须是 JSON 对象';
      } else {
        instructionSectionsJson = parsed as Record<string, unknown>;
      }
    } catch {
      instructionSectionsError = 'instructionSectionsJson 不是合法 JSON';
    }

    if (!draftEditor.instructionTemplateRaw.trim()) {
      instructionTemplateError = 'instructionTemplateRaw 不能为空';
    }

    setDraftEditor((prev) => ({
      ...prev,
      initialStateError,
      instructionSectionsError,
      instructionTemplateError,
    }));

    if (initialStateError || instructionSectionsError || instructionTemplateError) {
      return { payload: null };
    }

    return {
      payload: {
        initialStateJson: initialStateJson as Record<string, unknown>,
        instructionSectionsJson: instructionSectionsJson as Record<string, unknown>,
        instructionTemplateRaw: draftEditor.instructionTemplateRaw,
        changeNote: draftEditor.changeNote.trim() || undefined,
      },
    };
  };

  const handleCreateStory = async (input: StoryCreateInput): Promise<boolean> => {
    return runAction(async () => {
      const { generateWithAi, ...createPayload } = input;
      const created = await createStoryAdminApi(createPayload);
      setListQuery((prev) => ({ ...prev, status: 'all' }));

      let generationFailed = false;
      if (generateWithAi) {
        const { sourceLabel, payload } = buildDraftGenerationInput({
          titleHint: input.title,
          changeNote: 'AI generated draft (create flow)',
          briefSummary: input.summary?.trim() || undefined,
        });
        try {
          await generateStoryDraftAdmin(created.id, payload);
          onOkRef.current?.(`故事已创建并生成 AI 草稿（模型来源：${sourceLabel}）`);
        } catch (error) {
          generationFailed = true;
          onErrorRef.current?.(`故事已创建，但 AI 生成失败：${asErrorMessage(error, '生成失败')}`);
        }
      }

      await refreshAll(created.id, { resetEditor: true });
      if (!generateWithAi || generationFailed) {
        setActiveTab('overview');
        if (!generateWithAi) {
          onOkRef.current?.('故事已创建');
        }
      } else {
        setActiveTab('editor');
      }
    });
  };

  const handleSaveMetadata = async (payload: {
    slug?: string;
    title?: string;
    summary?: string | null;
    sourceLocale?: string;
    llmProvider?: 'gemini' | 'openai' | null;
    llmBaseUrl?: string | null;
    llmModel?: string | null;
    llmApiKey?: string | null;
  }) => {
    if (!selectedStoryId) {
      return;
    }

    await runAction(async () => {
      await updateStoryAdminApi(selectedStoryId, payload);
      await refreshAll(selectedStoryId, { resetEditor: false });
      onOkRef.current?.('故事元数据已更新');
    });
  };

  const handleSetDefaultStory = async () => {
    if (!selectedStoryId) {
      return;
    }

    await runAction(async () => {
      await setCurrentStoryAdminApi(selectedStoryId);
      await refreshAll(selectedStoryId, { resetEditor: false });
      onOkRef.current?.('默认故事已更新');
    });
  };

  const handleArchiveStory = async () => {
    if (!selectedStoryId) {
      return;
    }

    await runAction(async () => {
      await archiveStoryAdminApi(selectedStoryId);
      const [storyItems, current] = await Promise.all([
        fetchStoriesAdmin(),
        fetchCurrentStoryAdmin(),
      ]);
      setStories(storyItems);
      setCurrentStoryId(current.currentStoryId);
      setSelectedStoryId(null);
      setSelectedStory(null);
      setVersions([]);
      setCanSaveMetadata(false);
      setDraftEditor(emptyDraftEditor());
      setEditorSource(null);
      setActiveTab('overview');
      onOkRef.current?.('故事已归档');
    });
  };

  const handlePublishVersion = async (versionId?: string) => {
    if (!selectedStoryId) {
      return;
    }

    await runAction(async () => {
      await publishStoryAdminApi(selectedStoryId, versionId);
      await refreshAll(selectedStoryId, { resetEditor: true });
      onOkRef.current?.('版本已发布');
    });
  };

  const handleSaveDraft = async () => {
    if (!selectedStoryId) {
      onErrorRef.current?.('请先选择故事');
      return;
    }

    const { payload } = validateDraftPayload();
    if (!payload) {
      onErrorRef.current?.('草稿校验失败，请检查 JSON 与模板内容');
      return;
    }

    await runAction(async () => {
      await createStoryDraftAdmin(selectedStoryId, payload);
      await refreshAll(selectedStoryId, { resetEditor: true });
      setActiveTab('editor');
      onOkRef.current?.('草稿版本已创建');
    });
  };

  const handleGenerateDraft = async () => {
    if (!selectedStoryId) {
      onErrorRef.current?.('请先选择故事');
      return;
    }

    const parsedTargetTurns = Number.parseInt(aiForm.targetTurns.trim(), 10);
    await runAction(async () => {
      const { sourceLabel, payload } = buildDraftGenerationInput({
        titleHint: aiForm.titleHint.trim() || undefined,
        setting: aiForm.setting.trim() || undefined,
        corePremise: aiForm.corePremise.trim() || undefined,
        tone: aiForm.tone.trim() || undefined,
        mustHaveRules: parseMultilineList(aiForm.mustHaveRules),
        mustHaveEndings: parseMultilineList(aiForm.mustHaveEndings),
        targetTurns: Number.isFinite(parsedTargetTurns) && parsedTargetTurns > 0 ? parsedTargetTurns : undefined,
        difficultyNotes: aiForm.difficultyNotes.trim() || undefined,
        changeNote: aiForm.changeNote.trim() || undefined,
        briefSummary: selectedStory?.summary || undefined,
      });
      await generateStoryDraftAdmin(selectedStoryId, payload);
      await refreshAll(selectedStoryId, { resetEditor: true });
      setActiveTab('editor');
      refreshGenerationModelSourceLabel();
      onOkRef.current?.(`AI 草稿已生成（模型来源：${sourceLabel}）`);
    });
  };

  const isCurrentDefault = useMemo(() => {
    return !!selectedStoryId && selectedStoryId === currentStoryId;
  }, [currentStoryId, selectedStoryId]);

  if (loading) {
    return (
      <section className="border border-gray-700 p-5">
        <h2 className="text-xl font-semibold mb-2">故事管理</h2>
        <p className="text-sm text-gray-400">加载故事数据中...</p>
      </section>
    );
  }

  return (
    <>
      <StoryWorkspaceLayout
        leftPanel={(
          <StoryListPanel
            stories={stories}
            selectedStoryId={selectedStoryId}
            currentStoryId={currentStoryId}
            query={listQuery}
            onQueryChange={(patch) => {
              setListQuery((prev) => ({ ...prev, ...patch }));
            }}
            onSelectStory={requestStorySelect}
            onCreateStory={handleCreateStory}
            generationModelSourceLabel={generationModelSourceLabel}
            busy={busy}
          />
        )}
        header={(
          <StoryHeaderBar
            story={selectedStory}
            activeTab={activeTab}
            isCurrentDefault={isCurrentDefault}
            canSaveMetadata={canSaveMetadata}
            busy={busy}
            onSaveMetadata={() => setSaveMetadataNonce((prev) => prev + 1)}
            onSetDefaultStory={handleSetDefaultStory}
            onArchiveStory={handleArchiveStory}
          />
        )}
      >
        <div className="space-y-4">
          <StoryTabs activeTab={activeTab} onChange={requestTabSwitch} busy={busy} />

          {activeTab === 'overview' && (
            <StoryDetailPanel
              story={selectedStory}
              busy={busy}
              saveRequestNonce={saveMetadataNonce}
              onCanSaveChange={setCanSaveMetadata}
              onSaveMetadata={handleSaveMetadata}
            />
          )}

          {activeTab === 'versions' && (
            <StoryVersionPanel
              story={selectedStory}
              versions={versions}
              busy={busy}
              onPublishVersion={handlePublishVersion}
              onLoadEditorFromSource={requestEditorSourceSwitch}
            />
          )}

          {activeTab === 'editor' && (
            <div className="space-y-4">
              <StoryDraftEditor
                editor={draftEditor}
                busy={busy}
                onEditorChange={(patch) => {
                  setDraftEditor((prev) => ({ ...prev, ...patch }));
                }}
                onSaveDraft={handleSaveDraft}
              />

              <StoryAIGeneratorForm
                form={aiForm}
                busy={busy}
                modelSourceLabel={generationModelSourceLabel}
                onChange={(patch) => {
                  setAiForm((prev) => ({ ...prev, ...patch }));
                }}
                onGenerate={handleGenerateDraft}
              />

              <div className="text-xs text-gray-500 border border-gray-800 p-3">
                编辑器来源：{editorSource === 'draft' ? '当前草稿' : editorSource === 'published' ? '已发布版本' : '空白'}；
                {draftEditor.dirty ? '有未保存修改' : '无未保存修改'}
              </div>
            </div>
          )}
        </div>
      </StoryWorkspaceLayout>

      <UnsavedChangesConfirm
        open={showUnsavedConfirm}
        onCancel={() => {
          setPendingSwitch(null);
          setShowUnsavedConfirm(false);
        }}
        onConfirm={confirmDiscardAndContinue}
      />
    </>
  );
}
