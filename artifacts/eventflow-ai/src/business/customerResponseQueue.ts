import type { CustomerResponseRecord } from "@/customer/customerResponseTypes";
import type { CustomerResponseAction } from "./customerResponseActions";

type ProposalRevision = { requestId: string; revision?: string };

export function buildCustomerResponseQueue(
  responses: CustomerResponseRecord[],
  actions: CustomerResponseAction[],
  proposals: ProposalRevision[],
) {
  const latest = new Map<string, bigint>();
  for (const proposal of proposals) {
    if (!proposal.revision || !/^[1-9][0-9]{0,31}$/.test(proposal.revision)) continue;
    const revision = BigInt(proposal.revision);
    if (revision > (latest.get(proposal.requestId) ?? 0n)) latest.set(proposal.requestId, revision);
  }
  return Array.from(new Map(responses.map(response => [response.id, response])).values())
    .map(response => {
      const action = actions.find(item => item.response_id === response.id);
      let status: string;
      let actionable = false;
      if (!/^[1-9][0-9]{0,31}$/.test(response.revision)) {
        status = "Response revision could not be verified";
      } else if (action && (action.request_id !== response.request_id || action.source_revision !== response.revision
        || action.action_kind !== (response.response_kind === "selection" ? "selection_confirmation" : "revision"))) {
        status = "Response action could not be verified";
      } else if (action?.status === "confirmed") {
        status = "Confirmed by Business";
      } else if (action?.status === "business_review" || action?.status === "released") {
        status = action.status === "released"
          ? `Revision ${action.next_revision} released to Customer`
          : `Revision ${action.next_revision} awaiting Business proposal review`;
      } else if ((latest.get(response.request_id) ?? 0n) > BigInt(response.revision)) {
        status = "Historical response — a newer proposal revision exists";
      } else if (action?.generation_error_code) {
        status = "AI attempt failed — no automatic retry";
      } else {
        actionable = true;
        status = action?.status === "generating" ? "Revision generation reserved"
          : action?.status === "queued" ? `Revision ${action.next_revision} queued`
          : response.response_kind === "selection" ? "Awaiting Business confirmation" : "Awaiting Business action";
      }
      return { response, action, status, actionable };
    });
}
