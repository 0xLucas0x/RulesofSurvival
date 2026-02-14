'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  addNftRequirementAdmin,
  addTokenRequirementAdmin,
  addUnlockWhitelist,
  fetchAdminConfig,
  fetchUnlockPolicy,
  removeNftRequirementAdmin,
  removeTokenRequirementAdmin,
  removeUnlockWhitelist,
  updateAdminConfig,
  updateUnlockPolicy,
} from '../../services/geminiService';

export default function AdminPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [config, setConfig] = useState<any>(null);
  const [policyData, setPolicyData] = useState<any>(null);

  const [newWhitelist, setNewWhitelist] = useState('');
  const [newNft, setNewNft] = useState({ contractAddress: '', tokenStandard: 'erc721', tokenId: '', minBalance: '1' });
  const [newToken, setNewToken] = useState({ contractAddress: '', minBalanceRaw: '1', decimals: 18 });

  const loadAll = async () => {
    setLoading(true);
    setError(null);
    try {
      const [cfg, policy] = await Promise.all([fetchAdminConfig(), fetchUnlockPolicy()]);
      setConfig(cfg);
      setPolicyData(policy);
    } catch (e: any) {
      setError(e?.message || 'Failed to load admin data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
  }, []);

  const gameConfig = useMemo(() => {
    return config?.gameConfig || {};
  }, [config]);

  const saveConfig = async () => {
    if (!config) return;
    setSaving(true);
    setError(null);
    setOk(null);
    try {
      await updateAdminConfig(config);
      setOk('Config saved');
      await loadAll();
    } catch (e: any) {
      setError(e?.message || 'Failed to save config');
    } finally {
      setSaving(false);
    }
  };

  const savePolicy = async () => {
    if (!policyData?.policy) return;
    setSaving(true);
    setError(null);
    setOk(null);
    try {
      await updateUnlockPolicy({
        enabled: policyData.policy.enabled,
        chainId: Number(policyData.policy.chainId || 10143),
      });
      setOk('Policy saved');
      await loadAll();
    } catch (e: any) {
      setError(e?.message || 'Failed to save unlock policy');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen bg-black text-gray-200 p-8">Loading admin panel...</div>;
  }

  return (
    <div className="min-h-screen bg-black text-gray-200 p-6 md:p-10 space-y-8">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl md:text-3xl font-bold tracking-wide">Admin Console</h1>
        <a href="/" className="px-4 py-2 border border-gray-600 hover:border-white">Back to Game</a>
      </div>

      {error && <div className="p-3 border border-red-700 bg-red-950/40 text-red-300">{error}</div>}
      {ok && <div className="p-3 border border-emerald-700 bg-emerald-950/40 text-emerald-300">{ok}</div>}

      <section className="border border-gray-700 p-5 space-y-4">
        <h2 className="text-xl font-semibold">Runtime Config</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="text-sm">LLM Provider
            <select
              className="w-full mt-1 bg-black border border-gray-600 p-2"
              value={config?.llmProvider || 'gemini'}
              onChange={(e) => setConfig((prev: any) => ({ ...prev, llmProvider: e.target.value }))}
            >
              <option value="gemini">gemini</option>
              <option value="openai">openai</option>
            </select>
          </label>

          <label className="text-sm">LLM Model
            <input
              className="w-full mt-1 bg-black border border-gray-600 p-2"
              value={config?.llmModel || ''}
              onChange={(e) => setConfig((prev: any) => ({ ...prev, llmModel: e.target.value }))}
            />
          </label>

          <label className="text-sm">LLM Base URL
            <input
              className="w-full mt-1 bg-black border border-gray-600 p-2"
              value={config?.llmBaseUrl || ''}
              onChange={(e) => setConfig((prev: any) => ({ ...prev, llmBaseUrl: e.target.value }))}
            />
          </label>

          <label className="text-sm">LLM API Key
            <input
              type="password"
              className="w-full mt-1 bg-black border border-gray-600 p-2"
              value={config?.llmApiKey || ''}
              onChange={(e) => setConfig((prev: any) => ({ ...prev, llmApiKey: e.target.value }))}
            />
          </label>

          <label className="text-sm">Image Provider
            <select
              className="w-full mt-1 bg-black border border-gray-600 p-2"
              value={config?.imageProvider || 'pollinations'}
              onChange={(e) => setConfig((prev: any) => ({ ...prev, imageProvider: e.target.value }))}
            >
              <option value="pollinations">pollinations</option>
              <option value="openai">openai</option>
            </select>
          </label>

          <label className="text-sm">Image Model
            <input
              className="w-full mt-1 bg-black border border-gray-600 p-2"
              value={config?.imageModel || ''}
              onChange={(e) => setConfig((prev: any) => ({ ...prev, imageModel: e.target.value }))}
            />
          </label>

          <label className="text-sm">Image Base URL
            <input
              className="w-full mt-1 bg-black border border-gray-600 p-2"
              value={config?.imageBaseUrl || ''}
              onChange={(e) => setConfig((prev: any) => ({ ...prev, imageBaseUrl: e.target.value }))}
            />
          </label>

          <label className="text-sm">Image API Key
            <input
              type="password"
              className="w-full mt-1 bg-black border border-gray-600 p-2"
              value={config?.imageApiKey || ''}
              onChange={(e) => setConfig((prev: any) => ({ ...prev, imageApiKey: e.target.value }))}
            />
          </label>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <label className="text-sm">maxTurns
            <input
              type="number"
              className="w-full mt-1 bg-black border border-gray-600 p-2"
              value={gameConfig.maxTurns ?? 12}
              onChange={(e) =>
                setConfig((prev: any) => ({
                  ...prev,
                  gameConfig: { ...(prev.gameConfig || {}), maxTurns: Number(e.target.value) },
                }))
              }
            />
          </label>

          <label className="text-sm">sanityPenaltyLight
            <input
              type="number"
              className="w-full mt-1 bg-black border border-gray-600 p-2"
              value={gameConfig.sanityPenaltyLight ?? -8}
              onChange={(e) =>
                setConfig((prev: any) => ({
                  ...prev,
                  gameConfig: { ...(prev.gameConfig || {}), sanityPenaltyLight: Number(e.target.value) },
                }))
              }
            />
          </label>

          <label className="text-sm">sanityPenaltyRule
            <input
              type="number"
              className="w-full mt-1 bg-black border border-gray-600 p-2"
              value={gameConfig.sanityPenaltyRule ?? -25}
              onChange={(e) =>
                setConfig((prev: any) => ({
                  ...prev,
                  gameConfig: { ...(prev.gameConfig || {}), sanityPenaltyRule: Number(e.target.value) },
                }))
              }
            />
          </label>

          <label className="text-sm">sanityPenaltyFatal
            <input
              type="number"
              className="w-full mt-1 bg-black border border-gray-600 p-2"
              value={gameConfig.sanityPenaltyFatal ?? -80}
              onChange={(e) =>
                setConfig((prev: any) => ({
                  ...prev,
                  gameConfig: { ...(prev.gameConfig || {}), sanityPenaltyFatal: Number(e.target.value) },
                }))
              }
            />
          </label>

          <label className="text-sm">safeChoiceMaxRatio
            <input
              type="number"
              step="0.01"
              className="w-full mt-1 bg-black border border-gray-600 p-2"
              value={gameConfig.safeChoiceMaxRatio ?? 0.5}
              onChange={(e) =>
                setConfig((prev: any) => ({
                  ...prev,
                  gameConfig: { ...(prev.gameConfig || {}), safeChoiceMaxRatio: Number(e.target.value) },
                }))
              }
            />
          </label>
        </div>

        <button onClick={saveConfig} disabled={saving} className="px-4 py-2 bg-blue-900 hover:bg-blue-700 border border-blue-500">
          Save Runtime Config
        </button>
      </section>

      <section className="border border-gray-700 p-5 space-y-4">
        <h2 className="text-xl font-semibold">Image Unlock Policy</h2>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={!!policyData?.policy?.enabled}
            onChange={(e) =>
              setPolicyData((prev: any) => ({ ...prev, policy: { ...(prev.policy || {}), enabled: e.target.checked } }))
            }
          />
          Enable unlock gate
        </label>

        <label className="text-sm block">Chain ID
          <input
            type="number"
            className="w-full mt-1 bg-black border border-gray-600 p-2 max-w-xs"
            value={policyData?.policy?.chainId || 10143}
            onChange={(e) =>
              setPolicyData((prev: any) => ({ ...prev, policy: { ...(prev.policy || {}), chainId: Number(e.target.value) } }))
            }
          />
        </label>

        <button onClick={savePolicy} disabled={saving} className="px-4 py-2 bg-blue-900 hover:bg-blue-700 border border-blue-500">
          Save Policy
        </button>

        <div className="pt-3 border-t border-gray-700">
          <h3 className="font-semibold mb-2">Whitelist</h3>
          <div className="flex gap-2 mb-3">
            <input
              className="flex-1 bg-black border border-gray-600 p-2"
              placeholder="0x..."
              value={newWhitelist}
              onChange={(e) => setNewWhitelist(e.target.value)}
            />
            <button
              className="px-3 py-2 border border-emerald-600 bg-emerald-900/40"
              onClick={async () => {
                await addUnlockWhitelist(newWhitelist);
                setNewWhitelist('');
                await loadAll();
              }}
            >
              Add
            </button>
          </div>

          <div className="space-y-2 text-sm">
            {(policyData?.whitelist || []).map((w: any) => (
              <div key={w.id} className="flex items-center justify-between border border-gray-800 p-2">
                <span>{w.walletAddress}</span>
                <button className="text-red-400" onClick={async () => { await removeUnlockWhitelist(w.walletAddress); await loadAll(); }}>
                  remove
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="pt-3 border-t border-gray-700 space-y-3">
          <h3 className="font-semibold">NFT Requirements</h3>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
            <input
              className="bg-black border border-gray-600 p-2"
              placeholder="contract"
              value={newNft.contractAddress}
              onChange={(e) => setNewNft((p) => ({ ...p, contractAddress: e.target.value }))}
            />
            <select
              className="bg-black border border-gray-600 p-2"
              value={newNft.tokenStandard}
              onChange={(e) => setNewNft((p) => ({ ...p, tokenStandard: e.target.value }))}
            >
              <option value="erc721">erc721</option>
              <option value="erc1155">erc1155</option>
            </select>
            <input
              className="bg-black border border-gray-600 p-2"
              placeholder="tokenId(optional)"
              value={newNft.tokenId}
              onChange={(e) => setNewNft((p) => ({ ...p, tokenId: e.target.value }))}
            />
            <input
              className="bg-black border border-gray-600 p-2"
              placeholder="minBalance"
              value={newNft.minBalance}
              onChange={(e) => setNewNft((p) => ({ ...p, minBalance: e.target.value }))}
            />
          </div>
          <button
            className="px-3 py-2 border border-emerald-600 bg-emerald-900/40"
            onClick={async () => {
              await addNftRequirementAdmin(newNft as any);
              setNewNft({ contractAddress: '', tokenStandard: 'erc721', tokenId: '', minBalance: '1' });
              await loadAll();
            }}
          >
            Add NFT Requirement
          </button>

          <div className="space-y-2 text-sm">
            {(policyData?.nftRequirements || []).map((n: any) => (
              <div key={n.id} className="flex items-center justify-between border border-gray-800 p-2">
                <span>{n.tokenStandard} {n.contractAddress} tokenId={n.tokenId || '*'} min={n.minBalance}</span>
                <button className="text-red-400" onClick={async () => { await removeNftRequirementAdmin(n.id); await loadAll(); }}>
                  remove
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="pt-3 border-t border-gray-700 space-y-3">
          <h3 className="font-semibold">Token Requirements</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <input
              className="bg-black border border-gray-600 p-2"
              placeholder="contract"
              value={newToken.contractAddress}
              onChange={(e) => setNewToken((p) => ({ ...p, contractAddress: e.target.value }))}
            />
            <input
              className="bg-black border border-gray-600 p-2"
              placeholder="minBalanceRaw"
              value={newToken.minBalanceRaw}
              onChange={(e) => setNewToken((p) => ({ ...p, minBalanceRaw: e.target.value }))}
            />
            <input
              type="number"
              className="bg-black border border-gray-600 p-2"
              placeholder="decimals"
              value={newToken.decimals}
              onChange={(e) => setNewToken((p) => ({ ...p, decimals: Number(e.target.value) }))}
            />
          </div>
          <button
            className="px-3 py-2 border border-emerald-600 bg-emerald-900/40"
            onClick={async () => {
              await addTokenRequirementAdmin(newToken as any);
              setNewToken({ contractAddress: '', minBalanceRaw: '1', decimals: 18 });
              await loadAll();
            }}
          >
            Add Token Requirement
          </button>

          <div className="space-y-2 text-sm">
            {(policyData?.tokenRequirements || []).map((n: any) => (
              <div key={n.id} className="flex items-center justify-between border border-gray-800 p-2">
                <span>{n.contractAddress} min={n.minBalanceRaw} decimals={n.decimals}</span>
                <button className="text-red-400" onClick={async () => { await removeTokenRequirementAdmin(n.id); await loadAll(); }}>
                  remove
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
