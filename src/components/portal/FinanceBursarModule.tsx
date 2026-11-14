import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, RefreshCcw, Receipt } from 'lucide-react';
import type { UserProfile } from '../../types';

interface FinanceBursarModuleProps { currentUser: UserProfile }
type FinanceSummary = {
  source: 'persisted-records';
  asOf: string;
  finance: { billedCents: number; creditsCents: number; reconciledCents: number };
};
const format = (cents: number) => (cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Read-only institution-level financial overview. Payment and adjustment posting require
 * an authenticated Bursar workflow tied to a real invoice, approved policy and reference.
 * Never load an arbitrary demonstration student or suggest a payment was reconciled. */
export const FinanceBursarModule: React.FC<FinanceBursarModuleProps> = ({ currentUser }) => {
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const reload = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/analytics/overview', { credentials: 'same-origin', cache: 'no-store', signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not retrieve financial records.');
      if (data.source !== 'persisted-records' || !data.finance) throw new Error('Verified financial summary unavailable.');
      if (!signal?.aborted) setSummary(data as FinanceSummary);
    } catch (e) {
      if (!signal?.aborted) { setSummary(null); setError(e instanceof Error ? e.message : 'Unable to load financial records.'); }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void reload(controller.signal);
    return () => controller.abort();
  }, [reload]);
  useEffect(() => {
    const refresh = () => void reload();
    window.addEventListener('hiau:finance-data-changed', refresh);
    return () => window.removeEventListener('hiau:finance-data-changed', refresh);
  }, [reload]);
  const outstanding = summary ? Math.max(0, summary.finance.billedCents - summary.finance.creditsCents - summary.finance.reconciledCents) : 0;
  return <section className="space-y-4 rounded-2xl border border-[#ded1e3] bg-white p-5 text-[#35103b] shadow-sm" aria-label="Finance overview">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-bold"><Receipt size={22} aria-hidden="true"/> University Finance Overview</h2>
        <p className="mt-1 text-sm text-slate-700">Read-only totals from recorded invoices, credit notes, and reconciled payments. No demonstration student ledger is displayed.</p>
      </div>
      <button type="button" disabled={loading} onClick={() => void reload()} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[#4a1249] px-4 py-2 text-sm font-semibold !text-white hover:bg-[#35103b] hover:!text-white disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4a1249]"><RefreshCcw size={17} aria-hidden="true"/> Refresh finance</button>
    </div>
    {loading && <p role="status" className="rounded-lg bg-[#faf8fb] p-5 text-sm text-slate-700">Loading verified financial totals…</p>}
    {!loading && error && <div role="alert" className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"><AlertCircle size={18} aria-hidden="true"/><span>{error} Please check the signed-in session and backend deployment.</span></div>}
    {!loading && summary && <>
      <p className="text-xs text-slate-600">Database snapshot: {new Date(summary.asOf).toLocaleString()}</p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['Posted invoices', summary.finance.billedCents],
          ['Posted credit notes', summary.finance.creditsCents],
          ['Reconciled payments', summary.finance.reconciledCents],
          ['Outstanding amount', outstanding],
        ].map(([label, cents]) => <div className="rounded-xl border border-[#ded1e3] p-4" key={String(label)}>
          <p className="text-sm font-semibold text-[#4a1249]">{label}</p>
          <p className="mt-2 text-2xl font-bold tabular-nums">{format(Number(cents))}</p>
        </div>)}
      </div>
      <p className="text-sm text-slate-700">Amounts are in the ledger's configured monetary units. Individual student balances, fee awards, payment posting, and receipt creation must use a verified student/invoice and an authorized Bursar workflow.</p>
    </>}
    <p className="border-t border-[#ded1e3] pt-3 text-xs text-slate-600">Role: {currentUser.role.replaceAll('_', ' ')}. Finance handoff and student assistance review are displayed in their separate authorized panels below.</p>
  </section>;
};
