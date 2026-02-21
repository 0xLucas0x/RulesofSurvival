'use client';

import { FormEvent, useMemo, useState } from 'react';
import Link from 'next/link';
import '../../lib/i18n';
import { useTranslation } from 'react-i18next';
import { redeemGuestInvite } from '../../services/geminiService';

const mapInviteError = (code: string, t: (key: string) => string): string => {
  switch (code) {
    case 'invite_code_required':
      return t('auth.errors.invite_code_required');
    case 'invite_code_invalid':
      return t('auth.errors.invite_code_invalid');
    case 'invite_code_not_found':
      return t('auth.errors.invite_code_not_found');
    case 'invite_code_used':
      return t('auth.errors.invite_code_used');
    case 'invite_code_expired':
      return t('auth.errors.invite_code_expired');
    case 'invite_code_revoked':
      return t('auth.errors.invite_code_revoked');
    case 'rate limit exceeded':
      return t('auth.errors.rate_limited');
    default:
      return t('auth.errors.guest_redeem_failed');
  }
};

export default function GuestPage() {
  const { t } = useTranslation();
  const [inviteCode, setInviteCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalizedDisplayCode = useMemo(() => {
    const compact = inviteCode.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
    const groups = compact.match(/.{1,4}/g);
    return groups ? groups.join('-') : compact;
  }, [inviteCode]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;

    setError(null);
    setIsSubmitting(true);
    try {
      await redeemGuestInvite(inviteCode);
      window.location.href = '/game';
    } catch (e: any) {
      const code = String(e?.message || '').toLowerCase();
      setError(mapInviteError(code, (key) => t(key)));
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen w-screen bg-black text-gray-200 flex items-center justify-center px-4">
      <div className="w-full max-w-md border border-amber-600/40 bg-black/70 backdrop-blur-sm p-6 md:p-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl md:text-2xl font-header tracking-[0.16em] text-amber-300 uppercase">
            {t('auth.guest_entry')}
          </h1>
          <Link href="/" className="text-xs text-gray-400 hover:text-white uppercase tracking-widest">
            {t('auth.back')}
          </Link>
        </div>

        <p className="text-sm text-gray-400 mb-4">{t('auth.invite_hint')}</p>

        <form className="space-y-4" onSubmit={onSubmit}>
          <label className="block">
            <span className="text-xs uppercase tracking-[0.16em] text-gray-500">{t('auth.invite_code')}</span>
            <input
              value={normalizedDisplayCode}
              onChange={(e) => setInviteCode(e.target.value)}
              placeholder={t('auth.invite_code_placeholder')}
              autoComplete="off"
              spellCheck={false}
              className="mt-2 w-full bg-black border border-gray-700 focus:border-amber-400 outline-none px-3 py-3 text-amber-100 tracking-[0.14em] uppercase font-tech"
            />
          </label>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full px-4 py-3 bg-amber-900/70 hover:bg-amber-800/80 border border-amber-500 text-amber-100 uppercase tracking-[0.16em] font-header disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? t('auth.redeeming_invite') : t('auth.redeem_invite')}
          </button>

          {error && (
            <div className="text-sm text-red-400 border border-red-900/60 bg-red-950/20 px-3 py-2">
              {error}
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
