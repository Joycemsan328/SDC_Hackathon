export const EVENT_AREAS = {
  "Kuala Lumpur": [
    "Bangsar",
    "Bukit Bintang",
    "Bukit Jalil",
    "Cheras",
    "KLCC",
    "Mont Kiara",
    "Setapak",
    "Sri Hartamas",
    "Titiwangsa",
    "Wangsa Maju",
  ],
  Selangor: [
    "Cyberjaya",
    "Kajang",
    "Klang",
    "Petaling Jaya",
    "Puchong",
    "Rawang",
    "Shah Alam",
    "Selayang",
    "Sepang",
    "Subang Jaya",
  ],
} as const;

export type EventRegion = keyof typeof EVENT_AREAS;

export const EVENT_LOCATION_SUPPORT_MESSAGE =
  "EventFlow AI currently supports event planning in Kuala Lumpur and Selangor only.";

export function formatEventLocation(region: string, area: string, venue = ""): string | null {
  const areas = EVENT_AREAS[region as EventRegion] as readonly string[] | undefined;
  if (!areas?.includes(area)) return null;
  const place = venue.trim().replace(/,+$/, "").trim();
  return [place, area, region].filter(Boolean).join(", ");
}
