import React, { useState, useEffect } from 'react';
import { testConnection } from '../services/geminiService';
import { GameConfig, DEFAULT_GAME_CONFIG, DifficultyPreset, DIFFICULTY_PRESETS, DIFFICULTY_LABELS } from '../gameConfig';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    apiKey: string;
    baseUrl: string;
    pollinationsApiKey: string;
    onSave: (
        apiKey: string,
        baseUrl: string,
        pollinationsApiKey: string,
        provider: 'gemini' | 'openai',
        model: string,
        imageProvider: 'pollinations' | 'openai',
        imageModel: string,
        imageBaseUrl: string,
        imageApiKey: string,
        enableImageGen: boolean,
        gameConfig: GameConfig
    ) => void;
    provider: 'gemini' | 'openai';
    chatModel: string;
    imageProvider?: 'pollinations' | 'openai';
    imageModel?: string;
    imageBaseUrl?: string;
    imageApiKey?: string;
    enableImageGen?: boolean;
    gameConfig?: GameConfig;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
    isOpen,
    onClose,
    apiKey: initialApiKey,
    baseUrl: initialBaseUrl,
    pollinationsApiKey: initialPollinationsApiKey,
    provider: initialProvider,
    chatModel: initialModel,
    imageProvider: initialImgProvider,
    imageModel: initialImgModel,
    imageBaseUrl: initialImgBase,
    imageApiKey: initialImgKey,
    enableImageGen: initialEnableImageGen,
    gameConfig: initialGameConfig,
    onSave
}) => {
    const [apiKey, setApiKey] = useState(initialApiKey);
    const [baseUrl, setBaseUrl] = useState(initialBaseUrl);
    const [pollinationsApiKey, setPollinationsApiKey] = useState(initialPollinationsApiKey);
    const [provider, setProvider] = useState<'gemini' | 'openai'>(initialProvider || 'gemini');
    const [chatModel, setChatModel] = useState(initialModel || '');

    const [imageProvider, setImageProvider] = useState<'pollinations' | 'openai'>(initialImgProvider || 'pollinations');
    const [imageModel, setImageModel] = useState(initialImgModel || '');
    const [imageBaseUrl, setImageBaseUrl] = useState(initialImgBase || '');
    const [imageApiKey, setImageApiKey] = useState(initialImgKey || '');
    const [enableImageGen, setEnableImageGen] = useState(initialEnableImageGen !== false);
    const [localGameConfig, setLocalGameConfig] = useState<GameConfig>(initialGameConfig || DEFAULT_GAME_CONFIG);
    const [availableImageModels, setAvailableImageModels] = useState<string[]>([]);
    const [isFetchingImageModels, setIsFetchingImageModels] = useState(false);

    const [availableModels, setAvailableModels] = useState<string[]>([]);
    const [isFetchingModels, setIsFetchingModels] = useState(false);

    const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
    const [imageTestStatus, setImageTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');

    useEffect(() => {
        if (isOpen) {
            setApiKey(initialApiKey);
            setBaseUrl(initialBaseUrl);
            setPollinationsApiKey(initialPollinationsApiKey);
            setProvider(initialProvider || 'gemini');
            setChatModel(initialModel || '');
        }
    }, [isOpen, initialApiKey, initialBaseUrl, initialPollinationsApiKey, initialProvider, initialModel]);

    useEffect(() => {
        if (isOpen) {
            setImageProvider(initialImgProvider || 'pollinations');
            setImageModel(initialImgModel || '');
            setImageBaseUrl(initialImgBase || '');
            setImageApiKey(initialImgKey || '');
            setEnableImageGen(initialEnableImageGen !== false);
            setLocalGameConfig(initialGameConfig || DEFAULT_GAME_CONFIG);
        }
    }, [isOpen, initialImgProvider, initialImgModel, initialImgBase, initialImgKey, initialEnableImageGen]);

    if (!isOpen) return null;

    const handleSave = () => {
        onSave(apiKey, baseUrl, pollinationsApiKey, provider, chatModel, imageProvider, imageModel, imageBaseUrl, imageApiKey, enableImageGen, localGameConfig);
        onClose();
    };

    const handleTest = async () => {
        setTestStatus('testing');
        const success = await testConnection(apiKey, baseUrl, provider, chatModel);
        setTestStatus(success ? 'success' : 'error');
    };

    const handleFetchModels = async () => {
        if (!baseUrl || !apiKey) return;
        setIsFetchingModels(true);
        const models = await import('../services/geminiService').then(m => m.fetchOpenAIModels(baseUrl, apiKey));
        setAvailableModels(models);
        setIsFetchingModels(false);
        if (models.length > 0 && !chatModel) {
            setChatModel(models[0]);
        }
    };

    const handleFetchImageModels = async () => {
        if (!imageBaseUrl || !imageApiKey) return;
        setIsFetchingImageModels(true);
        const models = await import('../services/geminiService').then(m => m.fetchOpenAIImageModels(imageBaseUrl, imageApiKey));
        setAvailableImageModels(models);
        setIsFetchingImageModels(false);
        if (models.length > 0 && !imageModel) {
            setImageModel(models[0]);
        }
    };

    const handleTestImage = async () => {
        setImageTestStatus('testing');
        try {
            const testUrl = `https://gen.pollinations.ai/image/test?width=64&height=64&nologo=true&seed=${Math.floor(Math.random() * 1000000)}${pollinationsApiKey ? `&key=${pollinationsApiKey}` : ''}`;
            const headers: HeadersInit = {};
            if (pollinationsApiKey) {
                headers['Authorization'] = `Bearer ${pollinationsApiKey}`;
            }
            // Also keep query param as fallback/alternative if header fails for some key types, 
            // but for 'Missing Turnstile' usually header is needed. 
            // Actually, let's try sending BOTH or just header. 
            // Documentation says secret keys use header.

            const response = await fetch(testUrl, {
                headers
            });
            if (response.ok) {
                setImageTestStatus('success');
            } else {
                setImageTestStatus('error');
            }
        } catch (error) {
            console.error("Image Test Failed:", error);
            setImageTestStatus('error');
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-80 z-50 flex items-center justify-center p-4">
            <div className="bg-metal-dark border-4 border-sickly-green p-6 w-full max-w-md relative shadow-[0_0_20px_rgba(74,93,78,0.6)] max-h-[85vh] flex flex-col">
                {/* CRT Scanline Effect Overlay (simplified for modal) */}
                <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] z-10 bg-[length:100%_2px,3px_100%]"></div>

                <h2 className="text-2xl font-header text-sickly-green mb-6 text-center tracking-widest uppercase border-b border-sickly-green pb-2 shrink-0">
                    System Configuration
                </h2>

                <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 relative z-20">
                    <div className="space-y-4 font-header">
                        <div>
                            <label className="block text-hospital-white mb-2 text-sm">LLM Provider</label>
                            <div className="flex space-x-4 mb-4">
                                <button
                                    onClick={() => setProvider('gemini')}
                                    className={`flex-1 py-2 text-sm border ${provider === 'gemini' ? 'bg-sickly-green text-black border-sickly-green' : 'border-metal-grey text-metal-grey hover:border-white'} transition-colors uppercase tracking-wider`}
                                >
                                    Gemini 3 Flash
                                </button>
                                <button
                                    onClick={() => setProvider('openai')}
                                    className={`flex-1 py-2 text-sm border ${provider === 'openai' ? 'bg-sickly-green text-black border-sickly-green' : 'border-metal-grey text-metal-grey hover:border-white'} transition-colors uppercase tracking-wider`}
                                >
                                    OpenAI Compatible
                                </button>
                            </div>
                        </div>

                        {provider === 'openai' && (
                            <div className="p-3 border border-metal-grey bg-black/50 mb-4">
                                <label className="block text-hospital-white mb-1 text-xs">Target Endpoint (Base URL)</label>
                                <input
                                    type="text"
                                    value={baseUrl}
                                    onChange={(e) => setBaseUrl(e.target.value)}
                                    placeholder="https://api.openai.com/v1"
                                    className="w-full bg-black border border-metal-grey text-sickly-green p-2 text-sm focus:outline-none focus:border-sickly-green placeholder-gray-700 mb-2"
                                />

                                <label className="block text-hospital-white mb-1 text-xs">API Key</label>
                                <input
                                    type="password"
                                    value={apiKey}
                                    onChange={(e) => setApiKey(e.target.value)}
                                    placeholder="sk-..."
                                    className="w-full bg-black border border-metal-grey text-sickly-green p-2 text-sm focus:outline-none focus:border-sickly-green placeholder-gray-700 mb-2"
                                />

                                <div className="flex space-x-2 items-end">
                                    <div className="flex-1">
                                        <label className="block text-hospital-white mb-1 text-xs">Model</label>
                                        {availableModels.length > 0 ? (
                                            <select
                                                value={chatModel}
                                                onChange={(e) => setChatModel(e.target.value)}
                                                className="w-full bg-black border border-metal-grey text-sickly-green p-2 text-sm focus:outline-none focus:border-sickly-green"
                                            >
                                                <option value="" disabled>Select a model</option>
                                                {availableModels.map(m => (
                                                    <option key={m} value={m}>{m}</option>
                                                ))}
                                            </select>
                                        ) : (
                                            <input
                                                type="text"
                                                value={chatModel}
                                                onChange={(e) => setChatModel(e.target.value)}
                                                placeholder="e.g. gpt-4o"
                                                className="w-full bg-black border border-metal-grey text-sickly-green p-2 text-sm focus:outline-none focus:border-sickly-green placeholder-gray-700"
                                            />
                                        )}
                                    </div>
                                    <button
                                        onClick={handleFetchModels}
                                        disabled={isFetchingModels || !baseUrl || !apiKey}
                                        className="px-3 py-2 border border-metal-grey text-metal-grey text-xs hover:text-white hover:border-white transition-colors uppercase h-[38px] disabled:opacity-50"
                                    >
                                        {isFetchingModels ? "..." : "Fetch"}
                                    </button>
                                </div>
                            </div>
                        )}

                        {provider === 'gemini' && (
                            <>
                                <div>
                                    <label className="block text-hospital-white mb-1 text-sm">Target Endpoint (Base URL)</label>
                                    <input
                                        type="text"
                                        value={baseUrl}
                                        onChange={(e) => setBaseUrl(e.target.value)}
                                        placeholder="https://generativelanguage.googleapis.com"
                                        className="w-full bg-black border-2 border-metal-grey text-sickly-green p-2 focus:outline-none focus:border-sickly-green placeholder-gray-700"
                                    />
                                    <p className="text-xs text-metal-grey mt-1">Leave empty for default Google entry point.</p>
                                </div>
                                <div>
                                    <label className="block text-hospital-white mb-1 text-sm">Access Token (API Key)</label>
                                    <input
                                        type="password"
                                        value={apiKey}
                                        onChange={(e) => setApiKey(e.target.value)}
                                        placeholder="Enter your Gemini API Key"
                                        className="w-full bg-black border-2 border-metal-grey text-sickly-green p-2 focus:outline-none focus:border-sickly-green placeholder-gray-700"
                                    />
                                </div>
                            </>
                        )}
                    </div>

                    <div className="border-t border-metal-grey pt-4 mt-4">
                        <div className="flex items-center justify-between mb-3">
                            <label className="block text-hospital-white text-sm">启用画面渲染</label>
                            <button
                                onClick={() => setEnableImageGen(!enableImageGen)}
                                className={`relative w-12 h-6 rounded-sm border transition-colors duration-200 ${enableImageGen
                                    ? 'bg-sickly-green/30 border-sickly-green'
                                    : 'bg-black border-metal-grey'
                                    }`}
                            >
                                <div className={`absolute top-0.5 w-5 h-5 rounded-sm transition-all duration-200 ${enableImageGen
                                    ? 'left-[1.375rem] bg-sickly-green shadow-[0_0_6px_rgba(74,93,78,0.8)]'
                                    : 'left-0.5 bg-metal-grey'
                                    }`} />
                            </button>
                        </div>
                        {!enableImageGen && (
                            <p className="text-xs text-metal-grey mb-2 opacity-80">⚡ 已禁用图片生成，可节约 API 调用和 Token</p>
                        )}

                        <div className={`transition-opacity duration-300 ${enableImageGen ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
                            <label className="block text-hospital-white mb-2 text-sm">Image Generation Provider</label>
                            <div className="flex space-x-4 mb-4">
                                <button
                                    onClick={() => setImageProvider('pollinations')}
                                    className={`flex-1 py-2 text-sm border ${imageProvider === 'pollinations' ? 'bg-sickly-green text-black border-sickly-green' : 'border-metal-grey text-metal-grey hover:border-white'} transition-colors uppercase tracking-wider`}
                                >
                                    Pollinations
                                </button>
                                <button
                                    onClick={() => setImageProvider('openai')}
                                    className={`flex-1 py-2 text-sm border ${imageProvider === 'openai' ? 'bg-sickly-green text-black border-sickly-green' : 'border-metal-grey text-metal-grey hover:border-white'} transition-colors uppercase tracking-wider`}
                                >
                                    OpenAI Compatible
                                </button>
                            </div>

                            {imageProvider === 'pollinations' && (
                                <div>
                                    <label className="block text-hospital-white mb-1 text-sm">Pollinations Image API Key (Optional)</label>
                                    <input
                                        type="password"
                                        value={pollinationsApiKey}
                                        onChange={(e) => setPollinationsApiKey(e.target.value)}
                                        placeholder="Pollinations.ai Key (for higher limits)"
                                        className="w-full bg-black border-2 border-metal-grey text-sickly-green p-2 focus:outline-none focus:border-sickly-green placeholder-gray-700"
                                    />
                                    <div className="flex justify-end mt-2">
                                        <button
                                            onClick={handleTestImage}
                                            disabled={imageTestStatus === 'testing'}
                                            className="text-xs border border-metal-grey text-metal-grey px-2 py-1 hover:text-white hover:border-white transition-colors uppercase tracking-wider disabled:opacity-50"
                                        >
                                            {imageTestStatus === 'testing' ? 'Testing...' : 'Test Image'}
                                        </button>
                                    </div>
                                    {imageTestStatus !== 'idle' && (
                                        <div className={`text-xs mt-1 font-header tracking-widest text-right ${imageTestStatus === 'testing' ? 'text-yellow-500' :
                                            imageTestStatus === 'success' ? 'text-green-500' : 'text-red-500'
                                            }`}>
                                            {imageTestStatus === 'success' && "IMAGE API OK"}
                                            {imageTestStatus === 'error' && "IMAGE API FAILED"}
                                        </div>
                                    )}
                                </div>
                            )}

                            {imageProvider === 'openai' && (
                                <div className="p-3 border border-metal-grey bg-black/50 mb-4">
                                    {provider === 'openai' && (
                                        <p className="text-xs text-sickly-green mb-2 opacity-80">💡 留空则自动使用LLM的配置</p>
                                    )}
                                    <label className="block text-hospital-white mb-1 text-xs">Image Endpoint (Base URL)</label>
                                    <input
                                        type="text"
                                        value={imageBaseUrl}
                                        onChange={(e) => setImageBaseUrl(e.target.value)}
                                        placeholder="https://api.openai.com/v1"
                                        className="w-full bg-black border border-metal-grey text-sickly-green p-2 text-sm focus:outline-none focus:border-sickly-green placeholder-gray-700 mb-2"
                                    />

                                    <label className="block text-hospital-white mb-1 text-xs">Image API Key</label>
                                    <input
                                        type="password"
                                        value={imageApiKey}
                                        onChange={(e) => setImageApiKey(e.target.value)}
                                        placeholder="sk-..."
                                        className="w-full bg-black border border-metal-grey text-sickly-green p-2 text-sm focus:outline-none focus:border-sickly-green placeholder-gray-700 mb-2"
                                    />

                                    <div className="flex space-x-2 items-end">
                                        <div className="flex-1">
                                            <label className="block text-hospital-white mb-1 text-xs">Model</label>
                                            {availableImageModels.length > 0 ? (
                                                <select
                                                    value={imageModel}
                                                    onChange={(e) => setImageModel(e.target.value)}
                                                    className="w-full bg-black border border-metal-grey text-sickly-green p-2 text-sm focus:outline-none focus:border-sickly-green"
                                                >
                                                    <option value="" disabled>Select a model</option>
                                                    {availableImageModels.map(m => (
                                                        <option key={m} value={m}>{m}</option>
                                                    ))}
                                                </select>
                                            ) : (
                                                <input
                                                    type="text"
                                                    value={imageModel}
                                                    onChange={(e) => setImageModel(e.target.value)}
                                                    placeholder="e.g. dall-e-3"
                                                    className="w-full bg-black border border-metal-grey text-sickly-green p-2 text-sm focus:outline-none focus:border-sickly-green placeholder-gray-700"
                                                />
                                            )}
                                        </div>
                                        <button
                                            onClick={handleFetchImageModels}
                                            disabled={isFetchingImageModels || !imageBaseUrl || !imageApiKey}
                                            className="px-3 py-2 border border-metal-grey text-metal-grey text-xs hover:text-white hover:border-white transition-colors uppercase h-[38px] disabled:opacity-50"
                                        >
                                            {isFetchingImageModels ? "..." : "Fetch"}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div> {/* End of enableImageGen wrapper */}
                    </div>


                    {testStatus !== 'idle' && (
                        <div className={`text-xs mt-4 font-header tracking-widest text-center ${testStatus === 'testing' ? 'text-yellow-500' :
                            testStatus === 'success' ? 'text-green-500' : 'text-red-500'
                            }`}>
                            {testStatus === 'testing' && "TESTING CONNECTION..."}
                            {testStatus === 'success' && "CONNECTION VERIFIED"}
                            {testStatus === 'error' && "CONNECTION FAILED"}
                        </div>
                    )}

                    {/* Game Configuration Section */}
                    <div className="border-t border-metal-grey pt-4 mt-4">
                        <h3 className="text-hospital-white text-sm font-header uppercase tracking-wider mb-3">游戏参数</h3>

                        {/* Difficulty Presets */}
                        <label className="block text-hospital-white mb-2 text-xs">难度预设</label>
                        <div className="flex space-x-2 mb-4">
                            {(Object.keys(DIFFICULTY_PRESETS) as DifficultyPreset[]).map(preset => {
                                const isActive = localGameConfig.maxTurns === DIFFICULTY_PRESETS[preset].maxTurns &&
                                    localGameConfig.sanityPenaltyRule === DIFFICULTY_PRESETS[preset].sanityPenaltyRule;
                                return (
                                    <button
                                        key={preset}
                                        onClick={() => setLocalGameConfig({ ...DEFAULT_GAME_CONFIG, ...DIFFICULTY_PRESETS[preset] })}
                                        className={`flex-1 py-1.5 text-xs border transition-colors uppercase tracking-wider ${isActive
                                            ? 'bg-sickly-green text-black border-sickly-green'
                                            : 'border-metal-grey text-metal-grey hover:border-white hover:text-white'
                                            }`}
                                    >
                                        {DIFFICULTY_LABELS[preset]}
                                    </button>
                                );
                            })}
                        </div>

                        {/* Max Turns Slider */}
                        <div className="mb-3">
                            <label className="block text-hospital-white mb-1 text-xs">目标结束回合: <span className="text-sickly-green">{localGameConfig.maxTurns}</span></label>
                            <input
                                type="range"
                                min="10"
                                max="30"
                                value={localGameConfig.maxTurns}
                                onChange={(e) => setLocalGameConfig(prev => ({ ...prev, maxTurns: parseInt(e.target.value) }))}
                                className="w-full h-1 bg-metal-grey rounded-none appearance-none cursor-pointer accent-sickly-green"
                            />
                            <div className="flex justify-between text-[10px] text-metal-grey mt-0.5">
                                <span>10</span>
                                <span>20</span>
                                <span>30</span>
                            </div>
                        </div>

                        {/* Penalty Summary */}
                        <div className="bg-black/50 border border-metal-grey p-2 text-[10px] text-metal-grey space-y-0.5">
                            <div className="flex justify-between"><span>轻微冒险惩罚</span><span className="text-yellow-500">{localGameConfig.sanityPenaltyLight}</span></div>
                            <div className="flex justify-between"><span>违反规则惩罚</span><span className="text-orange-500">{localGameConfig.sanityPenaltyRule}</span></div>
                            <div className="flex justify-between"><span>严重违规惩罚</span><span className="text-red-500">{localGameConfig.sanityPenaltyFatal}</span></div>
                            <div className="flex justify-between"><span>安全选项上限</span><span>{Math.floor(localGameConfig.safeChoiceMaxRatio * 100)}%</span></div>
                        </div>
                    </div>
                </div>

                <div className="mt-8 flex justify-between items-center relative z-20 font-header shrink-0">
                    <button
                        onClick={handleTest}
                        disabled={testStatus === 'testing' || !apiKey}
                        className="px-4 py-2 border border-sickly-green text-sickly-green hover:bg-sickly-green hover:text-black transition-colors uppercase text-sm tracking-wider disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Test
                    </button>

                    <div className="flex space-x-4">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-metal-grey hover:text-hospital-white hover:bg-white/5 transition-colors uppercase text-sm tracking-wider"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSave}
                            className="px-6 py-2 bg-sickly-green text-black font-bold uppercase tracking-widest hover:bg-hospital-white hover:shadow-[0_0_15px_rgba(74,93,78,0.8)] transition-all border border-transparent hover:border-sickly-green"
                        >
                            Confirm
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
