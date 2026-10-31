import { useState } from "react";
import { buildProposalPlanContent, createProposalPlanDraft, type PlanKey, type ProposalPlanDraft } from "./proposalEditorModel";
import { savePendingAIProposal } from "@/lib/submissionMvp";

type Props = {
  requestId: string;
  revision: string;
  planKey: PlanKey;
  planContent: unknown;
  onCancel: () => void;
  onSaved: () => void;
};

const inputClass = "w-full rounded-lg border border-[#eee7ef] bg-white px-3 py-2 text-[11px] text-[#5f5564] focus:border-[#c9a9d1] focus:outline-none";

export default function ProposalEditor({ requestId, revision, planKey, planContent, onCancel, onSaved }: Props) {
  const [initial] = useState(() => {
    try {
      return { draft: createProposalPlanDraft(planContent, planKey), error: "" };
    } catch (cause) {
      return { draft: null, error: cause instanceof Error ? cause.message : "Saved proposal content cannot be edited safely." };
    }
  });
  const [draft, setDraft] = useState<ProposalPlanDraft | null>(initial.draft);
  const [error, setError] = useState(initial.error);
  const [saving, setSaving] = useState(false);
  if (!draft) return <div className="mt-3 rounded-xl border border-[#efcfd1] bg-[#fff8f8] p-4 text-[11px] text-[#a34e58]" role="alert">
    {error} <button type="button" className="ml-2 font-bold underline" onClick={onCancel}>Close</button>
  </div>;
  const patch = (changes: Partial<ProposalPlanDraft>) => setDraft((current) => current ? ({ ...current, ...changes }) : current);
  const total = draft.costBreakdown.reduce((sum, row) => {
    const amount = Number(row.amountMYR);
    return sum + (Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : 0);
  }, 0) / 100;

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError("");
    let saved = false;
    try {
      const content = buildProposalPlanContent(draft);
      await savePendingAIProposal(requestId, revision, planKey, content);
      saved = true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Plan changes could not be saved.");
    } finally {
      setSaving(false);
    }
    if (saved) onSaved();
  };

  const updateTimeline = (index: number, key: "time" | "activity", value: string) =>
    patch({ timeline: draft.timeline.map((item, i) => i === index ? { ...item, [key]: value } : item) });
  const updateCost = (index: number, key: "item" | "description" | "amountMYR", value: string) =>
    patch({ costBreakdown: draft.costBreakdown.map((item, i) => i === index ? { ...item, [key]: value } : item) });

  return (
    <div className="mt-3 space-y-4 rounded-xl border border-[#e7dfe9] bg-[#fdfbfd] p-4" data-testid={`proposal-editor-${planKey}`}>
      <p className="text-[10px] leading-relaxed text-[#8c8190]">
        Editing is available only while both plans are pending. Saving updates this plan’s content and calculated total; it does not approve or release the pair.
      </p>
      {error && <p role="alert" className="rounded-lg bg-[#fff4f4] p-3 text-[11px] text-[#a34e58]">{error}</p>}

      <label className="block text-[10px] font-semibold text-[#756b7b]">Plan title
        <input className={inputClass} maxLength={160} value={draft.title} onChange={(event) => patch({ title: event.target.value })} />
      </label>
      <label className="block text-[10px] font-semibold text-[#756b7b]">Concept
        <textarea className={inputClass} rows={3} maxLength={2000} value={draft.concept} onChange={(event) => patch({ concept: event.target.value })} />
      </label>
      <label className="block text-[10px] font-semibold text-[#756b7b]">Theme
        <textarea className={inputClass} rows={2} maxLength={500} value={draft.theme} onChange={(event) => patch({ theme: event.target.value })} />
      </label>

      <fieldset className="space-y-2">
        <legend className="text-[10px] font-bold uppercase tracking-wide text-[#887d8d]">Timeline</legend>
        {draft.timeline.map((item, index) => (
          <div key={index} className="grid gap-2 sm:grid-cols-[120px_1fr_auto]">
            <input aria-label={`Timeline time ${index + 1}`} className={inputClass} maxLength={80} value={item.time} onChange={(event) => updateTimeline(index, "time", event.target.value)} />
            <input aria-label={`Timeline activity ${index + 1}`} className={inputClass} maxLength={500} value={item.activity} onChange={(event) => updateTimeline(index, "activity", event.target.value)} />
            <button type="button" className="px-2 text-[10px] font-semibold text-[#9a647f]" disabled={draft.timeline.length <= 1} onClick={() => patch({ timeline: draft.timeline.filter((_, i) => i !== index) })}>Remove</button>
          </div>
        ))}
        <button type="button" className="text-[10px] font-semibold text-[#86648f]" disabled={draft.timeline.length >= 40} onClick={() => patch({ timeline: [...draft.timeline, { time: "", activity: "" }] })}>+ Add timeline item</button>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-[10px] font-semibold text-[#756b7b]">Venue
          <input className={inputClass} maxLength={240} value={draft.venue.name} onChange={(event) => patch({ venue: { ...draft.venue, name: event.target.value } })} />
        </label>
        <label className="block text-[10px] font-semibold text-[#756b7b]">Venue setup
          <textarea className={inputClass} rows={2} maxLength={2000} value={draft.venue.setup} onChange={(event) => patch({ venue: { ...draft.venue, setup: event.target.value } })} />
        </label>
      </div>
      <label className="block text-[10px] font-semibold text-[#756b7b]">Catering
        <textarea className={inputClass} rows={2} maxLength={2000} value={draft.catering} onChange={(event) => patch({ catering: event.target.value })} />
      </label>

      <fieldset className="space-y-2">
        <legend className="text-[10px] font-bold uppercase tracking-wide text-[#887d8d]">Services</legend>
        {draft.services.map((service, index) => (
          <div key={index} className="flex gap-2">
            <input aria-label={`Service ${index + 1}`} className={inputClass} maxLength={200} value={service} onChange={(event) => patch({ services: draft.services.map((item, i) => i === index ? event.target.value : item) })} />
            <button type="button" className="px-2 text-[10px] font-semibold text-[#9a647f]" disabled={draft.services.length <= 1} onClick={() => patch({ services: draft.services.filter((_, i) => i !== index) })}>Remove</button>
          </div>
        ))}
        <button type="button" className="text-[10px] font-semibold text-[#86648f]" disabled={draft.services.length >= 40} onClick={() => patch({ services: [...draft.services, ""] })}>+ Add service</button>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-[10px] font-bold uppercase tracking-wide text-[#887d8d]">Cost breakdown (MYR)</legend>
        {draft.costBreakdown.map((item, index) => (
          <div key={index} className="grid gap-2 rounded-lg border border-[#eee7ef] bg-white p-2 sm:grid-cols-[1fr_1.4fr_110px_auto]">
            <input aria-label={`Cost item ${index + 1}`} className={inputClass} maxLength={160} value={item.item} onChange={(event) => updateCost(index, "item", event.target.value)} />
            <input aria-label={`Cost description ${index + 1}`} className={inputClass} maxLength={500} value={item.description} onChange={(event) => updateCost(index, "description", event.target.value)} />
            <input aria-label={`Cost amount ${index + 1}`} className={inputClass} type="number" min="0" max="100000000" step="0.01" value={item.amountMYR} onChange={(event) => updateCost(index, "amountMYR", event.target.value)} />
            <button type="button" className="px-2 text-[10px] font-semibold text-[#9a647f]" disabled={draft.costBreakdown.length <= 1} onClick={() => patch({ costBreakdown: draft.costBreakdown.filter((_, i) => i !== index) })}>Remove</button>
          </div>
        ))}
        <button type="button" className="text-[10px] font-semibold text-[#86648f]" disabled={draft.costBreakdown.length >= 80} onClick={() => patch({ costBreakdown: [...draft.costBreakdown, { item: "", description: "", amountMYR: "0" }] })}>+ Add cost item</button>
      </fieldset>

      <div className="flex items-center justify-between rounded-lg bg-white px-3 py-2">
        <span className="text-[11px] font-bold text-[#65596a]">Calculated total</span>
        <span className="text-[13px] font-bold text-[#684b74]" data-testid={`proposal-editor-total-${planKey}`}>
          RM {total.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
      </div>
      <div className="flex justify-end gap-2 border-t border-[#eee7ef] pt-3">
        <button type="button" className="rounded-lg border border-[#e7dfe9] px-3 py-2 text-[10px] font-semibold" disabled={saving} onClick={onCancel}>Cancel</button>
        <button type="button" className="rounded-lg bg-[#bb7d99] px-3 py-2 text-[10px] font-bold text-white disabled:opacity-50" disabled={saving} onClick={() => void save()} data-testid={`button-save-plan-${planKey}`}>
          {saving ? "Saving…" : "Save Changes"}
        </button>
      </div>
    </div>
  );
}
