import { z } from "zod";
import { ProposalRequestSchema, type ProposalRequest } from "./proposalGenerator";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const UserSchema = z.object({ id: z.string().uuid(), email: z.string().email().nullable().optional() });
const ProfileSchema = z.object({
  account_type: z.string().nullable(),
  role: z.string().nullable(),
  approval_status: z.string().nullable(),
});
const NumericValueSchema = z.union([z.number(), z.string()]).nullable();
export const CustomerRequestRowSchema = z.object({
  id: z.string().uuid(),
  customer_id: z.string().uuid(),
  customer_name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  event_name: z.string().nullable(),
  event_type: z.string().nullable(),
  event_date: z.string().nullable(),
  event_time: z.string().nullable(),
  guests: NumericValueSchema,
  budget: NumericValueSchema,
  services: z.array(z.string()).nullable(),
  notes: z.string().nullable(),
  status: z.string().nullable(),
  created_at: z.string().nullable(),
  venue_id: z.string().uuid().nullable(),
  event_end_time: z.string().nullable(),
}).strict();
export type CustomerRequestRow = z.infer<typeof CustomerRequestRowSchema>;

export class CustomerDataAccessError extends Error {
  constructor(readonly code: string, readonly statusCode: number, message: string) {
    super(message);
  }
}

const supportedEventAreas: Record<string, ReadonlySet<string>> = {
  "kuala lumpur": new Set([
    "bangsar", "bukit bintang", "bukit jalil", "cheras", "klcc",
    "mont kiara", "setapak", "sri hartamas", "titiwangsa", "wangsa maju",
  ]),
  selangor: new Set([
    "cyberjaya", "kajang", "klang", "petaling jaya", "puchong",
    "rawang", "shah alam", "selayang", "sepang", "subang jaya",
  ]),
};

export function isSupportedEventLocation(location: string): boolean {
  const parts = location.split(",").map(part => part.trim().toLocaleLowerCase());
  if (parts.length < 2) return false;
  const region = parts.at(-1) ?? "";
  const area = parts.at(-2) ?? "";
  return supportedEventAreas[region]?.has(area) ?? false;
}

function parseError(status: number): CustomerDataAccessError {
  if (status === 401) return new CustomerDataAccessError("INVALID_ACCESS_TOKEN", 401, "Your session is invalid or expired.");
  if (status === 403) return new CustomerDataAccessError("CUSTOMER_ACCESS_DENIED", 403, "This account cannot generate customer proposals.");
  return new CustomerDataAccessError("SUPABASE_REQUEST_FAILED", 503, "Customer data could not be verified right now.");
}

export type OwnedCustomerRequest = { customerId: string; request: CustomerRequestRow };

export interface CustomerRequestGateway {
  loadOwnedRequest(accessToken: string, requestId: string): Promise<OwnedCustomerRequest | null>;
}

/** Uses the caller's bearer token and publishable key so Supabase Auth and RLS stay in force. */
export class SupabaseCustomerRequestGateway implements CustomerRequestGateway {
  private readonly baseUrl: string | null;
  private readonly publishableKey: string | null;

  constructor(
    env: NodeJS.ProcessEnv = process.env,
    private readonly fetchImpl: FetchLike = fetch,
  ) {
    const configuredUrl = env["SUPABASE_URL"]?.trim() || env["VITE_SUPABASE_URL"]?.trim();
    this.baseUrl = configuredUrl ? configuredUrl.replace(/\/+$/, "") : null;
    this.publishableKey = env["SUPABASE_PUBLISHABLE_KEY"]?.trim() || env["VITE_SUPABASE_PUBLISHABLE_KEY"]?.trim() || null;
  }

