import type { CustomerResponseRecord } from "@/customer/customerResponseTypes";
import type { CustomerResponseAction } from "./customerResponseActions";
import CustomerResponseActionPanel from "./CustomerResponseActionPanel";
import { buildCustomerResponseQueue } from "./customerResponseQueue";

type RequestSummary = { id: string; customer: string; name: string };
type ProposalSummary = { requestId: string; revision?: string; customer: string; event: string };

export default function CustomerResponsesQueue({ responses, actions, requests, proposals, error, onSaved }: {
  responses: CustomerResponseRecord[];
  actions: CustomerResponseAction[];
  requests: RequestSummary[];
  proposals: ProposalSummary[];
  error?: string;
  onSaved: () => void;
}) {
  const entries = buildCustomerResponseQueue(responses, actions, proposals);
  const pending = entries.filter(entry => entry.actionable);
  const completed = entries.filter(entry => !entry.actionable);
  return (
    <section className="mb-6 space-y-4" data-testid="customer-responses-queue">
      <div>
        <h2 className="text-[15px] font-bold text-[#5d5263]">Customer Responses</h2>
        <p className="mt-1 text-[11px] text-[#918695]">
          Review Customer selections and Change Requests. {pending.length} awaiting action.
        </p>
      </div>
      {error && <p role="alert" className="rounded-xl border border-[#efcfd1] bg-[#fff4f4] p-4 text-xs text-[#a34e58]">{error}</p>}
      {!entries.length && !error && <p className="rounded-xl border border-[#eee7ef] bg-white p-5 text-[12px] text-[#918695]">No Customer responses yet.</p>}
      {[...pending, ...completed].map(({ response, action, status, actionable }) => {
        const request = requests.find(item => item.id === response.request_id);
        const proposal = proposals.find(item => item.requestId === response.request_id && item.revision === response.revision);
        return (
          <div key={response.id} className="rounded-2xl border border-[#eee7ef] bg-white p-4 md:p-5" data-testid={`card-customer-response-${response.id}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-[12px] font-bold text-[#5d5263]">{request?.customer || proposal?.customer || "Customer"} — {request?.name || proposal?.event || "Event name unavailable"}</h3>
                <p className="mt-2 text-[12px] font-semibold text-[#756b7b]">
                  {response.response_kind === "selection"
                    ? `Customer selected Plan ${response.selected_proposal_id === response.plan_a_id ? "A" : "B"}`
                    : "Change Request"}
                </p>
              </div>
              <span className="rounded-full bg-[#f7f1f8] px-3 py-2 text-[10px] font-semibold text-[#866790]" data-testid={`status-customer-response-${response.id}`}>{status}</span>
            </div>
            <p className="mt-2 break-all text-[10px] text-[#a198a4]">Request {response.request_id} · Revision {response.revision}</p>
            <p className="mt-1 text-[10px] text-[#a198a4]">Received {new Date(response.responded_at).toLocaleString()}</p>
            {response.feedback && <p className="mt-3 whitespace-pre-wrap text-[12px] leading-relaxed text-[#756b7b]">{response.feedback}</p>}
            {action?.confirmation_message && <p className="mt-3 whitespace-pre-wrap text-[12px] text-[#756b7b]">{action.confirmation_message}</p>}
            {actionable && <CustomerResponseActionPanel response={response} action={action} workflowError={error} onSaved={onSaved} />}
          </div>
        );
      })}
    </section>
  );
}
