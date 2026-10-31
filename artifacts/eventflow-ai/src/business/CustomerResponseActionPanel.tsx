import { useState } from "react";
import { CheckCircle2, RotateCcw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  confirmCustomerSelection,
  generateCustomerRevision,
  type CustomerResponseAction,
} from "./customerResponseActions";
import type { CustomerResponseRecord } from "@/customer/customerResponseTypes";

type Props = {
  response: CustomerResponseRecord;
  action?: CustomerResponseAction;
  workflowError?: string;
  onSaved: (action?: CustomerResponseAction) => void;
};

const workflowRpc = (name: string, args: Record<string, unknown>) =>
  supabase.rpc(name, args as never) as unknown as Promise<{
    data: unknown;
    error: { code?: string; message?: string } | null;
  }>;

export default function CustomerResponseActionPanel({ response, action, workflowError, onSaved }: Props) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [localAction, setLocalAction] = useState<CustomerResponseAction>();
  const [generatedRevision, setGeneratedRevision] = useState("");
  const current = action ?? localAction;

  const act = async () => {
    if (busy || workflowError) return;
    setBusy(true);
    setError("");
    try {
      if (response.response_kind === "change_request") {
        const session = await supabase.auth.getSession();
        const token = session.data.session?.access_token;
        if (session.error || !token) throw new Error("Sign in again before starting revised proposals.");
        const result = await generateCustomerRevision(token, {
          requestId: response.request_id,
          responseId: response.id,
        });
        setGeneratedRevision(result.revision);
        onSaved();
      } else {
        const saved = await confirmCustomerSelection(workflowRpc, {
          requestId: response.request_id,
          responseId: response.id,
          message,
        });
        setLocalAction(saved);
        onSaved(saved);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The action could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  if (response.response_kind === "change_request") {
    const queued = current?.action_kind === "revision" ? current : undefined;
    return (
      <div className="mt-4 border-t border-[#f1edf1] pt-4" data-testid={`response-action-${response.id}`}>
        {workflowError && <p role="alert" className="mb-3 text-[11px] text-[#a34e58]">{workflowError}</p>}
        {error && <p role="alert" className="mb-3 text-[11px] text-[#a34e58]">{error}</p>}
        {generatedRevision || queued?.status === "business_review" || queued?.status === "released" ? (
          <p role="status" className="text-[11px] font-semibold text-[#64806b]" data-testid="status-revision-queued">
            Revision {generatedRevision || queued?.next_revision} saved. Review and approve both revised plans before the Customer responds.
          </p>
        ) : queued?.generation_error_code ? (
          <p role="alert" className="text-[11px] text-[#a34e58]">
            This revision's AI attempt failed. No automatic paid retry will be made.
          </p>
        ) : (
          <>
          {queued?.status !== "generating" && <p className="mb-2 text-[11px] text-[#756b7b]">
            Uses one AI attempt from the shared quota. No automatic paid retries.
          </p>}
          {queued?.status === "generating" && <p className="mb-2 text-[11px]">
            This revision has a generation reservation. Checking again can recover saved output, but will not submit another AI job.
          </p>}
          <button
            type="button"
            disabled={busy || Boolean(workflowError)}
            onClick={() => void act()}
            className="inline-flex items-center gap-2 rounded-xl bg-[#bb7d99] px-4 py-3 text-xs font-bold text-white disabled:opacity-50"
            data-testid={`button-start-revised-proposals-${response.id}`}
          >
            <RotateCcw size={14} />
            {busy ? "Generating revised plans…" : queued?.status === "generating" ? "Check revised proposals" : "Start Revised Proposals"}
          </button>
          </>
        )}
      </div>
    );
  }

  const confirmed = current?.action_kind === "selection_confirmation" ? current : undefined;
  return (
    <div className="mt-4 border-t border-[#f1edf1] pt-4" data-testid={`response-action-${response.id}`}>
      {workflowError && <p role="alert" className="mb-3 text-[11px] text-[#a34e58]">{workflowError}</p>}
      {error && <p role="alert" className="mb-3 text-[11px] text-[#a34e58]">{error}</p>}
      {confirmed ? (
        <p role="status" className="flex items-center gap-2 text-[11px] font-semibold text-[#64806b]" data-testid="status-selection-confirmed">
          <CheckCircle2 size={14} />
          Plan selection confirmed by Business.
        </p>
      ) : (
        <>
          <label className="mb-2 block text-[10px] font-semibold text-[#756b7b]" htmlFor={`confirmation-${response.id}`}>
            Optional confirmation message
          </label>
          <textarea
            id={`confirmation-${response.id}`}
            value={message}
            maxLength={4000}
            onChange={event => setMessage(event.target.value)}
            className="mb-3 w-full rounded-xl border border-[#e7dfe9] bg-white p-3 text-xs"
            placeholder="Add a note for the customer"
            data-testid={`input-confirmation-message-${response.id}`}
          />
          <button
            type="button"
            disabled={busy || Boolean(workflowError)}
            onClick={() => void act()}
            className="inline-flex items-center gap-2 rounded-xl bg-[#bb7d99] px-4 py-3 text-xs font-bold text-white disabled:opacity-50"
            data-testid={`button-confirm-customer-selection-${response.id}`}
          >
            <CheckCircle2 size={14} />
            {busy ? "Confirming…" : "Confirm Customer Selection"}
          </button>
        </>
      )}
    </div>
  );
}