  async loadOwnedRequest(accessToken: string, requestId: string): Promise<OwnedCustomerRequest | null> {
    if (!this.baseUrl || !this.publishableKey) {
      throw new CustomerDataAccessError("SUPABASE_NOT_CONFIGURED", 503, "Customer proposal service is not configured.");
    }

    const authResponse = await this.fetchJson(`${this.baseUrl}/auth/v1/user`, accessToken);
    if (!authResponse.ok) throw parseError(authResponse.status);
    const parsedUser = UserSchema.safeParse(authResponse.body);
    if (!parsedUser.success) throw new CustomerDataAccessError("INVALID_AUTH_RESPONSE", 503, "Customer identity could not be verified.");
    const customerId = parsedUser.data.id;

    const profileUrl = new URL(`${this.baseUrl}/rest/v1/profiles`);
    profileUrl.searchParams.set("select", "account_type,role,approval_status");
    profileUrl.searchParams.set("id", `eq.${customerId}`);
    profileUrl.searchParams.set("limit", "1");
    const profileResponse = await this.fetchJson(profileUrl, accessToken);
    if (!profileResponse.ok) throw parseError(profileResponse.status);
    const profile = z.array(ProfileSchema).safeParse(profileResponse.body);
    if (!profile.success || !profile.data[0]) {
      throw new CustomerDataAccessError("CUSTOMER_PROFILE_REQUIRED", 403, "An approved customer profile is required.");
    }
    const authorizedProfile = profile.data[0];
    if (authorizedProfile.account_type !== "customer"
      || authorizedProfile.role !== "customer"
      || authorizedProfile.approval_status !== "approved") {
      throw new CustomerDataAccessError("CUSTOMER_ACCESS_DENIED", 403, "This account cannot generate customer proposals.");
    }

    const requestUrl = new URL(`${this.baseUrl}/rest/v1/requests`);
    requestUrl.searchParams.set(
      "select",
      "id,customer_id,customer_name,email,phone,event_name,event_type,event_date,event_time,guests,budget,services,notes,status,created_at,venue_id,event_end_time",
    );
    requestUrl.searchParams.set("id", `eq.${requestId}`);
    requestUrl.searchParams.set("customer_id", `eq.${customerId}`);
    requestUrl.searchParams.set("limit", "1");
    const requestResponse = await this.fetchJson(requestUrl, accessToken);
    if (!requestResponse.ok) throw parseError(requestResponse.status);
    const requestRows = z.array(CustomerRequestRowSchema).safeParse(requestResponse.body);
    if (!requestRows.success) {
      throw new CustomerDataAccessError("INVALID_REQUEST_ROW", 503, "The saved event request could not be read safely.");
    }
    const request = requestRows.data[0];
    if (!request) return null;
    if (request.customer_id !== customerId) {
      throw new CustomerDataAccessError("REQUEST_OWNERSHIP_MISMATCH", 403, "This event request does not belong to the signed-in customer.");
    }
    return { customerId, request };
  }

  private async fetchJson(url: string | URL, accessToken: string): Promise<{ ok: boolean; status: number; body: unknown }> {
    try {
      const response = await this.fetchImpl(url, {
        method: "GET",
        headers: {
          apikey: this.publishableKey!,
          authorization: `Bearer ${accessToken}`,
          accept: "application/json",
        },
        signal: AbortSignal.timeout(10_000),
      });
      const body = await response.json().catch(() => null) as unknown;
      return { ok: response.ok, status: response.status, body };
    } catch {
      throw new CustomerDataAccessError("SUPABASE_UNAVAILABLE", 503, "Customer data could not be reached right now.");
    }
  }
}

/** Maps only data saved in public.requests; it never uses event/proposal fields from the browser. */
export function mapSavedRequestToProposalInput(request: CustomerRequestRow): ProposalRequest {
  const notes = request.notes ?? "";
  const locationNotes = /^Location:\s*([^\r\n]+)(?:\r?\n\r?\n([\s\S]*))?$/.exec(notes);
  const location = locationNotes?.[1]?.trim();
  if (!location) {
    throw new CustomerDataAccessError("REQUEST_LOCATION_NOT_PERSISTED", 422, "The saved request is missing a usable event location.");
  }
  const noteBody = locationNotes?.[2]?.trim() ?? "";
  const versionedMetadata = /^EventFlow request metadata v1:\r?\nTheme:\s*([^\r\n]*)(?:\r?\n\r?\n([\s\S]*))?$/.exec(noteBody);
  const theme = versionedMetadata?.[1]?.trim() ?? "";
  const requirements = (versionedMetadata ? versionedMetadata[2] : noteBody)?.trim() || "No additional requirements provided.";

  const guests = request.guests === null ? Number.NaN : Number(request.guests);
  const budgetMYR = request.budget === null ? Number.NaN : Number(request.budget);
  const parsed = ProposalRequestSchema.safeParse({
    eventName: request.event_name,
    eventType: request.event_type,
    eventDate: request.event_date,
    location,
    guestCount: guests,
    budgetMYR,
    // New requests store an explicit versioned theme marker in notes. Legacy notes
    // without that marker remain theme-unspecified; never infer one from requirements.
    theme,
    selectedServices: request.services ?? [],
    requirements,
  });
  if (!parsed.success) {
    throw new CustomerDataAccessError("REQUEST_DATA_INCOMPLETE", 422, "The saved event request is missing valid proposal requirements.");
  }
  return parsed.data;
}
