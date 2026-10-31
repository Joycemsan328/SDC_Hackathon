export type Profile = {
  role: string;
  account_type: string;
  approval_status: string;
  full_name?: string | null;
};

// Only the database profile is authoritative. Signup metadata is never an access grant.
export function profileDestination(profile: Profile | null): "/customer" | "/business" | "/pending" {
  if (!profile || profile.approval_status !== "approved") return "/pending";
  if (profile.role === "admin") return "/business";
  if (profile.role === "staff" && profile.account_type === "business") return "/business";
  if (profile.role === "customer" && profile.account_type === "customer") return "/customer";
  return "/pending";
}
