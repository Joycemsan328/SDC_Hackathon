import { useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabase";
import type { Session } from "@supabase/supabase-js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ErrorBoundary } from "@/components/error-boundary";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import CalendarManagementPage from "@/components/calendar-management";
import EventFlowRegister from "./EventFlowRegister";
import {
  Route,
  Switch,
  useLocation,
  Link,
  Router as WouterRouter,
  useParams,
} from "wouter";
import {
  Activity,
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  Bell,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  Clock3,
  Download,
  Edit3,
  FileText,
  Filter,
  Heart,
  LayoutDashboard,
  ListChecks,
  Mail,
  Menu,
  MoreHorizontal,
  Package,
  Plus,
  Search,
  Send,
  Settings2,
  Sparkles,
  Trash2,
  Users,
  X,
  CalendarCheck,
  BriefcaseBusiness,
  ChartNoAxesCombined,
  RotateCcw,
  Eye,
  MapPin,
  Phone,
  WandSparkles,
  ShieldBan,
} from "lucide-react";

type RequestStatus =
  | "New"
  | "Under Review"
  | "Proposal Ready"
  | "Pending Approval"
  | "Approved"
  | "Completed";
type Req = {
  id: string;
  customer: string;
  email: string;
  phone: string;
  type: string;
  name: string;
  date: string;
  time: string;
  guests: number;
  budget: number;
  services: string[];
  notes: string;
  status: RequestStatus;
};
type Line = { service: string; qty: number; price: number };
type Proposal = {
  id: string;
  requestId: string;
  customer: string;
  event: string;
  date: string;
  type: string;
  budget: number;
  lines: Line[];
  recommendation: string;
  status: string;
  checklist: {
    budget: boolean;
    supplier: boolean;
    schedule: boolean;
    reviewed: boolean;
  };
  revision?: string;
};
type EventItem = {
  id: string;
  customer: string;
  name: string;
  date: string;
  time: string;
  status: "Upcoming" | "Ongoing" | "Completed" | "Cancelled";
  value: number;
  type: string;
  guests: number;
};
type BlockedSlot = { id: string; date: string; reason: string };
type Supplier = {
  id: string;
  name: string;
  package: string;
  category: string;
  price: number;
  status: string;
  contact: string;
};
type Modal = {
  kind: "request" | "supplier" | "event" | "block" | "proposal" | "notice";
  item?: any;
} | null;

type Store = {
  requests: Req[];
  proposals: Proposal[];
  events: EventItem[];
  suppliers: Supplier[];
  blockedSlots: BlockedSlot[];
};

const DB_KEY = "eventflow-demo-v1";
const today = new Date();
const dateAt = (offset: number) => {
  const d = new Date(today);
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};
const seed: Store = {
  requests: [
    {
      id: "REQ-2408",
      customer: "Alya Rahman",
      email: "alya.rahman@email.my",
      phone: "+60 12-678 4421",
      type: "Wedding",
      name: "Garden of Light",
      date: dateAt(42),
      time: "18:30",
      guests: 180,
      budget: 42000,
      services: ["Venue styling", "Catering", "Photography"],
      notes:
        "An intimate garden celebration with a soft lavender and ivory palette. Halal catering required.",
      status: "Proposal Ready",
    },
    {
      id: "REQ-2407",
      customer: "Daniel & Mei Ling",
      email: "daniel.mei@email.my",
      phone: "+60 16-320 1188",
      type: "Engagement",
      name: "A Quiet Promise",
      date: dateAt(21),
      time: "11:00",
      guests: 80,
      budget: 18500,
      services: ["Decoration", "Catering", "Photography"],
      notes: "Modern Peranakan touches, afternoon tea, close family only.",
      status: "Pending Approval",
    },
    {
      id: "REQ-2406",
      customer: "Nadia Iskandar",
      email: "nadia.i@email.my",
      phone: "+60 17-420 9602",
      type: "Birthday party",
      name: "Thirty, in Bloom",
      date: dateAt(11),
      time: "19:00",
      guests: 65,
      budget: 12000,
      services: ["Venue styling", "Dessert table", "Entertainment"],
      notes:
        "A warm, playful dinner with a floral installation and live acoustic set.",
      status: "Under Review",
    },
    {
      id: "REQ-2405",
      customer: "BumiTech Sdn Bhd",
      email: "events@bumitech.my",
      phone: "+60 3-2788 4220",
      type: "Corporate event",
      name: "BumiTech Annual Gala",
      date: dateAt(60),
      time: "18:00",
      guests: 320,
      budget: 50000,
      services: ["Venue", "AV production", "Catering"],
      notes: "Awards dinner with stage, screens and vegetarian menu options.",
      status: "New",
    },
    {
      id: "REQ-2404",
      customer: "Farah & Imran",
      email: "farah.imran@email.my",
      phone: "+60 12-770 1981",
      type: "Baby full moon",
      name: "Little Moon Gathering",
      date: dateAt(34),
      time: "12:30",
      guests: 120,
      budget: 15500,
      services: ["Catering", "Backdrop", "Favors"],
      notes: "A gentle moon-and-cloud theme in blush, cream and muted lilac.",
      status: "Approved",
    },
    {
      id: "REQ-2403",
      customer: "Siti Hajar",
      email: "siti.h@email.my",
      phone: "+60 19-238 7790",
      type: "Birthday party",
      name: "The Little Explorer",
      date: dateAt(-8),
      time: "15:00",
      guests: 45,
      budget: 7800,
      services: ["Styling", "Cake", "Entertainment"],
      notes: "A thoughtful outdoor party for a curious six-year-old.",
      status: "Completed",
    },
  ],
  proposals: [
    {
      id: "PROP-082",
      requestId: "REQ-2408",
      customer: "Alya Rahman",
      event: "Garden of Light",
      date: dateAt(42),
      type: "Wedding",
      budget: 42000,
      lines: [
        { service: "Garden venue styling", qty: 1, price: 14800 },
        { service: "Halal dining · 180 guests", qty: 180, price: 98 },
        { service: "Photography · 8 hours", qty: 1, price: 5600 },
        { service: "Floral ceremony arch", qty: 1, price: 3200 },
      ],
      recommendation:
        "A dusk ceremony with layered candlelight and locally grown seasonal blooms. This plan keeps 8% of the budget in reserve for final guest adjustments.",
      status: "Draft",
      checklist: {
        budget: true,
        supplier: true,
        schedule: false,
        reviewed: false,
      },
    },
    {
      id: "PROP-081",
      requestId: "REQ-2407",
      customer: "Daniel & Mei Ling",
      event: "A Quiet Promise",
      date: dateAt(21),
      type: "Engagement",
      budget: 18500,
      lines: [
        { service: "Peranakan tea table", qty: 80, price: 85 },
        { service: "Garden-inspired styling", qty: 1, price: 4900 },
        { service: "Event photography", qty: 1, price: 2600 },
      ],
      recommendation:
        "A relaxed afternoon flow gives family time to mingle while keeping the palette modern and personal.",
      status: "Pending Approval",
      checklist: {
        budget: true,
        supplier: true,
        schedule: true,
        reviewed: true,
      },
    },
    {
      id: "PROP-079",
      requestId: "REQ-2404",
      customer: "Farah & Imran",
      event: "Little Moon Gathering",
      date: dateAt(34),
      type: "Baby full moon",
      budget: 15500,
      lines: [
        { service: "Cloud & moon backdrop", qty: 1, price: 3600 },
        { service: "Family buffet · 120 guests", qty: 120, price: 78 },
        { service: "Keepsake favor set", qty: 120, price: 18 },
      ],
      recommendation:
        "Soft textures and a clear family dining flow keep this gathering warm, comfortable and photogenic.",
      status: "Approved",
      checklist: {
        budget: true,
        supplier: true,
        schedule: true,
        reviewed: true,
      },
    },
  ],
  events: [
    {
      id: "EVT-013",
      customer: "Farah & Imran",
      name: "Little Moon Gathering",
      date: dateAt(34),
      time: "12:30",
      status: "Upcoming",
      value: 15500,
      type: "Baby full moon",
      guests: 120,
    },
    {
      id: "EVT-012",
      customer: "Daniel & Mei Ling",
      name: "A Quiet Promise",
      date: dateAt(21),
      time: "11:00",
      status: "Upcoming",
      value: 17100,
      type: "Engagement",
      guests: 80,
    },
    {
      id: "EVT-009",
      customer: "Siti Hajar",
      name: "The Little Explorer",
      date: dateAt(-8),
      time: "15:00",
      status: "Completed",
      value: 7800,
      type: "Birthday party",
      guests: 45,
    },
  ],
  suppliers: [
    {
      id: "SUP-01",
      name: "Petal & Plinth Studio",
      package: "Signature floral styling",
      category: "Decoration",
      price: 6800,
      status: "Available",
      contact: "hello@petalandplinth.my",
    },
    {
      id: "SUP-02",
      name: "Dapur Serai Events",
      package: "Nusantara buffet · per guest",
      category: "Catering",
      price: 88,
      status: "Available",
      contact: "booking@dapurserai.my",
    },
    {
      id: "SUP-03",
      name: "The Lumen Collective",
      package: "Full-day event photography",
      category: "Photography",
      price: 5200,
      status: "Available",
      contact: "studio@lumen.my",
    },
    {
      id: "SUP-04",
      name: "Sora Sound & Light",
      package: "Stage and AV essentials",
      category: "Equipment",
      price: 3900,
      status: "Limited",
      contact: "team@sorasound.my",
    },
    {
      id: "SUP-05",
      name: "Little Fern Quartet",
      package: "Acoustic trio · 2 sets",
      category: "Entertainment",
      price: 2400,
      status: "Available",
      contact: "book@littlefern.my",
    },
    {
      id: "SUP-06",
      name: "KL Grand Coach",
      package: "Premium shuttle · 40 seats",
      category: "Transport",
      price: 1800,
      status: "Available",
      contact: "care@klgrandcoach.my",
    },
  ],
  blockedSlots: [],
};
const nav = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/requests", label: "Requests", icon: Mail },
  { href: "/proposals", label: "Proposals", icon: FileText },
  { href: "/approvals", label: "Approvals", icon: ClipboardCheck },
  { href: "/events", label: "Events", icon: CalendarCheck },
  { href: "/calendar", label: "Availability", icon: CalendarDays },
  { href: "/suppliers", label: "Suppliers", icon: Package },
  { href: "/reports", label: "Reports", icon: ChartNoAxesCombined },
  {
    href: "/admin-approvals",
    label: "Admin Approvals",
    icon: ClipboardCheck,
  },
];
const money = (n: number) => `RM ${n.toLocaleString("en-MY")}`;
const dateLabel = (
  v: string,
  opts: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "short",
    year: "numeric",
  },
) => new Date(`${v}T12:00:00`).toLocaleDateString("en-MY", opts);
function loadStore(): Store {
  try {
    const saved = localStorage.getItem(DB_KEY);
    if (!saved) return seed;
    const parsed = JSON.parse(saved) as Partial<Store>;
    return {
      requests: Array.isArray(parsed.requests)
        ? parsed.requests
        : seed.requests,
      proposals: Array.isArray(parsed.proposals)
        ? parsed.proposals
        : seed.proposals,
      events: Array.isArray(parsed.events) ? parsed.events : seed.events,
      suppliers: Array.isArray(parsed.suppliers)
        ? parsed.suppliers
        : seed.suppliers,
      blockedSlots: Array.isArray(parsed.blockedSlots)
        ? parsed.blockedSlots
        : [],
    };
  } catch {
    return seed;
  }
}
function makeId(prefix: string, existingIds: string[]) {
  const base = `${prefix}-${String(Date.now()).slice(-5)}`;
  let id = base,
    suffix = 2;
  while (existingIds.includes(id)) {
    id = `${base}-${suffix}`;
    suffix++;
  }
  return id;
}
function slotConflict(
  store: Store,
  date: string,
  time: string,
  ignoreEventId?: string,
) {
  const block = store.blockedSlots.find((slot) => slot.date === date);
  if (block)
    return `This date is blocked${block.reason ? `: ${block.reason}` : ""}. Remove the block before reserving it.`;
  const event = store.events.find(
    (item) =>
      item.id !== ignoreEventId &&
      item.date === date &&
      item.time === time &&
      item.status !== "Cancelled",
  );
  return event ? `${event.name} already reserves this date and time.` : null;
}
function dateConflict(store: Store, date: string) {
  const event = store.events.find(
    (item) => item.date === date && item.status !== "Cancelled",
  );
  return event ? `${event.name} is already scheduled on this date.` : null;
}
const queryClient = new QueryClient();

function App() {
  const [store, setStore] = useState<Store>(loadStore);
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [isStaff, setIsStaff] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let active = true;

    async function checkStaff(userId: string) {
      const { data, error } = await supabase
        .from("profiles")
        .select("role, account_type, approval_status")
        .eq("id", userId)
        .single();

      if (active) {
        const approved = !error && data?.approval_status === "approved";

        const staffAccess =
          approved &&
          data?.role === "staff" &&
          data?.account_type === "business";

        const adminAccess = approved && data?.role === "admin";

        setIsStaff(staffAccess || adminAccess);
        setIsAdmin(adminAccess);
        setAuthLoading(false);
      }
    }

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;

      setSession(data.session);

      if (data.session) {
        checkStaff(data.session.user.id);
      } else {
        setIsStaff(false);
        setIsAdmin(false);
        setAuthLoading(false);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        setSession(newSession);

        if (newSession) {
          setAuthLoading(true);
          void checkStaff(newSession.user.id);
        } else {
          setIsStaff(false);
          setAuthLoading(false);
        }
      },
    );

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);
  useEffect(() => {
    async function testConnection() {
      const { data, error } = await supabase
        .from("venues")
        .select("id, name")
        .limit(5);

      if (error) {
        console.error("Supabase connection test:", error.message);
      } else {
        console.log("Supabase connection successful!", data);
      }
    }

    testConnection();
  }, []);
  const [modal, setModal] = useState<Modal>(null);
  const [notice, setNotice] = useState("");
  const [mobileNav, setMobileNav] = useState(false);
  const [location, setLocation] = useLocation();
  useEffect(() => {
    try {
      localStorage.setItem(DB_KEY, JSON.stringify(store));
    } catch {
      setNotice(
        "Your browser could not save workspace changes. Check local storage settings.",
      );
    }
  }, [store]);
  const flash = (s: string) => {
    setNotice(s);
    window.setTimeout(() => setNotice(""), 2600);
  };
  const updateRequest = (id: string, patch: Partial<Req>) =>
    setStore((s) => ({
      ...s,
      requests: s.requests.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    }));
  const addRequest = (r: Req) => {
    if (r.date < dateAt(0)) {
      flash("Choose today or a future date for the request");
      return false;
    }
    if (r.guests < 1 || r.budget < 1 || !r.services.length) {
      flash("Add at least one service and valid guest and budget amounts");
      return false;
    }
    const request = {
      ...r,
      id: makeId(
        "REQ",
        store.requests.map((item) => item.id),
      ),
    };
    setStore((s) => ({ ...s, requests: [request, ...s.requests] }));
    setModal(null);
    flash("Request added to your workspace");
    return true;
  };
  const addSupplier = (v: Supplier) => {
    setStore((s) => ({
      ...s,
      suppliers: v.id
        ? s.suppliers.map((x) => (x.id === v.id ? v : x))
        : [v, ...s.suppliers],
    }));
    setModal(null);
    flash("Supplier details saved");
  };
  const createProposal = (r: Req) => {
    const exists = store.proposals.find((p) => p.requestId === r.id);
    if (exists) {
      setLocation(`/proposals/${exists.id}`);
      return;
    }
    const lines: Line[] = r.services.slice(0, 3).map((service, i) => ({
      service,
      qty: i === 1 ? r.guests : 1,
      price:
        i === 1
          ? Math.round((r.budget * 0.42) / Math.max(r.guests, 1))
          : Math.round(r.budget * (i === 0 ? 0.28 : 0.18)),
    }));
    const p: Proposal = {
      id: makeId(
        "PROP",
        store.proposals.map((item) => item.id),
      ),
      requestId: r.id,
      customer: r.customer,
      event: r.name,
      date: r.date,
      type: r.type,
      budget: r.budget,
      lines,
      recommendation: `A considered ${r.type.toLowerCase()} experience for ${r.guests} guests, balancing the requested ${r.services.slice(0, 2).join(" and ").toLowerCase()} with a comfortable contingency.`,
      status: "Draft",
      checklist: {
        budget: true,
        supplier: true,
        schedule: false,
        reviewed: false,
      },
    };
    setStore((s) => ({
      ...s,
      proposals: [p, ...s.proposals],
      requests: s.requests.map((item) =>
        item.id === r.id ? { ...item, status: "Proposal Ready" } : item,
      ),
    }));
    setModal(null);
    setLocation(`/proposals/${p.id}`);
  };
  const saveProposal = (p: Proposal) =>
    setStore((s) => ({
      ...s,
      proposals: s.proposals.map((x) => (x.id === p.id ? p : x)),
      requests: s.requests.map((r) =>
        r.id === p.requestId && p.status === "Pending Approval"
          ? { ...r, status: "Pending Approval" }
          : r,
      ),
    }));
  const addEvent = (event: EventItem) => {
    const conflict =
      event.date < dateAt(0)
        ? "Choose today or a future date."
        : slotConflict(store, event.date, event.time);
    if (conflict) {
      flash(conflict);
      return false;
    }
    setStore((s) => ({ ...s, events: [event, ...s.events] }));
    setModal(null);
    flash("Event added and calendar slot reserved");
    return true;
  };
  const addBlockedSlot = (slot: BlockedSlot) => {
    const conflict =
      slot.date < dateAt(0)
        ? "Choose today or a future date."
        : store.blockedSlots.some((item) => item.date === slot.date)
          ? "This date is already blocked."
          : dateConflict(store, slot.date);
    if (conflict) {
      flash(conflict);
      return false;
    }
    setStore((s) => ({ ...s, blockedSlots: [slot, ...s.blockedSlots] }));
    setModal(null);
    flash("Calendar date blocked");
    return true;
  };
  const unblockSlot = (id: string) => {
    setStore((s) => ({
      ...s,
      blockedSlots: s.blockedSlots.filter((slot) => slot.id !== id),
    }));
    flash("Calendar block removed");
  };

  const approveProposal = (p: Proposal) => {
    if (p.status !== "Pending Approval") {
      flash("Submit this proposal for approval first");
      return false;
    }

    setStore((s) => ({
      ...s,
      proposals: s.proposals.map((x) =>
        x.id === p.id ? { ...x, status: "Awaiting Customer" } : x,
      ),
    }));

    flash("Proposal approved — awaiting customer acceptance");
    return true;
  };

  const acceptProposal = (p: Proposal) => {
    if (p.status !== "Awaiting Customer") {
      flash("This proposal is not awaiting customer acceptance");
      return false;
    }

    const request = store.requests.find((r) => r.id === p.requestId);
    const time = request?.time || "18:00";

    const existing = store.events.find(
      (e) =>
        e.name === p.event && e.date === p.date && e.status !== "Cancelled",
    );

    if (existing) {
      flash("An event with this name and date already exists");
      return false;
    }

    const conflict = slotConflict(store, p.date, time);
    if (conflict) {
      flash(conflict);
      return false;
    }

    const event: EventItem = {
      id: makeId(
        "EVT",
        store.events.map((e) => e.id),
      ),
      customer: p.customer,
      name: p.event,
      date: p.date,
      time,
      status: "Upcoming",
      value: p.lines.reduce((sum, line) => sum + line.qty * line.price, 0),
      type: p.type,
      guests: request?.guests || 0,
    };

    setStore((s) => ({
      ...s,
      proposals: s.proposals.map((x) =>
        x.id === p.id ? { ...x, status: "Accepted" } : x,
      ),
      requests: s.requests.map((r) =>
        r.id === p.requestId ? { ...r, status: "Approved" } : r,
      ),
      events: [event, ...s.events],
    }));

    flash("Customer accepted! Event created and date reserved.");
    return true;
  };

  const reset = () => {
    if (
      window.confirm("Reset all demo data to the original sample workspace?")
    ) {
      setStore(seed);
      localStorage.removeItem(DB_KEY);
      flash("Demo data restored");
    }
  };
  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        Checking staff access...
      </div>
    );
  }

  if (!session) {
    return <EventFlowWelcome />;
  }

  if (!isStaff) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <p>This account does not have staff access.</p>
        <button
          onClick={() => supabase.auth.signOut()}
          className="rounded-xl bg-[#77518a] px-4 py-2 text-white"
        >
          Sign Out
        </button>
      </div>
    );
  }
  const unread =
    store.requests.filter((r) => r.status === "New").length +
    store.proposals.filter((p) => p.status === "Pending Approval").length;
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <div className="app-shell flex text-[#342d40]">
            {mobileNav && (
              <button
                aria-label="Close navigation overlay"
                onClick={() => setMobileNav(false)}
                className="fixed inset-0 z-30 bg-[#2b2231]/30 md:hidden"
                data-testid="button-close-mobile-nav"
              />
            )}
            <aside
              className={`fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col border-r border-[#eee6ef] bg-[#f7f3f8] px-4 py-5 transition-transform md:sticky md:top-0 md:h-dvh md:translate-x-0 ${mobileNav ? "translate-x-0" : "-translate-x-full"}`}
            >
              <div className="mb-9 flex items-center gap-3 px-2">
                <div className="grid h-10 w-10 place-items-center rounded-2xl bg-[#77518a] text-white shadow-md shadow-[#8c6b9b]/20">
                  <Heart size={19} strokeWidth={1.8} />
                </div>
                <div>
                  <div className="serif text-[20px] font-semibold tracking-[-.4px]">
                    eventflow<span className="text-[#bd91b2]">.</span>
                  </div>
                  <div className="text-[10px] font-semibold uppercase tracking-[.18em] text-[#988b9d]">
                    Studio workspace
                  </div>
                </div>
              </div>
              <div className="mb-3 px-3 text-[10px] font-bold uppercase tracking-[.16em] text-[#a59aaa]">
                Workspace
              </div>
              <nav className="space-y-1" aria-label="Main navigation">
                {nav
                  .filter((item) => isAdmin || item.href !== "/admin-approvals")
                  .map((item) => {
                    const active =
                      item.href === "/"
                        ? location === "/"
                        : location.startsWith(item.href);
                    const Icon = item.icon;
                    const badge =
                      item.href === "/approvals"
                        ? store.proposals.filter(
                            (p) => p.status === "Pending Approval",
                          ).length
                        : item.href === "/requests"
                          ? store.requests.filter((r) => r.status === "New")
                              .length
                          : 0;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setMobileNav(false)}
                        data-testid={`link-nav-${item.label.toLowerCase()}`}
                        className={`sidebar-link flex items-center gap-3 rounded-xl px-3 py-[10px] text-[13px] font-semibold ${active ? "bg-white text-[#714981] shadow-sm" : "text-[#756d7b] hover:bg-white/70 hover:text-[#493b52]"}`}
                      >
                        <Icon size={17} strokeWidth={1.8} />
                        <span className="flex-1">{item.label}</span>
                        {badge > 0 && (
                          <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[#f4dce9] px-1 text-[10px] font-bold text-[#9a5b7a]">
                            {badge}
                          </span>
                        )}
                      </Link>
                    );
                  })}
              </nav>
              <div className="mt-auto">
                <div className="mb-4 rounded-2xl bg-[#ede4f1] p-4">
                  <div className="mb-2 flex items-center gap-2 text-[#76538a]">
                    <Sparkles size={15} />
                    <span className="text-[11px] font-bold uppercase tracking-[.1em]">
                      Studio note
                    </span>
                  </div>
                  <p className="text-[12px] leading-[1.65] text-[#6f6179]">
                    A little breathing room makes every celebration feel
                    considered.
                  </p>
                  <button
                    onClick={() => setLocation("/calendar")}
                    className="mt-3 text-[11px] font-bold text-[#77518a] hover:underline"
                    data-testid="button-view-availability"
                  >
                    View availability{" "}
                    <ArrowRight className="ml-1 inline" size={12} />
                  </button>
                </div>
                <button
                  onClick={reset}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[11px] font-medium text-[#998fa0] hover:bg-white hover:text-[#6d4d7e]"
                  data-testid="button-reset-demo"
                >
                  <RotateCcw size={14} /> Reset demo data
                </button>

                <button
                  type="button"
                  onClick={async () => {
                    const { error } = await supabase.auth.signOut();
                    if (error) {
                      alert("Unable to log out: " + error.message);
                    }
                  }}
                  className="flex w-full items-center rounded-xl px-3 py-2 text-left text-[11px] font-medium text-[#998fa0] hover:bg-white hover:text-[#6d4d7e]"
                >
                  Log Out
                </button>

                <div className="mt-3 flex items-center gap-3 border-t border-[#e8e0e9] px-2 pt-4">
                  <div className="grid h-9 w-9 place-items-center rounded-full bg-[#e9d6e8] text-[12px] font-bold text-[#714981]">
                    EC
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-bold">
                      Elena Chong
                    </p>
                    <p className="text-[10px] text-[#928899]">
                      Studio director
                    </p>
                  </div>
                  <button
                    aria-label="Workspace settings"
                    onClick={() =>
                      flash("You are viewing the studio demo workspace")
                    }
                    className="rounded-lg p-2 text-[#978b9e] hover:bg-white"
                    data-testid="button-settings"
                  >
                    <Settings2 size={16} />
                  </button>
                </div>
              </div>
            </aside>
            <main className="min-w-0 flex-1">
              <header className="sticky top-0 z-20 flex h-[72px] items-center justify-between border-b border-[#eee8ef] bg-[#fbf9f7]/95 px-4 backdrop-blur md:px-8">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setMobileNav(true)}
                    className="rounded-lg p-2 text-[#62596a] hover:bg-white md:hidden"
                    aria-label="Open navigation"
                    data-testid="button-open-mobile-nav"
                  >
                    <Menu size={20} />
                  </button>
                  <div className="hidden text-[11px] font-semibold text-[#a096a5] sm:block">
                    STUDIO /{" "}
                    <span className="text-[#65576d]">
                      {nav
                        .find((n) =>
                          n.href === "/"
                            ? location === "/"
                            : location.startsWith(n.href),
                        )
                        ?.label.toUpperCase() || "DETAIL"}
                    </span>
                  </div>
                  <div className="sm:hidden serif text-lg">eventflow</div>
                </div>
                <div className="flex items-center gap-2 sm:gap-4">
                  <div className="hidden items-center gap-2 rounded-full border border-[#eee7ef] bg-white px-3 py-2 text-[11px] text-[#928899] lg:flex">
                    <span className="h-2 w-2 rounded-full bg-[#82a994]" />
                    {today.toLocaleDateString("en-MY", {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                    })}
                  </div>
                  <button
                    onClick={() => setModal({ kind: "notice" })}
                    className="relative grid h-9 w-9 place-items-center rounded-full border border-[#eee7ef] bg-white text-[#756b7d] hover:bg-[#faf6fb]"
                    aria-label="Notifications"
                    data-testid="button-notifications"
                  >
                    <Bell size={16} />
                    {unread > 0 && (
                      <span className="absolute right-1 top-1 h-2 w-2 rounded-full border border-white bg-[#d58ba9]" />
                    )}
                  </button>
                  <button
                    onClick={() => setModal({ kind: "request" })}
                    className="flex h-9 items-center gap-2 rounded-full bg-[#77518a] px-3 text-[11px] font-bold text-white shadow-sm hover:bg-[#684578] sm:px-4 sm:text-[12px]"
                    data-testid="button-global-new-request"
                  >
                    <Plus size={15} />
                    <span className="hidden sm:inline">New request</span>
                    <span className="sm:hidden">New</span>
                  </button>
                </div>
              </header>
              <div className="mx-auto max-w-[1440px] p-4 pb-12 md:px-8 md:py-7">
                <ErrorBoundary resetKey={location}>
                  <Switch>
                    <Route
                      path="/"
                      component={() => (
                        <Dashboard
                          store={store}
                          setLocation={setLocation}
                          openModal={setModal}
                        />
                      )}
                    />
                    <Route
                      path="/requests"
                      component={() => (
                        <Requests
                          store={store}
                          setLocation={setLocation}
                          openModal={setModal}
                        />
                      )}
                    />
                    <Route
                      path="/requests/:id"
                      component={() => (
                        <RequestDetail
                          store={store}
                          updateRequest={updateRequest}
                          createProposal={createProposal}
                          setLocation={setLocation}
                        />
                      )}
                    />
                    <Route
                      path="/proposals"
                      component={() => (
                        <Proposals store={store} setLocation={setLocation} />
                      )}
                    />
                    <Route
                      path="/proposals/:id"
                      component={() => (
                        <ProposalDetail
                          store={store}
                          saveProposal={saveProposal}
                          approve={approveProposal}
                          accept={acceptProposal}
                          flash={flash}
                        />
                      )}
                    />
                    <Route
                      path="/approvals"
                      component={() => (
                        <Approvals
                          store={store}
                          setLocation={setLocation}
                          approve={approveProposal}
                          saveProposal={saveProposal}
                          flash={flash}
                        />
                      )}
                    />
                    <Route
                      path="/events"
                      component={() => (
                        <EventsWithCreate
                          store={store}
                          setLocation={setLocation}
                          openModal={setModal}
                        />
                      )}
                    />
                    <Route
                      path="/events/:id"
                      component={() => (
                        <EventDetail
                          store={store}
                          setLocation={setLocation}
                          updateEvent={(
                            id: string,
                            status: EventItem["status"],
                          ) =>
                            setStore((s) => ({
                              ...s,
                              events: s.events.map((e) =>
                                e.id === id ? { ...e, status } : e,
                              ),
                            }))
                          }
                        />
                      )}
                    />
                    <Route
                      path="/calendar"
                      component={() => (
                        <CalendarManagementPage
                          store={store}
                          openModal={setModal}
                          unblockSlot={unblockSlot}
                        />
                      )}
                    />
                    <Route
                      path="/suppliers"
                      component={() => (
                        <Suppliers
                          store={store}
                          openModal={setModal}
                          setStore={setStore}
                        />
                      )}
                    />
                    <Route
                      path="/reports"
                      component={() => <Reports store={store} />}
                    />
                    <Route
                      path="/admin-approvals"
                      component={() =>
                        isAdmin ? (
                          <AdminApprovalsPage />
                        ) : (
                          <div className="rounded-xl border bg-white p-6">
                            <h2 className="text-xl font-bold">Access Denied</h2>
                            <p className="mt-2 text-gray-600">
                              Only EventFlow administrators can access this
                              page.
                            </p>
                          </div>
                        )
                      }
                    />
                    <Route component={NotFound} />
                  </Switch>
                </ErrorBoundary>
              </div>
            </main>
            {modal?.kind === "request" && (
              <RequestModal
                onClose={() => setModal(null)}
                onSave={addRequest}
                existingIds={store.requests.map((item) => item.id)}
              />
            )}
            {modal?.kind === "event" && (
              <EventModal
                initialDate={modal.item?.date}
                onClose={() => setModal(null)}
                onSave={addEvent}
                existingIds={store.events.map((item) => item.id)}
              />
            )}
            {modal?.kind === "block" && (
              <BlockDateModal
                initialDate={modal.item?.date}
                onClose={() => setModal(null)}
                onSave={addBlockedSlot}
                existingIds={store.blockedSlots.map((item) => item.id)}
              />
            )}
            {modal?.kind === "supplier" && (
              <SupplierModal
                supplier={modal.item}
                onClose={() => setModal(null)}
                onSave={addSupplier}
              />
            )}
            {modal?.kind === "notice" && (
              <NoticeModal
                store={store}
                close={() => setModal(null)}
                setLocation={setLocation}
              />
            )}
            {notice && (
              <div
                role="status"
                className="fixed bottom-5 right-5 z-[70] flex items-center gap-2 rounded-xl bg-[#3f3249] px-4 py-3 text-[13px] font-medium text-white shadow-xl fade-in"
                data-testid="status-toast"
              >
                <CheckCircle2 size={17} className="text-[#d8b8df]" />
                {notice}
              </div>
            )}
          </div>
        </WouterRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

function PageHeading({
  eyebrow,
  title,
  subtitle,
  action,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  action?: any;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <div className="mb-2 text-[10px] font-bold uppercase tracking-[.2em] text-[#a987a9]">
          {eyebrow}
        </div>
        <h1 className="serif text-[30px] leading-tight tracking-[-.7px] text-[#342b3c] md:text-[36px]">
          {title}
        </h1>
        <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-[#827889]">
          {subtitle}
        </p>
      </div>
      {action}
    </div>
  );
}
function Button({
  children,
  onClick,
  variant = "primary",
  testid,
  type = "button",
}: any) {
  const styles =
    variant === "primary"
      ? "bg-[#77518a] text-white hover:bg-[#684578] shadow-sm"
      : variant === "outline"
        ? "border border-[#e7dce9] bg-white text-[#66566e] hover:bg-[#faf6fb]"
        : "bg-transparent text-[#806d89] hover:bg-[#f7f1f8]";
  return (
    <button
      type={type}
      onClick={onClick}
      data-testid={testid}
      className={`inline-flex min-h-9 items-center justify-center gap-2 rounded-xl px-3.5 py-2 text-[12px] font-bold transition duration-150 active:scale-[.98] ${styles}`}
    >
      {children}
    </button>
  );
}
function Status({ value }: { value: string }) {
  const palette: any = {
    New: "bg-[#fff1e6] text-[#a56d3e]",
    "Under Review": "bg-[#f0eafb] text-[#765697]",
    "Proposal Ready": "bg-[#fcecf3] text-[#a3547c]",
    "Pending Approval": "bg-[#fdf3d9] text-[#9a7832]",
    Approved: "bg-[#e6f3eb] text-[#4e8062]",
    Completed: "bg-[#e6eff8] text-[#537a9b]",
    Draft: "bg-[#f0eafb] text-[#765697]",
    Upcoming: "bg-[#fcecf3] text-[#a3547c]",
    Ongoing: "bg-[#e6f3eb] text-[#4e8062]",
    Cancelled: "bg-[#fce9e7] text-[#a3524b]",
    Available: "bg-[#e6f3eb] text-[#4e8062]",
    Limited: "bg-[#fdf3d9] text-[#9a7832]",
  };
  return (
    <span
      data-testid={`status-${value.toLowerCase().replaceAll(" ", "-")}`}
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold leading-none ${palette[value] || "bg-[#f0edf1] text-[#756d7b]"}`}
    >
      {value}
    </span>
  );
}
function Panel({ children, className = "", ...props }: any) {
  return (
    <section className={`surface rounded-2xl ${className}`} {...props}>
      {children}
    </section>
  );
}
function SectionTitle({ children, aside }: any) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <h2 className="text-[14px] font-bold tracking-[-.15px] text-[#413747]">
        {children}
      </h2>
      {aside}
    </div>
  );
}
function Metric({ label, value, detail, icon: Icon, tone = "lavender" }: any) {
  const bgs: any = {
    lavender: "bg-[#eee7f4] text-[#76528a]",
    rose: "bg-[#f8e8ef] text-[#a35a7d]",
    sage: "bg-[#e8f1ec] text-[#59816d]",
    gold: "bg-[#f7f0df] text-[#9a7a3e]",
  };
  return (
    <Panel className="p-4 md:p-5">
      <div className="flex items-start justify-between">
        <span className="text-[11px] font-semibold text-[#8e8492]">
          {label}
        </span>
        <span
          className={`grid h-8 w-8 place-items-center rounded-xl ${bgs[tone]}`}
        >
          <Icon size={16} />
        </span>
      </div>
      <div
        className="mt-3 text-[25px] font-semibold tracking-[-1px] text-[#3d3345] md:text-[28px]"
        data-testid={`metric-${label.toLowerCase().replaceAll(" ", "-")}`}
      >
        {value}
      </div>
      <div className="mt-1 text-[10px] text-[#a098a5]">{detail}</div>
    </Panel>
  );
}
function Dashboard({ store, setLocation, openModal }: any) {
  const pending = store.proposals.filter(
    (p: Proposal) => p.status === "Pending Approval",
  );
  const upcoming = store.events
    .filter((e: EventItem) => e.status === "Upcoming")
    .sort((a: EventItem, b: EventItem) => a.date.localeCompare(b.date))
    .slice(0, 4);
  const recent = store.requests.slice(0, 4);
  return (
    <div className="fade-in">
      <PageHeading
        eyebrow="Tuesday, in the studio"
        title="A thoughtful day starts here."
        subtitle="Your celebrations, conversations and next steps — all in one calm place."
        action={
          <Button
            onClick={() => openModal({ kind: "request" })}
            testid="button-create-request-heading"
          >
            <Plus size={15} /> Create request
          </Button>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric
          label="Open requests"
          value={
            store.requests.filter(
              (r: Req) => !["Completed", "Approved"].includes(r.status),
            ).length
          }
          detail={`${store.requests.filter((r: Req) => r.status === "New").length} new · needs a first look`}
          icon={Mail}
          tone="lavender"
        />
        <Metric
          label="Updated requests/proposals"
          value={money(
            store.proposals
              .filter((p: Proposal) => p.status !== "Approved")
              .reduce(
                (a: number, p: Proposal) =>
                  a +
                  p.lines.reduce(
                    (b: number, l: Line) => b + l.qty * l.price,
                    0,
                  ),
                0,
              ),
          )}
          detail="Across active proposals"
          icon={CircleDollarSign}
          tone="rose"
        />
        <Metric
          label="Confirmed events"
          value={
            store.events.filter(
              (e: EventItem) =>
                e.status === "Upcoming" || e.status === "Ongoing",
            ).length
          }
          detail="Dates reserved in your calendar"
          icon={CalendarCheck}
          tone="sage"
        />
        <Metric
          label="Awaiting approval"
          value={pending.length}
          detail="Proposal review queue"
          icon={ClipboardCheck}
          tone="gold"
        />
      </div>
      <div className="grid gap-5 xl:grid-cols-[1.55fr_1fr]">
        <div className="space-y-5">
          <Panel className="overflow-hidden">
            <div className="flex flex-col gap-4 bg-[linear-gradient(105deg,#f5edf6_0%,#fbf0f3_66%,#f8f4f8_100%)] p-5 sm:flex-row sm:items-center sm:justify-between md:px-7 md:py-6">
              <div className="max-w-lg">
                <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.16em] text-[#9a729b]">
                  <Sparkles size={14} /> Today, with intention
                </div>
                <h2 className="serif text-[23px] leading-snug text-[#48374f]">
                  Every detail is taking shape.
                </h2>
                <p className="mt-2 text-[12px] leading-relaxed text-[#7e7184]">
                  Keep momentum on the moments that matter. There are{" "}
                  {pending.length} proposals ready for your review.
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => setLocation("/approvals")}
                testid="button-review-approvals"
              >
                Review approvals <ArrowRight size={14} />
              </Button>
            </div>
            <div className="grid grid-cols-3 divide-x divide-[#f0eaf1] px-4 py-4 md:px-7">
              <div>
                <p className="text-[10px] font-semibold text-[#99909f]">
                  NEXT CELEBRATION
                </p>
                <p className="mt-1 text-[12px] font-bold">
                  {upcoming[0]?.name || "Nothing scheduled"}
                </p>
                <p className="mt-1 text-[10px] text-[#9b919f]">
                  {upcoming[0]
                    ? dateLabel(upcoming[0].date, {
                        day: "numeric",
                        month: "short",
                      })
                    : "Create your first event"}
                </p>
              </div>
              <div className="pl-4">
                <p className="text-[10px] font-semibold text-[#99909f]">
                  THIS MONTH
                </p>
                <p className="mt-1 text-[12px] font-bold">
                  {store.events.length} events
                </p>
                <p className="mt-1 text-[10px] text-[#9b919f]">
                  Across your studio
                </p>
              </div>
              <div className="pl-4">
                <p className="text-[10px] font-semibold text-[#99909f]">
                  SUPPLIER PARTNERS
                </p>
                <p className="mt-1 text-[12px] font-bold">
                  {store.suppliers.length} trusted
                </p>
                <p className="mt-1 text-[10px] text-[#9b919f]">
                  Ready to make it happen
                </p>
              </div>
            </div>
          </Panel>
          <Panel className="p-4 md:p-5">
            <SectionTitle
              aside={
                <button
                  onClick={() => setLocation("/requests")}
                  className="text-[11px] font-bold text-[#896895] hover:underline"
                  data-testid="link-all-requests"
                >
                  All requests <ArrowRight size={12} className="ml-1 inline" />
                </button>
              }
            >
              Recently received
            </SectionTitle>
            <div className="divide-y divide-[#f1edf1]">
              {recent.map((r: Req) => (
                <Link
                  key={r.id}
                  href={`/requests/${r.id}`}
                  data-testid={`link-request-${r.id}`}
                  className="flex items-center gap-3 py-3 transition hover:bg-[#fcf9fc]"
                >
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#f5edf5] text-[11px] font-bold text-[#8c6792]">
                    {r.customer
                      .split(" ")
                      .slice(0, 2)
                      .map((s: string) => s[0])
                      .join("")}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-[12px] font-bold">
                        {r.name}
                      </span>
                      <span className="text-[10px] text-[#a79eaa]">{r.id}</span>
                    </div>
                    <p className="mt-1 truncate text-[10px] text-[#968d9a]">
                      {r.customer} · {r.type} ·{" "}
                      {dateLabel(r.date, { day: "numeric", month: "short" })}
                    </p>
                  </div>
                  <Status value={r.status} />
                  <span className="hidden text-[11px] font-semibold text-[#62586a] sm:block">
                    {money(r.budget)}
                  </span>
                  <ChevronRight size={15} className="text-[#b8afbb]" />
                </Link>
              ))}
            </div>
          </Panel>
        </div>
        <div className="space-y-5">
          <Panel className="p-4 md:p-5">
            <SectionTitle
              aside={
                <button
                  onClick={() => setLocation("/events")}
                  className="text-[11px] font-bold text-[#896895] hover:underline"
                  data-testid="link-all-events"
                >
                  View calendar
                </button>
              }
            >
              Coming up
            </SectionTitle>
            <div className="space-y-3">
              {upcoming.length ? (
                upcoming.map((e: EventItem) => (
                  <Link
                    href={`/events/${e.id}`}
                    key={e.id}
                    className="flex gap-3 rounded-xl border border-[#f1ebf2] p-3 transition hover:border-[#decce3] hover:bg-[#fdfafd]"
                    data-testid={`card-upcoming-${e.id}`}
                  >
                    <div className="flex w-12 shrink-0 flex-col items-center justify-center rounded-xl bg-[#f7edf4] py-2 text-[#96677f]">
                      <span className="text-[9px] font-bold uppercase">
                        {new Date(`${e.date}T12:00:00`).toLocaleDateString(
                          "en-MY",
                          { month: "short" },
                        )}
                      </span>
                      <span className="text-[18px] font-semibold leading-5">
                        {new Date(`${e.date}T12:00:00`).getDate()}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] font-bold">
                        {e.name}
                      </div>
                      <p className="mt-1 truncate text-[10px] text-[#968b9c]">
                        {e.customer} · {e.time}
                      </p>
                      <div className="mt-2 flex items-center gap-1 text-[10px] text-[#8e8094]">
                        <Users size={12} />
                        {e.guests} guests
                      </div>
                    </div>
                    <ChevronRight size={14} className="mt-1 text-[#afa2b4]" />
                  </Link>
                ))
              ) : (
                <Empty
                  title="A lovely date is waiting"
                  action={() => setLocation("/events")}
                  cta="See events"
                />
              )}
            </div>
          </Panel>
          <Panel className="p-4 md:p-5">
            <SectionTitle>Quick actions</SectionTitle>
            <div className="grid grid-cols-2 gap-2">
              <Quick
                onClick={() => openModal({ kind: "request" })}
                icon={Plus}
                label="New request"
                test="quick-new-request"
              />
              <Quick
                onClick={() => setLocation("/proposals")}
                icon={WandSparkles}
                label="Build proposal"
                test="quick-proposal"
              />
              <Quick
                onClick={() => setLocation("/calendar")}
                icon={CalendarDays}
                label="Check dates"
                test="quick-calendar"
              />
              <Quick
                onClick={() => setLocation("/suppliers")}
                icon={Package}
                label="Find supplier"
                test="quick-supplier"
              />
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
function Quick({ onClick, icon: Icon, label, test }: any) {
  return (
    <button
      onClick={onClick}
      data-testid={`button-${test}`}
      className="flex items-center gap-2 rounded-xl border border-[#f0eaf1] bg-[#fdfbfc] px-3 py-3 text-left text-[11px] font-semibold text-[#716678] transition hover:border-[#dccae2] hover:bg-[#f8f1f9]"
    >
      <Icon size={15} className="text-[#966e9b]" />
      {label}
    </button>
  );
}
function Empty({ title, action, cta = "Add new" }: any) {
  return (
    <div className="flex flex-col items-center py-8 text-center">
      <div className="mb-3 grid h-11 w-11 place-items-center rounded-2xl bg-[#f3edf5] text-[#9875a1]">
        <Heart size={18} />
      </div>
      <p className="text-[12px] font-bold text-[#62566a]">{title}</p>
      {action && (
        <button
          onClick={action}
          className="mt-3 text-[11px] font-bold text-[#805b8f] hover:underline"
          data-testid="button-empty-action"
        >
          {cta}
        </button>
      )}
    </div>
  );
}
function Requests({ store, setLocation, openModal }: any) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All");
  const filtered = store.requests.filter(
    (r: Req) =>
      (filter === "All" || r.status === filter) &&
      `${r.customer} ${r.name} ${r.id} ${r.type}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <div className="fade-in">
      <PageHeading
        eyebrow="Your inbox"
        title="Customer requests"
        subtitle="Every celebration begins with a conversation. Find the details, then shape the next step."
        action={
          <Button
            onClick={() => openModal({ kind: "request" })}
            testid="button-add-request"
          >
            <Plus size={15} /> Add request
          </Button>
        }
      />
      <Panel className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-[#f0ebf1] p-4 md:flex-row md:items-center md:justify-between">
          <div className="relative w-full md:max-w-[340px]">
            <Search
              size={15}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[#a69baa]"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search customer, event or ID..."
              className="h-10 w-full rounded-xl border border-[#eee7ef] bg-[#fcfafc] pl-9 pr-3 text-[12px] outline-none focus:border-[#c9a9d1]"
              data-testid="input-search-requests"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Filter size={14} className="text-[#9c92a0]" />
            {[
              "All",
              "New",
              "Under Review",
              "Proposal Ready",
              "Pending Approval",
              "Approved",
              "Completed",
            ].map((x) => (
              <button
                key={x}
                onClick={() => setFilter(x)}
                className={`rounded-full px-3 py-2 text-[10px] font-bold transition ${filter === x ? "bg-[#77518a] text-white" : "bg-[#f7f3f8] text-[#827588] hover:bg-[#eee5f1]"}`}
                data-testid={`filter-request-${x.toLowerCase().replaceAll(" ", "-")}`}
              >
                {x}
              </button>
            ))}
          </div>
        </div>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[800px] text-left">
            <thead>
              <tr className="bg-[#fcfafc] text-[9px] font-bold uppercase tracking-[.14em] text-[#a096a5]">
                <th className="px-5 py-3">Customer / event</th>
                <th className="px-4 py-3">Celebration</th>
                <th className="px-4 py-3">Event date</th>
                <th className="px-4 py-3">Guests</th>
                <th className="px-4 py-3">Budget</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r: Req) => (
                <tr
                  key={r.id}
                  onClick={() => setLocation(`/requests/${r.id}`)}
                  className="cursor-pointer border-t border-[#f3eff3] transition hover:bg-[#fdfafd]"
                  data-testid={`row-request-${r.id}`}
                >
                  <td className="px-5 py-4">
                    <div className="text-[12px] font-bold">{r.customer}</div>
                    <div className="mt-1 text-[10px] text-[#9a919f]">
                      {r.id} · {r.name}
                    </div>
                  </td>
                  <td className="px-4 py-4 text-[11px] text-[#756b7c]">
                    {r.type}
                  </td>
                  <td className="px-4 py-4 text-[11px] text-[#756b7c]">
                    {dateLabel(r.date)}
                    <div className="mt-1 text-[10px] text-[#a39aa7]">
                      {r.time}
                    </div>
                  </td>
                  <td className="px-4 py-4 text-[11px]">{r.guests}</td>
                  <td className="px-4 py-4 text-[11px] font-semibold">
                    {money(r.budget)}
                  </td>
                  <td className="px-4 py-4">
                    <Status value={r.status} />
                  </td>
                  <td className="px-4 py-4">
                    <ChevronRight size={15} className="text-[#aaa0ae]" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length && <Empty title="No requests match this view" />}
        </div>
        <div className="space-y-2 p-3 md:hidden">
          {filtered.map((r: Req) => (
            <Link
              href={`/requests/${r.id}`}
              key={r.id}
              className="block rounded-xl border border-[#f0eaf1] p-3"
              data-testid={`card-request-${r.id}`}
            >
              <div className="flex justify-between gap-2">
                <div>
                  <div className="text-[12px] font-bold">{r.customer}</div>
                  <p className="mt-1 text-[10px] text-[#968b9b]">
                    {r.name} · {r.id}
                  </p>
                </div>
                <Status value={r.status} />
              </div>
              <div className="mt-3 flex justify-between text-[10px] text-[#877d8b]">
                <span>
                  {r.type} ·{" "}
                  {dateLabel(r.date, { day: "numeric", month: "short" })}
                </span>
                <b>{money(r.budget)}</b>
              </div>
            </Link>
          ))}
        </div>
      </Panel>
    </div>
  );
}
function RequestDetail({
  store,
  updateRequest,
  createProposal,
  setLocation,
}: any) {
  const { id = "" } = useParams();
  const r: Req | undefined = store.requests.find((x: Req) => x.id === id);
  if (!r) return <NotFound />;
  const proposal = store.proposals.find((p: Proposal) => p.requestId === r.id);
  return (
    <div className="fade-in">
      <button
        onClick={() => setLocation("/requests")}
        className="mb-5 flex items-center gap-2 text-[11px] font-bold text-[#8e7a96] hover:text-[#674676]"
        data-testid="button-back-requests"
      >
        <ArrowLeft size={15} /> All requests
      </button>
      <PageHeading
        eyebrow={`Request ${r.id}`}
        title={r.name}
        subtitle={`${r.type} · received ${dateLabel(r.date, { day: "numeric", month: "long" })}`}
        action={<Status value={r.status} />}
      />
      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-5">
          <Panel className="p-5 md:p-6">
            <SectionTitle>Celebration details</SectionTitle>
            <div className="grid grid-cols-2 gap-x-5 gap-y-5 sm:grid-cols-3">
              {[
                ["Event date", dateLabel(r.date)],
                ["Start time", r.time],
                ["Guest count", `${r.guests} guests`],
                ["Budget", money(r.budget)],
                ["Event type", r.type],
                ["Request ID", r.id],
              ].map(([a, b]) => (
                <div key={a}>
                  <p className="text-[10px] font-semibold uppercase tracking-[.1em] text-[#a197a5]">
                    {a}
                  </p>
                  <p className="mt-1.5 text-[12px] font-semibold">{b}</p>
                </div>
              ))}
            </div>
            <div className="mt-6 border-t border-[#f1edf1] pt-5">
              <p className="text-[10px] font-semibold uppercase tracking-[.1em] text-[#a197a5]">
                Requested services
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {r.services.map((s: string) => (
                  <span
                    key={s}
                    className="rounded-full bg-[#f5eff6] px-3 py-1.5 text-[10px] font-semibold text-[#765c7d]"
                  >
                    {s}
                  </span>
                ))}
              </div>
            </div>
            <div className="mt-5 rounded-xl bg-[#fcf9fc] p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[.1em] text-[#a197a5]">
                Notes from {r.customer.split(" ")[0]}
              </p>
              <p className="mt-2 text-[12px] leading-relaxed text-[#6f6574]">
                {r.notes}
              </p>
            </div>
          </Panel>
          <Panel className="p-5 md:p-6">
            <SectionTitle>Contact details</SectionTitle>
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-[12px]">
                <Mail size={15} className="text-[#a47ba7]" />
                <a className="hover:underline" href={`mailto:${r.email}`}>
                  {r.email}
                </a>
              </div>
              <div className="flex items-center gap-3 text-[12px]">
                <Phone size={15} className="text-[#a47ba7]" />
                <a className="hover:underline" href={`tel:${r.phone}`}>
                  {r.phone}
                </a>
              </div>
            </div>
          </Panel>
        </div>
        <div className="space-y-5">
          <Panel className="p-5 md:p-6">
            <div className="mb-4 flex items-center gap-2">
              <WandSparkles size={16} className="text-[#976f9e]" />
              <h2 className="text-[14px] font-bold">Move this forward</h2>
            </div>
            <p className="mb-5 text-[11px] leading-relaxed text-[#877d8b]">
              Build a tailored proposal from the brief, or update its status as
              your conversation develops.
            </p>
            {proposal ? (
              <div className="rounded-xl border border-[#eee7ef] bg-[#fcfafc] p-4">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold">{proposal.id}</span>
                  <Status value={proposal.status} />
                </div>
                <Button
                  onClick={() => setLocation(`/proposals/${proposal.id}`)}
                  variant="outline"
                  testid="button-open-request-proposal"
                >
                  View proposal <ArrowRight size={13} />
                </Button>
              </div>
            ) : (
              <Button
                onClick={() => createProposal(r)}
                testid="button-generate-proposal"
              >
                <Sparkles size={14} /> Generate proposal
              </Button>
            )}
            <div className="mt-5 border-t border-[#f1edf1] pt-4">
              <label
                className="mb-2 block text-[10px] font-bold uppercase tracking-[.1em] text-[#9a909f]"
                htmlFor="request-status"
              >
                Request status
              </label>
              <select
                id="request-status"
                value={r.status}
                onChange={(e) =>
                  updateRequest(r.id, { status: e.target.value })
                }
                className="h-10 w-full rounded-xl border border-[#eee7ef] bg-white px-3 text-[12px]"
                data-testid="select-request-status"
              >
                {[
                  "New",
                  "Under Review",
                  "Proposal Ready",
                  "Pending Approval",
                  "Approved",
                  "Completed",
                ].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </div>
          </Panel>
          <Panel className="p-5">
            <SectionTitle>At a glance</SectionTitle>
            <div className="space-y-3 text-[11px]">
              <div className="flex justify-between">
                <span className="text-[#918695]">Customer</span>
                <b>{r.customer}</b>
              </div>
              <div className="flex justify-between">
                <span className="text-[#918695]">Budget per guest</span>
                <b>{money(Math.round(r.budget / r.guests))}</b>
              </div>
              <div className="flex justify-between">
                <span className="text-[#918695]">Date availability</span>
                <b className="text-[#5d8b70]">Check calendar</b>
              </div>
            </div>
            <button
              onClick={() => setLocation("/calendar")}
              className="mt-4 text-[11px] font-bold text-[#855e91] hover:underline"
              data-testid="link-check-calendar"
            >
              Open availability <ArrowRight size={12} className="ml-1 inline" />
            </button>
          </Panel>
        </div>
      </div>
    </div>
  );
}
function Proposals({ store, setLocation }: any) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All");
  const list = store.proposals.filter(
    (p: Proposal) =>
      (filter === "All" || p.status === filter) &&
      `${p.event} ${p.customer} ${p.id}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <div className="fade-in">
      <PageHeading
        eyebrow="Thoughtful proposals"
        title="Proposals"
        subtitle="Bring each brief to life with a clear plan, transparent investment and a little inspiration."
        action={
          <Button
            onClick={() => setLocation("/requests")}
            testid="button-start-proposal"
          >
            <Plus size={15} /> Start from request
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        {[
          "All",
          "Draft",
          "Pending Approval",
          "Approved",
          "Revision Requested",
        ].map((x) => (
          <button
            key={x}
            onClick={() => setFilter(x)}
            className={`rounded-full px-3.5 py-2 text-[10px] font-bold ${x === filter ? "bg-[#77518a] text-white" : "bg-white text-[#87798e] border border-[#eee7ef] hover:bg-[#f8f3f9]"}`}
            data-testid={`filter-proposal-${x.toLowerCase().replaceAll(" ", "-")}`}
          >
            {x}
          </button>
        ))}
      </div>
      <div className="mb-4 relative max-w-sm">
        <Search
          size={15}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-[#a69baa]"
        />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search proposals..."
          className="h-10 w-full rounded-xl border border-[#eee7ef] bg-white pl-9 pr-3 text-[12px]"
          data-testid="input-search-proposals"
        />
      </div>
      {list.length ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {list.map((p: Proposal) => (
            <ProposalCard key={p.id} proposal={p} setLocation={setLocation} />
          ))}
        </div>
      ) : (
        <Panel>
          <Empty
            title="No proposals in this view"
            action={() => setLocation("/requests")}
            cta="Choose a request"
          />
        </Panel>
      )}
    </div>
  );
}
function ProposalCard({ proposal: p, setLocation }: any) {
  const total = p.lines.reduce((s: number, l: Line) => s + l.qty * l.price, 0);
  return (
    <Panel
      className="overflow-hidden transition hover:-translate-y-0.5 hover:shadow-md"
      data-testid={`card-proposal-${p.id}`}
    >
      <div className="grid sm:grid-cols-[145px_1fr]">
        <Moodboard type={p.type} />
        <div className="p-4 md:p-5">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[.13em] text-[#a181a6]">
                {p.id} · {p.type}
              </div>
              <h2 className="serif mt-1 text-[20px]">{p.event}</h2>
              <p className="mt-1 text-[11px] text-[#8a7f91]">
                {p.customer} ·{" "}
                {dateLabel(p.date, {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </p>
            </div>
            <Status value={p.status} />
          </div>
          <p className="mt-3 line-clamp-2 text-[11px] leading-relaxed text-[#827787]">
            {p.recommendation}
          </p>
          <div className="mt-4 flex items-end justify-between border-t border-[#f1edf1] pt-3">
            <div>
              <p className="text-[9px] font-bold uppercase tracking-[.12em] text-[#a49aa8]">
                Investment
              </p>
              <p className="mt-1 text-[16px] font-semibold">{money(total)}</p>
            </div>
            <Button
              variant="outline"
              onClick={() => setLocation(`/proposals/${p.id}`)}
              testid={`button-open-proposal-${p.id}`}
            >
              Open proposal <ArrowRight size={13} />
            </Button>
          </div>
        </div>
      </div>
    </Panel>
  );
}
function Moodboard({ type }: any) {
  const isWed = type === "Wedding" || type === "Engagement";
  return (
    <div
      className={`relative flex min-h-[142px] flex-col justify-between overflow-hidden p-4 ${isWed ? "bg-[linear-gradient(145deg,#e9dce8,#f5e8e8_54%,#d9d2e3)]" : "bg-[linear-gradient(145deg,#f4e5ea,#e9e0f0_56%,#f5eadc)]"}`}
    >
      <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full border border-white/45" />
      <div className="absolute right-5 top-8 h-20 w-20 rounded-full border border-white/55" />
      <div className="absolute bottom-[-35px] left-[-22px] h-28 w-28 rounded-full bg-white/25" />
      <div className="relative flex gap-1">
        <span className="h-4 w-4 rounded-full border border-white/70 bg-[#e8cfd5]" />
        <span className="h-4 w-4 rounded-full border border-white/70 bg-[#c9bfd9]" />
        <span className="h-4 w-4 rounded-full border border-white/70 bg-[#efe5d7]" />
      </div>
      <div className="relative">
        <p className="serif text-[17px] italic text-[#6f596f]">the feeling</p>
        <p className="text-[8px] font-semibold uppercase tracking-[.15em] text-[#806f84]">
          Moodboard · concept
        </p>
      </div>
    </div>
  );
}
function ProposalDetail({ store, saveProposal, approve, accept, flash }: any) {
  const { id = "" } = useParams();
  const p0: Proposal | undefined = store.proposals.find(
    (x: Proposal) => x.id === id,
  );
  const [p, setP] = useState<Proposal | null>(null);
  useEffect(() => {
    if (p0) setP(p0);
  }, [p0]);
  if (!p) return <NotFound />;
  const total = p.lines.reduce((a, l) => a + l.qty * l.price, 0);
  const req = store.requests.find((r: Req) => r.id === p.requestId);
  const patch = (next: Proposal) => {
    setP(next);
    saveProposal(next);
  };
  const updateLine = (i: number, key: keyof Line, value: string) => {
    const lines = p.lines.map((l, j) =>
      j === i ? { ...l, [key]: key === "service" ? value : Number(value) } : l,
    );
    patch({ ...p, lines });
  };
  return (
    <div className="fade-in">
      <Link
        href="/proposals"
        className="mb-5 flex items-center gap-2 text-[11px] font-bold text-[#8e7a96]"
        data-testid="link-back-proposals"
      >
        <ArrowLeft size={15} /> All proposals
      </Link>
      <PageHeading
        eyebrow={`${p.id} · ${p.type}`}
        title={p.event}
        subtitle={`Prepared for ${p.customer} · ${dateLabel(p.date)}`}
        action={<Status value={p.status} />}
      />
      <div className="grid gap-5 xl:grid-cols-[1.55fr_1fr]">
        <div className="space-y-5">
          <Panel className="overflow-hidden">
            <Moodboard type={p.type} />
            <div className="p-5 md:p-7">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="serif text-[23px]">A day to remember</h2>
                <Button
                  variant="outline"
                  onClick={() => {
                    patch({
                      ...p,
                      recommendation: `A refreshed concept for ${p.event}: thoughtful pacing, locally sourced details and a memorable guest experience. Budget remains aligned with the original brief.`,
                    });
                    flash("Concept refreshed with a new direction");
                  }}
                  testid="button-regenerate-proposal"
                >
                  <RotateCcw size={13} /> Regenerate
                </Button>
              </div>
              <textarea
                value={p.recommendation}
                onChange={(e) => setP({ ...p, recommendation: e.target.value })}
                onBlur={() => saveProposal(p)}
                className="min-h-[76px] w-full resize-y rounded-xl border border-[#eee7ef] bg-[#fdfbfd] p-3 text-[12px] leading-relaxed text-[#756b7b]"
                aria-label="AI recommendation"
                data-testid="input-proposal-recommendation"
              />
              <div className="mt-6 flex items-center justify-between">
                <h3 className="text-[13px] font-bold">Investment outline</h3>
                <button
                  onClick={() =>
                    patch({
                      ...p,
                      lines: [
                        ...p.lines,
                        { service: "New service", qty: 1, price: 0 },
                      ],
                    })
                  }
                  className="flex items-center gap-1 text-[10px] font-bold text-[#865d92]"
                  data-testid="button-add-proposal-line"
                >
                  <Plus size={13} /> Add line
                </button>
              </div>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[480px] text-left">
                  <thead>
                    <tr className="text-[9px] font-bold uppercase tracking-[.12em] text-[#a299a7]">
                      <th className="pb-2">Service</th>
                      <th className="pb-2">Qty</th>
                      <th className="pb-2">Unit price</th>
                      <th className="pb-2 text-right">Total</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.lines.map((l, i) => (
                      <tr key={i} className="border-t border-[#f1edf1]">
                        <td className="py-2 pr-2">
                          <input
                            value={l.service}
                            onChange={(e) =>
                              updateLine(i, "service", e.target.value)
                            }
                            className="w-full rounded-lg border border-transparent bg-transparent px-2 py-2 text-[11px] hover:border-[#eee7ef] focus:border-[#c9a9d1]"
                            data-testid={`input-line-service-${i}`}
                          />
                        </td>
                        <td className="py-2">
                          <input
                            type="number"
                            min="1"
                            value={l.qty}
                            onChange={(e) =>
                              updateLine(i, "qty", e.target.value)
                            }
                            className="w-[58px] rounded-lg border border-[#eee7ef] px-2 py-2 text-[11px]"
                            data-testid={`input-line-quantity-${i}`}
                          />
                        </td>
                        <td className="py-2">
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] text-[#9b909f]">
                              RM
                            </span>
                            <input
                              type="number"
                              min="0"
                              value={l.price}
                              onChange={(e) =>
                                updateLine(i, "price", e.target.value)
                              }
                              className="w-[86px] rounded-lg border border-[#eee7ef] px-2 py-2 text-[11px]"
                              data-testid={`input-line-price-${i}`}
                            />
                          </div>
                        </td>
                        <td className="py-2 text-right text-[11px] font-bold">
                          {money(l.qty * l.price)}
                        </td>
                        <td className="pl-2">
                          <button
                            onClick={() =>
                              patch({
                                ...p,
                                lines: p.lines.filter(
                                  (_: Line, j: number) => j !== i,
                                ),
                              })
                            }
                            aria-label={`Remove ${l.service}`}
                            className="rounded p-1 text-[#ad99aa] hover:bg-[#f9edf2] hover:text-[#a3547c]"
                            data-testid={`button-remove-line-${i}`}
                          >
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 flex justify-between border-t border-[#eee8ef] pt-4">
                <span className="text-[12px] font-bold">Grand total</span>
                <span
                  className="text-[18px] font-bold text-[#684b74]"
                  data-testid="text-proposal-total"
                >
                  {money(total)}
                </span>
              </div>
              <p className="mt-2 text-right text-[10px] text-[#a198a4]">
                Budget {money(p.budget)} ·{" "}
                {total <= p.budget ? "within budget" : "over budget"}
              </p>
            </div>
          </Panel>
          <Panel className="p-5">
            <SectionTitle>Approval checklist</SectionTitle>
            <div className="grid gap-2 sm:grid-cols-2">
              {Object.entries({
                budget: "Budget verified",
                supplier: "Supplier availability",
                schedule: "Schedule checked",
                reviewed: "Proposal reviewed",
              }).map(([k, label]) => (
                <label
                  key={k}
                  className="flex cursor-pointer items-center gap-3 rounded-xl border border-[#f0ebf1] p-3 text-[11px] font-semibold hover:bg-[#fcf9fc]"
                >
                  <input
                    type="checkbox"
                    checked={(p.checklist as any)[k]}
                    onChange={(e) =>
                      patch({
                        ...p,
                        checklist: { ...p.checklist, [k]: e.target.checked },
                      })
                    }
                    className="h-4 w-4 accent-[#80588e]"
                    data-testid={`checkbox-${k}`}
                  />
                  {(p.checklist as any)[k] ? (
                    <CheckCircle2 size={15} className="text-[#679177]" />
                  ) : (
                    <Clock3 size={15} className="text-[#b3a8b6]" />
                  )}
                  {label}
                </label>
              ))}
            </div>
          </Panel>
        </div>
        <aside className="space-y-5">
          <Panel className="p-5">
            <SectionTitle>Ready for the next step?</SectionTitle>
            <p className="mb-4 text-[11px] leading-relaxed text-[#877d8b]">
              A clear review today makes for a confident conversation tomorrow.
            </p>
            <div className="space-y-2">
              <Button
                onClick={() => {
                  patch({ ...p, status: "Pending Approval" });
                  if (req) {
                  }
                  flash("Proposal submitted for approval");
                }}
                testid="button-submit-approval"
              >
                <Send size={14} /> Submit for approval
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  patch({
                    ...p,
                    status: "Revision Requested",
                    revision:
                      window.prompt("What needs to change?") ||
                      "Revision requested by studio",
                  });
                  flash("Revision request saved");
                }}
                testid="button-request-revision"
              >
                <Edit3 size={14} /> Request revision
              </Button>
              {p.status === "Pending Approval" || p.status === "Approved" ? (
                <Button
                  variant="outline"
                  onClick={() => approve(p)}
                  testid="button-approve-send"
                >
                  <Check size={14} /> Approve &amp; send to customer
                </Button>
              ) : null}

              {p.status === "Awaiting Customer" ? (
                <Button
                  variant="outline"
                  onClick={() => accept(p)}
                  testid="button-accept-proposal"
                >
                  <Check size={14} />
                  Accept Proposal (Customer Demo)
                </Button>
              ) : null}
            </div>
            <button
              onClick={() => {
                saveProposal(p);
                flash("Proposal changes saved");
              }}
              className="mt-3 w-full rounded-xl py-2 text-[10px] font-bold text-[#86648f] hover:bg-[#f8f3f9]"
              data-testid="button-save-proposal"
            >
              Save changes
            </button>
          </Panel>
          <Panel className="p-5">
            <SectionTitle>Event snapshot</SectionTitle>
            <div className="space-y-3 text-[11px]">
              <div className="flex justify-between">
                <span className="text-[#918695]">Customer</span>
                <b>{p.customer}</b>
              </div>
              <div className="flex justify-between">
                <span className="text-[#918695]">Date</span>
                <b>{dateLabel(p.date, { day: "numeric", month: "short" })}</b>
              </div>
              <div className="flex justify-between">
                <span className="text-[#918695]">Guests</span>
                <b>{req?.guests || "—"}</b>
              </div>
              <div className="flex justify-between">
                <span className="text-[#918695]">Request</span>
                <Link
                  href={`/requests/${p.requestId}`}
                  className="font-bold text-[#855e91] hover:underline"
                  data-testid="link-proposal-request"
                >
                  {p.requestId}
                </Link>
              </div>
            </div>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
function Approvals({ store, setLocation, approve, saveProposal, flash }: any) {
  const pending = store.proposals.filter(
    (p: Proposal) => p.status === "Pending Approval",
  );
  return (
    <div className="fade-in">
      <PageHeading
        eyebrow="The finishing touch"
        title="Approval queue"
        subtitle="A clear, considered review before every proposal is shared with a customer."
      />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3">
        <Metric
          label="Waiting for review"
          value={pending.length}
          detail="Ready for your attention"
          icon={ClipboardCheck}
          tone="gold"
        />
        <Metric
          label="Value in queue"
          value={money(
            pending.reduce(
              (a: number, p: Proposal) =>
                a +
                p.lines.reduce((b: number, l: Line) => b + l.qty * l.price, 0),
              0,
            ),
          )}
          detail="Potential event value"
          icon={CircleDollarSign}
          tone="rose"
        />
        <Metric
          label="Checklist complete"
          value={`${pending.filter((p: Proposal) => Object.values(p.checklist).every(Boolean)).length} / ${pending.length}`}
          detail="Every detail checked"
          icon={ListChecks}
          tone="sage"
        />
      </div>
      {pending.length ? (
        <div className="space-y-4">
          {pending.map((p: Proposal) => (
            <ApprovalCard
              key={p.id}
              p={p}
              approve={approve}
              saveProposal={saveProposal}
              setLocation={setLocation}
              flash={flash}
            />
          ))}
        </div>
      ) : (
        <Panel>
          <Empty
            title="Your approval queue is clear"
            action={() => setLocation("/proposals")}
            cta="View all proposals"
          />
        </Panel>
      )}
    </div>
  );
}
function ApprovalCard({ p, approve, saveProposal, setLocation, flash }: any) {
  const [checklist, setChecklist] = useState(p.checklist);
  const total = p.lines.reduce((a: number, l: Line) => a + l.qty * l.price, 0);
  const toggle = (k: string) => {
    const next = { ...checklist, [k]: !(checklist as any)[k] };
    setChecklist(next);
    saveProposal({ ...p, checklist: next });
  };
  return (
    <Panel className="p-4 md:p-5" data-testid={`card-approval-${p.id}`}>
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div className="flex gap-3">
          <Moodboard type={p.type} />
          <div>
            <div className="text-[9px] font-bold uppercase tracking-[.14em] text-[#a181a6]">
              {p.id} · {p.type}
            </div>
            <h2 className="serif mt-1 text-[19px]">{p.event}</h2>
            <p className="mt-1 text-[11px] text-[#8c8190]">
              {p.customer} · {dateLabel(p.date)}
            </p>
            <p className="mt-2 text-[14px] font-bold">
              {money(total)}{" "}
              <span className="text-[10px] font-normal text-[#9e94a2]">
                of {money(p.budget)} budget
              </span>
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          onClick={() => setLocation(`/proposals/${p.id}`)}
          testid={`button-review-proposal-${p.id}`}
        >
          <Eye size={14} /> Full review
        </Button>
      </div>
      <p className="my-4 rounded-xl bg-[#fcf9fc] p-3 text-[11px] leading-relaxed text-[#7d7183]">
        {p.recommendation}
      </p>
      <div className="flex flex-wrap gap-2">
        {Object.entries({
          budget: "Budget verified",
          supplier: "Supplier available",
          schedule: "Schedule checked",
          reviewed: "Proposal reviewed",
        }).map(([k, label]) => (
          <button
            key={k}
            onClick={() => toggle(k)}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-2 text-[10px] font-semibold ${checklist[k as keyof typeof checklist] ? "border-[#d8e9dc] bg-[#eff7f0] text-[#548064]" : "border-[#eee7ef] bg-white text-[#968b9a]"}`}
            data-testid={`button-approval-check-${k}`}
          >
            {checklist[k as keyof typeof checklist] ? (
              <CheckCircle2 size={13} />
            ) : (
              <span className="h-3 w-3 rounded-full border border-[#c7bbc9]" />
            )}
            {label}
          </button>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-[#f1edf1] pt-4">
        <Button
          variant="outline"
          onClick={() => {
            saveProposal({
              ...p,
              status: "Revision Requested",
              revision: "Revision requested by studio",
            });
            flash("Revision requested");
          }}
          testid={`button-revision-${p.id}`}
        >
          Request revision
        </Button>
        <Button
          onClick={() => approve({ ...p, checklist })}
          testid={`button-approve-${p.id}`}
        >
          <Check size={14} /> Approve &amp; send
        </Button>
      </div>
    </Panel>
  );
}
function Events({ store, setLocation }: any) {
  const [filter, setFilter] = useState("All");
  const [search, setSearch] = useState("");
  const events = store.events
    .filter(
      (e: EventItem) =>
        (filter === "All" || e.status === filter) &&
        `${e.name} ${e.customer} ${e.id}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .sort((a: EventItem, b: EventItem) => a.date.localeCompare(b.date));
  return (
    <div className="fade-in">
      <PageHeading
        eyebrow="Celebrations in motion"
        title="Events"
        subtitle="Your confirmed moments, from the first run sheet to the final farewell."
        action={
          <Button
            variant="outline"
            onClick={() => setLocation("/calendar")}
            testid="button-events-calendar"
          >
            <CalendarDays size={14} /> Availability
          </Button>
        }
      />
      <Panel className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-[#f0ebf1] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-xs">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[#a69baa]"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Find an event..."
              className="h-10 w-full rounded-xl border border-[#eee7ef] bg-[#fcfafc] pl-9 text-[12px]"
              data-testid="input-search-events"
            />
          </div>
          <div className="flex gap-2">
            {["All", "Upcoming", "Ongoing", "Completed", "Cancelled"].map(
              (s) => (
                <button
                  key={s}
                  onClick={() => setFilter(s)}
                  className={`rounded-full px-3 py-2 text-[10px] font-bold ${filter === s ? "bg-[#77518a] text-white" : "bg-[#f7f3f8] text-[#827588]"}`}
                  data-testid={`filter-event-${s.toLowerCase()}`}
                >
                  {s}
                </button>
              ),
            )}
          </div>
        </div>
        <div className="grid gap-3 p-3 md:p-5 lg:grid-cols-2">
          {events.map((e: EventItem) => (
            <button
              onClick={() => setLocation(`/events/${e.id}`)}
              key={e.id}
              className="flex items-center gap-3 rounded-xl border border-[#f0eaf1] p-4 text-left transition hover:border-[#d9c7df] hover:bg-[#fdfafd]"
              data-testid={`card-event-${e.id}`}
            >
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-[#f2eaf4] text-[#805c8e]">
                <CalendarDays size={19} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-[12px] font-bold">
                    {e.name}
                  </span>
                  <Status value={e.status} />
                </div>
                <p className="mt-1 text-[10px] text-[#918695]">
                  {e.customer} · {e.id}
                </p>
                <p className="mt-1 text-[10px] text-[#8f8494]">
                  {dateLabel(e.date)} · {e.time} · {e.guests} guests
                </p>
              </div>
              <div className="text-right">
                <div className="text-[12px] font-bold">{money(e.value)}</div>
                <ChevronRight
                  size={15}
                  className="ml-auto mt-2 text-[#a79cab]"
                />
              </div>
            </button>
          ))}
        </div>
        {!events.length && <Empty title="No events in this view" />}
      </Panel>
    </div>
  );
}
function EventsWithCreate({ store, setLocation, openModal }: any) {
  return (
    <div>
      <div className="mb-3 flex justify-end">
        <Button
          onClick={() => openModal({ kind: "event" })}
          testid="button-create-event"
        >
          <Plus size={14} /> Create event
        </Button>
      </div>
      <Events store={store} setLocation={setLocation} />
    </div>
  );
}
function EventDetail({ store, setLocation, updateEvent }: any) {
  const { id = "" } = useParams();
  const e: EventItem | undefined = store.events.find(
    (x: EventItem) => x.id === id,
  );
  if (!e) return <NotFound />;
  return (
    <div className="fade-in">
      <button
        onClick={() => setLocation("/events")}
        className="mb-5 flex items-center gap-2 text-[11px] font-bold text-[#8e7a96]"
        data-testid="button-back-events"
      >
        <ArrowLeft size={15} /> All events
      </button>
      <PageHeading
        eyebrow={`${e.id} · ${e.type}`}
        title={e.name}
        subtitle={`A celebration for ${e.customer}`}
        action={<Status value={e.status} />}
      />
      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Panel className="overflow-hidden">
          <div className="bg-[linear-gradient(130deg,#eee4f0,#f8e9ee_62%,#f5efe4)] px-6 py-10 md:px-10">
            <p className="text-[10px] font-bold uppercase tracking-[.18em] text-[#9978a0]">
              The celebration
            </p>
            <p className="serif mt-2 text-[30px] text-[#4d3e54]">{e.name}</p>
            <p className="mt-2 text-[12px] text-[#847389]">
              {e.customer} · {e.guests} guests
            </p>
          </div>
          <div className="grid grid-cols-2 gap-5 p-5 md:grid-cols-4">
            <div>
              <p className="text-[9px] font-bold uppercase tracking-[.12em] text-[#a49aa8]">
                Date
              </p>
              <p className="mt-2 text-[12px] font-bold">{dateLabel(e.date)}</p>
            </div>
            <div>
              <p className="text-[9px] font-bold uppercase tracking-[.12em] text-[#a49aa8]">
                Start time
              </p>
              <p className="mt-2 text-[12px] font-bold">{e.time}</p>
            </div>
            <div>
              <p className="text-[9px] font-bold uppercase tracking-[.12em] text-[#a49aa8]">
                Guests
              </p>
              <p className="mt-2 text-[12px] font-bold">{e.guests}</p>
            </div>
            <div>
              <p className="text-[9px] font-bold uppercase tracking-[.12em] text-[#a49aa8]">
                Event value
              </p>
              <p className="mt-2 text-[12px] font-bold">{money(e.value)}</p>
            </div>
          </div>
        </Panel>
        <Panel className="p-5">
          <SectionTitle>Event status</SectionTitle>
          <p className="mb-4 text-[11px] leading-relaxed text-[#877d8b]">
            Keep your event board current as the day gets closer.
          </p>
          <select
            value={e.status}
            onChange={(ev) => updateEvent(e.id, ev.target.value)}
            className="h-10 w-full rounded-xl border border-[#eee7ef] bg-white px-3 text-[12px]"
            data-testid="select-event-status"
          >
            {["Upcoming", "Ongoing", "Completed", "Cancelled"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <div className="mt-5 rounded-xl bg-[#f8f3f9] p-4">
            <p className="text-[10px] font-bold uppercase tracking-[.12em] text-[#9a7ca0]">
              Reserved calendar slot
            </p>
            <p className="mt-2 text-[12px] font-semibold">
              {dateLabel(e.date)} · {e.time}
            </p>
            <p className="mt-1 text-[10px] text-[#95899a]">
              This time is marked unavailable for new events.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => setLocation("/calendar")}
            testid="button-event-calendar"
          >
            <CalendarDays size={14} /> View in calendar
          </Button>
        </Panel>
      </div>
    </div>
  );
}
function CalendarPage({ store }: any) {
  const [view, setView] = useState<"Month" | "Week" | "Day">("Month");
  const [month, setMonth] = useState(
    new Date(today.getFullYear(), today.getMonth(), 1),
  );
  const [selected, setSelected] = useState(dateAt(0));
  const events = store.events;
  const year = month.getFullYear(),
    m = month.getMonth();
  const days = new Date(year, m + 1, 0).getDate();
  const offset = new Date(year, m, 1).getDay();
  const monthName = month.toLocaleDateString("en-MY", {
    month: "long",
    year: "numeric",
  });
  const statusClass = (e: EventItem) =>
    e.status === "Completed"
      ? "bg-[#dfeaf7] text-[#50749a]"
      : e.status === "Ongoing"
        ? "bg-[#f8dddd] text-[#a64e55]"
        : "bg-[#fff0c7] text-[#8d7130]";
  const selectedEvents = events.filter((e: EventItem) => e.date === selected);
  const move = (n: number) => {
    const next = new Date(month);
    next.setMonth(next.getMonth() + n);
    setMonth(next);
  };
  return (
    <div className="fade-in">
      <PageHeading
        eyebrow="Plan with confidence"
        title="Availability"
        subtitle="See where your calendar has room to breathe — and which dates are already spoken for."
        action={
          <div className="flex rounded-xl border border-[#eee7ef] bg-white p-1">
            {(["Month", "Week", "Day"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`rounded-lg px-3 py-2 text-[10px] font-bold ${view === v ? "bg-[#77518a] text-white" : "text-[#827588]"}`}
                data-testid={`button-calendar-${v.toLowerCase()}`}
              >
                {v}
              </button>
            ))}
          </div>
        }
      />
      <div className="mb-4 flex flex-wrap gap-3 text-[10px] font-semibold text-[#827987]">
        <Legend color="bg-[#83b598]" label="Available" />
        <Legend color="bg-[#e7c96f]" label="Reserved" />
        <Legend color="bg-[#d77d82]" label="Confirmed" />
        <Legend color="bg-[#7fa7cd]" label="Completed" />
      </div>
      <div className="grid gap-5 xl:grid-cols-[1.55fr_1fr]">
        <Panel className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-[#f0ebf1] px-4 py-4">
            <div>
              <h2 className="serif text-[20px]">{monthName}</h2>
              <p className="mt-1 text-[10px] text-[#9b919e]">
                {view} view · {events.length} reserved dates
              </p>
            </div>
            <div className="flex gap-1">
              <button
                onClick={() => move(-1)}
                aria-label="Previous month"
                className="rounded-lg p-2 hover:bg-[#f7f2f8]"
                data-testid="button-calendar-prev"
              >
                <ChevronLeft size={17} />
              </button>
              <button
                onClick={() => {
                  setMonth(new Date(today.getFullYear(), today.getMonth(), 1));
                  setSelected(dateAt(0));
                }}
                className="rounded-lg px-2 text-[10px] font-bold text-[#84618c] hover:bg-[#f7f2f8]"
                data-testid="button-calendar-today"
              >
                Today
              </button>
              <button
                onClick={() => move(1)}
                aria-label="Next month"
                className="rounded-lg p-2 hover:bg-[#f7f2f8]"
                data-testid="button-calendar-next"
              >
                <ChevronRight size={17} />
              </button>
            </div>
          </div>
          <div className="grid grid-cols-7 border-b border-[#f0ebf1] bg-[#fcfafc]">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <div
                key={d}
                className="py-3 text-center text-[9px] font-bold uppercase tracking-[.1em] text-[#a39aa7]"
              >
                {d}
              </div>
            ))}
          </div>
          {view === "Month" ? (
            <div className="grid grid-cols-7">
              {Array.from({ length: offset + days }, (_, i) => {
                const day = i - offset + 1;
                const iso =
                  day > 0 && day <= days
                    ? `${year}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`
                    : "";
                const evts = events.filter((e: EventItem) => e.date === iso);
                const isToday = iso === dateAt(0);
                return (
                  <button
                    key={i}
                    onClick={() => iso && setSelected(iso)}
                    disabled={!iso}
                    className={`min-h-[70px] border-b border-r border-[#f1edf1] p-1.5 text-left transition sm:min-h-[92px] sm:p-2 ${iso === selected ? "bg-[#f7eff8]" : "hover:bg-[#fcf8fc]"} ${!iso ? "bg-[#fcfbfc]" : ""}`}
                    data-testid={
                      iso ? `calendar-day-${iso}` : `calendar-blank-${i}`
                    }
                  >
                    <span
                      className={`grid h-6 w-6 place-items-center rounded-full text-[10px] ${isToday ? "bg-[#77518a] text-white" : "text-[#706779]"}`}
                    >
                      {day > 0 && day <= days ? day : ""}
                    </span>
                    <div className="mt-1 space-y-1">
                      {evts.slice(0, 2).map((e: EventItem) => (
                        <div
                          key={e.id}
                          className={`truncate rounded px-1 py-1 text-[8px] font-semibold sm:text-[9px] ${statusClass(e)}`}
                        >
                          {e.name}
                        </div>
                      ))}
                      {evts.length > 2 && (
                        <p className="text-[8px] text-[#827588]">
                          +{evts.length - 2} more
                        </p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="grid grid-cols-1 divide-y divide-[#f0ebf1] sm:grid-cols-7 sm:divide-x sm:divide-y-0">
              {Array.from({ length: view === "Week" ? 7 : 1 }, (_, i) => {
                const d = new Date(`${selected}T12:00:00`);
                if (view === "Week") d.setDate(d.getDate() - d.getDay() + i);
                const iso = d.toISOString().slice(0, 10);
                const dayEvents = events.filter(
                  (e: EventItem) => e.date === iso,
                );
                return (
                  <button
                    key={iso}
                    onClick={() => setSelected(iso)}
                    className={`min-h-24 p-3 text-left ${iso === selected ? "bg-[#f7eff8]" : "hover:bg-[#fcf8fc]"}`}
                    data-testid={`calendar-${view.toLowerCase()}-${iso}`}
                  >
                    <span className="text-[9px] font-bold uppercase text-[#9b8fa0]">
                      {d.toLocaleDateString("en-MY", { weekday: "short" })}
                    </span>
                    <span className="ml-2 text-[12px] font-bold">
                      {d.getDate()}
                    </span>
                    {dayEvents.map((e: EventItem) => (
                      <div
                        key={e.id}
                        className={`mt-2 rounded-md px-2 py-1 text-[9px] ${statusClass(e)}`}
                      >
                        {e.time} · {e.name}
                      </div>
                    ))}
                  </button>
                );
              })}
            </div>
          )}
        </Panel>
        <Panel className="p-5">
          <SectionTitle
            aside={
              <span className="text-[10px] text-[#9d93a0]">
                {dateLabel(selected, {
                  weekday: "short",
                  day: "numeric",
                  month: "long",
                })}
              </span>
            }
          >
            Date details
          </SectionTitle>
          {selectedEvents.length ? (
            selectedEvents.map((e: EventItem) => (
              <div
                key={e.id}
                className="mb-3 rounded-xl border border-[#f0eaf1] p-3"
                data-testid={`calendar-event-${e.id}`}
              >
                <div className="flex items-center justify-between">
                  <b className="text-[12px]">{e.name}</b>
                  <Status value={e.status} />
                </div>
                <p className="mt-2 text-[10px] text-[#8d8291]">
                  {e.customer} · {e.time} · {e.guests} guests
                </p>
                <p className="mt-2 text-[10px] font-semibold text-[#76657e]">
                  {money(e.value)}
                </p>
              </div>
            ))
          ) : (
            <div className="rounded-xl bg-[#f4f8f5] p-4">
              <div className="flex items-center gap-2 text-[#5c896b]">
                <CheckCircle2 size={16} />
                <span className="text-[12px] font-bold">Available to book</span>
              </div>
              <p className="mt-2 text-[10px] leading-relaxed text-[#7d8f80]">
                No events reserved for this date. Share it with a customer or
                hold it for a new request.
              </p>
            </div>
          )}
          <div className="mt-5 border-t border-[#f0ebf1] pt-4">
            <h3 className="mb-3 text-[11px] font-bold">Upcoming dates</h3>
            {events
              .filter((e: EventItem) => e.date >= dateAt(0))
              .sort((a: EventItem, b: EventItem) =>
                a.date.localeCompare(b.date),
              )
              .slice(0, 4)
              .map((e: EventItem) => (
                <button
                  key={e.id}
                  onClick={() => {
                    setSelected(e.date);
                    const d = new Date(`${e.date}T12:00:00`);
                    setMonth(new Date(d.getFullYear(), d.getMonth(), 1));
                  }}
                  className="flex w-full items-center justify-between border-b border-[#f5f0f5] py-2 text-left"
                  data-testid={`button-upcoming-date-${e.id}`}
                >
                  <span className="text-[10px] font-semibold">
                    {dateLabel(e.date, { day: "numeric", month: "short" })} ·{" "}
                    {e.name}
                  </span>
                  <ChevronRight size={13} className="text-[#a99eae]" />
                </button>
              ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
function Legend({ color, label }: any) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
      {label}
    </div>
  );
}
function Suppliers({ store, openModal, setStore }: any) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const categories = [
    "All",
    "Catering",
    "Decoration",
    "Photography",
    "Entertainment",
    "Equipment",
    "Transport",
  ];
  const list = store.suppliers.filter(
    (s: Supplier) =>
      (category === "All" || s.category === category) &&
      `${s.name} ${s.package} ${s.category}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <div className="fade-in">
      <PageHeading
        eyebrow="Your trusted circle"
        title="Supplier catalogue"
        subtitle="The people and packages that make every gathering feel like yours."
        action={
          <Button
            onClick={() => openModal({ kind: "supplier" })}
            testid="button-add-supplier"
          >
            <Plus size={15} /> Add supplier
          </Button>
        }
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-sm flex-1">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[#a69baa]"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search suppliers..."
            className="h-10 w-full rounded-xl border border-[#eee7ef] bg-white pl-9 text-[12px]"
            data-testid="input-search-suppliers"
          />
        </div>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="h-10 rounded-xl border border-[#eee7ef] bg-white px-3 text-[11px]"
          data-testid="select-supplier-category"
        >
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {list.map((s: Supplier, i: number) => (
          <SupplierCard key={s.id} supplier={s} i={i} openModal={openModal} />
        ))}
      </div>
      {!list.length && (
        <Panel>
          <Empty
            title="No suppliers match this search"
            action={() => setCategory("All")}
            cta="Clear category"
          />
        </Panel>
      )}
    </div>
  );
}
function SupplierCard({ supplier: s, i, openModal }: any) {
  const tones = [
    "bg-[#f3e8ee] text-[#95677f]",
    "bg-[#ece8f4] text-[#806d9b]",
    "bg-[#e8f1ec] text-[#678675]",
    "bg-[#f4eee1] text-[#9a8050]",
  ];
  const Icon = [Heart, Users, Activity, Package, MusicIcon, MapPin][i % 6];
  return (
    <Panel
      className="p-5 transition hover:-translate-y-0.5 hover:shadow-md"
      data-testid={`card-supplier-${s.id}`}
    >
      <div className="flex items-start justify-between">
        <div
          className={`grid h-11 w-11 place-items-center rounded-2xl ${tones[i % tones.length]}`}
        >
          <Icon size={19} />
        </div>
        <Status value={s.status} />
      </div>
      <div className="mt-4 text-[9px] font-bold uppercase tracking-[.14em] text-[#a187a6]">
        {s.category}
      </div>
      <h2 className="serif mt-1 text-[19px]">{s.name}</h2>
      <p className="mt-1 text-[11px] text-[#8d8291]">{s.package}</p>
      <div className="mt-4 flex items-end justify-between border-t border-[#f1edf1] pt-3">
        <div>
          <p className="text-[9px] font-bold uppercase tracking-[.1em] text-[#a49aa8]">
            From
          </p>
          <p className="mt-1 text-[15px] font-bold">{money(s.price)}</p>
        </div>
        <div className="flex gap-1">
          <a
            href={`mailto:${s.contact}`}
            className="grid h-8 w-8 place-items-center rounded-lg border border-[#eee7ef] text-[#816b88] hover:bg-[#f7f1f8]"
            aria-label={`Email ${s.name}`}
            data-testid={`link-email-supplier-${s.id}`}
          >
            <Mail size={14} />
          </a>
          <button
            onClick={() => openModal({ kind: "supplier", item: s })}
            className="grid h-8 w-8 place-items-center rounded-lg border border-[#eee7ef] text-[#816b88] hover:bg-[#f7f1f8]"
            aria-label={`Edit ${s.name}`}
            data-testid={`button-edit-supplier-${s.id}`}
          >
            <Edit3 size={14} />
          </button>
        </div>
      </div>
      <div className="mt-3 text-[10px] text-[#9b919e]">{s.contact}</div>
    </Panel>
  );
}
function MusicIcon(props: any) {
  return <Activity {...props} />;
}
function Reports({ store }: any) {
  const reqCount = store.requests.length;
  const approved = store.proposals.filter(
    (p: Proposal) => p.status === "Approved",
  ).length;
  const acceptance = store.proposals.length
    ? Math.round((approved / store.proposals.length) * 100)
    : 0;
  const revenue = store.events
    .filter((e: EventItem) => e.status !== "Cancelled")
    .reduce((s: number, e: EventItem) => s + e.value, 0);
  const types = [
    "Wedding",
    "Birthday party",
    "Corporate event",
    "Engagement",
    "Baby full moon",
  ];
  const typeCounts = types.map((t) => ({
    name: t,
    value: store.requests.filter((r: Req) => r.type === t).length,
  }));
  const max = Math.max(1, ...typeCounts.map((x) => x.value));
  const months = ["Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];
  const reqTrend = [4, 6, 5, 8, 7, reqCount];
  const revTrend = [
    14,
    19,
    17,
    24,
    28,
    Math.max(10, Math.round(revenue / 1000)),
  ];
  return (
    <div className="fade-in">
      <PageHeading
        eyebrow="The bigger picture"
        title="Studio reports"
        subtitle="A clear view of your momentum, your best-fit events and the business behind the beautiful details."
        action={
          <Button
            variant="outline"
            onClick={() => window.print()}
            testid="button-export-reports"
          >
            <Download size={14} /> Export report
          </Button>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Metric
          label="Total requests"
          value={reqCount}
          detail="Across all celebrations"
          icon={Mail}
          tone="lavender"
        />
        <Metric
          label="Event revenue"
          value={money(revenue)}
          detail="Approved and completed"
          icon={CircleDollarSign}
          tone="sage"
        />
        <Metric
          label="Approved events"
          value={approved}
          detail="Proposals accepted"
          icon={CalendarCheck}
          tone="rose"
        />
        <Metric
          label="Acceptance rate"
          value={`${acceptance}%`}
          detail="Of proposals shared"
          icon={ArrowDownRight}
          tone="gold"
        />
      </div>
      <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
        <Panel className="p-5 md:p-6">
          <SectionTitle
            aside={
              <span className="rounded-full bg-[#f7f1f8] px-2.5 py-1 text-[9px] font-bold text-[#866790]">
                Last 6 months
              </span>
            }
          >
            Monthly requests
          </SectionTitle>
          <div className="relative mt-3 h-[220px] border-b border-l border-[#eee8ef] px-3">
            <div className="absolute inset-0 flex flex-col justify-between pb-1">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="border-t border-dashed border-[#f0ebf1]"
                />
              ))}
            </div>
            <div className="relative flex h-full items-end justify-around gap-3 pb-0">
              {reqTrend.map((v, i) => (
                <div
                  key={i}
                  className="flex h-full flex-1 flex-col items-center justify-end gap-2"
                >
                  <span className="text-[9px] font-semibold text-[#8a7b91]">
                    {v}
                  </span>
                  <div
                    className={`w-full max-w-[38px] rounded-t-lg ${i === 5 ? "bg-[#77518a]" : "bg-[#d9c6e0]"}`}
                    style={{
                      height: `${Math.max(12, (v / Math.max(...reqTrend)) * 78)}%`,
                    }}
                  />
                  <span
                    className="absolute bottom-[-22px] text-[9px] text-[#a49aa7]"
                    style={{
                      left: `${((i + 0.5) * 100) / 6}%`,
                      transform: "translateX(-50%)",
                    }}
                  >
                    {months[i]}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-8 rounded-xl bg-[#f8f4f9] p-3 text-[10px] text-[#817386]">
            <ArrowDownRight size={13} className="mr-1 inline text-[#866294]" />{" "}
            Request volume is up across the latest studio period.
          </div>
        </Panel>
        <Panel className="p-5 md:p-6">
          <SectionTitle>Event type mix</SectionTitle>
          <div className="space-y-4 pt-2">
            {typeCounts.map((t, i) => (
              <div key={t.name} data-testid={`report-type-${i}`}>
                <div className="mb-1.5 flex justify-between text-[10px]">
                  <span className="font-semibold">{t.name}</span>
                  <span className="text-[#958b99]">{t.value} requests</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-[#f1edf2]">
                  <div
                    className={`h-full rounded-full ${["bg-[#8e6b9b]", "bg-[#d29ab3]", "bg-[#91abb8]", "bg-[#cfb57e]", "bg-[#92b29e]"][i]}`}
                    style={{ width: `${Math.max(4, (t.value / max) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-6 border-t border-[#f0ebf1] pt-4">
            <p className="text-[10px] font-bold uppercase tracking-[.12em] text-[#a096a3]">
              Most requested
            </p>
            <p className="serif mt-1 text-[19px]">
              {[...typeCounts].sort((a, b) => b.value - a.value)[0]?.name ||
                "Your first event"}
            </p>
          </div>
        </Panel>
      </div>
      <Panel className="mt-5 p-5 md:p-6">
        <SectionTitle
          aside={
            <span className="text-[10px] text-[#9b919e]">RM thousands</span>
          }
        >
          Revenue trend
        </SectionTitle>
        <div className="flex h-[130px] items-end gap-2 border-b border-[#eee8ef] pb-2 sm:gap-5">
          {revTrend.map((v, i) => (
            <div key={i} className="flex flex-1 flex-col items-center gap-2">
              <span className="text-[9px] text-[#897c91]">{v}k</span>
              <div
                className={`w-full max-w-[56px] rounded-t-lg ${i === 5 ? "bg-[#bd8eae]" : "bg-[#e7d7e8]"}`}
                style={{
                  height: `${Math.max(12, (v / Math.max(...revTrend)) * 75)}%`,
                }}
              />
              <span className="text-[9px] text-[#a49aa7]">{months[i]}</span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
function ModalFrame({ title, subtitle, close, children }: any) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[#302637]/35 p-0 backdrop-blur-[2px] sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="max-h-[92dvh] w-full max-w-[610px] overflow-y-auto rounded-t-[24px] bg-[#fffdfd] p-5 shadow-2xl sm:rounded-[24px] sm:p-7 fade-in"
      >
        <div className="mb-5 flex items-start justify-between">
          <div>
            <div className="text-[9px] font-bold uppercase tracking-[.17em] text-[#a37ea7]">
              EventFlow studio
            </div>
            <h2 className="serif mt-1 text-[24px]">{title}</h2>
            <p className="mt-1 text-[11px] text-[#8d8291]">{subtitle}</p>
          </div>
          <button
            onClick={close}
            className="rounded-full p-2 text-[#978b9e] hover:bg-[#f6f0f7]"
            aria-label="Close dialog"
            data-testid="button-close-modal"
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
function Field({
  label,
  value,
  onChange,
  type = "text",
  required = false,
  placeholder = "",
  testid,
  options,
  min,
}: any) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[10px] font-bold text-[#766c7d]">
        {label}
        {required && <span className="text-[#bd7294]"> *</span>}
      </span>
      {options ? (
        <select
          value={value}
          onChange={onChange}
          required={required}
          className="h-10 w-full rounded-xl border border-[#eee7ef] bg-white px-3 text-[11px]"
          data-testid={testid}
        >
          {options.map((x: string) => (
            <option key={x}>{x}</option>
          ))}
        </select>
      ) : (
        <input
          type={type}
          min={min}
          value={value}
          onChange={onChange}
          required={required}
          placeholder={placeholder}
          className="h-10 w-full rounded-xl border border-[#eee7ef] bg-white px-3 text-[11px] outline-none focus:border-[#c9a9d1]"
          data-testid={testid}
        />
      )}
    </label>
  );
}
function RequestModal({ onClose, onSave }: any) {
  const [f, setF] = useState<any>({
    customer: "",
    email: "",
    phone: "",
    type: "Wedding",
    name: "",
    date: dateAt(45),
    time: "18:00",
    guests: "100",
    budget: "15000",
    notes: "",
    services: [],
  });
  const [error, setError] = useState("");
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  const serviceList = [
    "Venue styling",
    "Catering",
    "Photography",
    "Decoration",
    "Entertainment",
    "AV production",
    "Dessert table",
    "Favors",
    "Transport",
  ];
  const toggle = (s: string) =>
    set(
      "services",
      f.services.includes(s)
        ? f.services.filter((x: string) => x !== s)
        : [...f.services, s],
    );
  const submit = (e: any) => {
    e.preventDefault();
    if (!f.services.length) {
      setError("Choose at least one requested service.");
      return;
    }
    const r: Req = {
      ...f,
      id: `REQ-${String(Date.now()).slice(-4)}`,
      guests: Number(f.guests),
      budget: Number(f.budget),
      status: "New",
    };
    onSave(r);
  };
  return (
    <ModalFrame
      title="A new celebration"
      subtitle="Capture the important details, then give it your full attention."
      close={onClose}
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Customer name"
            value={f.customer}
            onChange={(e: any) => set("customer", e.target.value)}
            required
            testid="input-request-customer"
          />
          <Field
            label="Event name or theme"
            value={f.name}
            onChange={(e: any) => set("name", e.target.value)}
            required
            placeholder="A Quiet Promise"
            testid="input-request-event-name"
          />
          <Field
            label="Email"
            type="email"
            value={f.email}
            onChange={(e: any) => set("email", e.target.value)}
            required
            testid="input-request-email"
          />
          <Field
            label="Phone"
            value={f.phone}
            onChange={(e: any) => set("phone", e.target.value)}
            required
            testid="input-request-phone"
          />
          <Field
            label="Event type"
            value={f.type}
            onChange={(e: any) => set("type", e.target.value)}
            options={[
              "Wedding",
              "Birthday party",
              "Corporate event",
              "Engagement",
              "Baby full moon",
            ]}
            testid="select-request-type"
          />
          <Field
            label="Date"
            type="date"
            value={f.date}
            onChange={(e: any) => set("date", e.target.value)}
            required
            testid="input-request-date"
          />
          <Field
            label="Start time"
            type="time"
            value={f.time}
            onChange={(e: any) => set("time", e.target.value)}
            testid="input-request-time"
          />
          <Field
            label="Guest count"
            type="number"
            value={f.guests}
            onChange={(e: any) => set("guests", e.target.value)}
            required
            testid="input-request-guests"
          />
          <Field
            label="Budget (RM)"
            type="number"
            value={f.budget}
            onChange={(e: any) => set("budget", e.target.value)}
            required
            testid="input-request-budget"
          />
        </div>
        <div>
          <p className="mb-2 text-[10px] font-bold text-[#766c7d]">
            Requested services *
          </p>
          <div className="flex flex-wrap gap-2">
            {serviceList.map((s) => (
              <button
                type="button"
                onClick={() => toggle(s)}
                key={s}
                className={`rounded-full border px-3 py-2 text-[10px] font-semibold ${f.services.includes(s) ? "border-[#b992c0] bg-[#f5edf6] text-[#77518a]" : "border-[#eee7ef] bg-white text-[#8b8090]"}`}
                data-testid={`button-service-${s.toLowerCase().replaceAll(" ", "-")}`}
              >
                {f.services.includes(s) && (
                  <Check size={11} className="mr-1 inline" />
                )}
                {s}
              </button>
            ))}
          </div>
        </div>
        <label className="block">
          <span className="mb-1.5 block text-[10px] font-bold text-[#766c7d]">
            Notes
          </span>
          <textarea
            value={f.notes}
            onChange={(e) => set("notes", e.target.value)}
            rows={3}
            placeholder="Tell us what makes the day special..."
            className="w-full rounded-xl border border-[#eee7ef] p-3 text-[11px] outline-none focus:border-[#c9a9d1]"
            data-testid="input-request-notes"
          />
        </label>
        {error && (
          <p role="alert" className="text-[11px] text-[#a3524b]">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 border-t border-[#f0ebf1] pt-4">
          <Button
            variant="outline"
            onClick={onClose}
            testid="button-cancel-request"
          >
            Cancel
          </Button>
          <Button type="submit" testid="button-save-request">
            <Plus size={14} /> Add request
          </Button>
        </div>
      </form>
    </ModalFrame>
  );
}
function EventModal({ initialDate, onClose, onSave, existingIds }: any) {
  const [f, setF] = useState<any>({
    customer: "",
    name: "",
    date: initialDate || dateAt(30),
    time: "18:00",
    type: "Wedding",
    guests: "100",
    value: "15000",
  });
  const set = (key: string, value: any) =>
    setF((current: any) => ({ ...current, [key]: value }));
  const submit = (event: any) => {
    event.preventDefault();
    onSave({
      id: makeId("EVT", existingIds),
      customer: f.customer.trim(),
      name: f.name.trim(),
      date: f.date,
      time: f.time,
      status: "Upcoming",
      value: Number(f.value),
      type: f.type,
      guests: Number(f.guests),
    } as EventItem);
  };
  return (
    <ModalFrame
      title="Create an event"
      subtitle="Add a confirmed celebration to your event list and reserve its time."
      close={onClose}
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Customer or host"
            value={f.customer}
            onChange={(e: any) => set("customer", e.target.value)}
            required
            testid="input-event-customer"
          />
          <Field
            label="Event name"
            value={f.name}
            onChange={(e: any) => set("name", e.target.value)}
            required
            testid="input-event-name"
          />
          <Field
            label="Event type"
            value={f.type}
            onChange={(e: any) => set("type", e.target.value)}
            options={[
              "Wedding",
              "Birthday party",
              "Corporate event",
              "Engagement",
              "Baby full moon",
              "Other",
            ]}
            testid="select-event-type"
          />
          <Field
            label="Date"
            type="date"
            min={dateAt(0)}
            value={f.date}
            onChange={(e: any) => set("date", e.target.value)}
            required
            testid="input-event-date"
          />
          <Field
            label="Start time"
            type="time"
            value={f.time}
            onChange={(e: any) => set("time", e.target.value)}
            required
            testid="input-event-time"
          />
          <Field
            label="Guest count"
            type="number"
            min="1"
            value={f.guests}
            onChange={(e: any) => set("guests", e.target.value)}
            required
            testid="input-event-guests"
          />
          <Field
            label="Event value (RM)"
            type="number"
            min="0"
            value={f.value}
            onChange={(e: any) => set("value", e.target.value)}
            required
            testid="input-event-value"
          />
        </div>
        <div className="flex justify-end gap-2 border-t border-[#f0ebf1] pt-4">
          <Button
            variant="outline"
            onClick={onClose}
            testid="button-cancel-event"
          >
            Cancel
          </Button>
          <Button type="submit" testid="button-save-event">
            <CalendarCheck size={14} /> Create event
          </Button>
        </div>
      </form>
    </ModalFrame>
  );
}
function BlockDateModal({ initialDate, onClose, onSave, existingIds }: any) {
  const [date, setDate] = useState(initialDate || dateAt(30));
  const [reason, setReason] = useState("");
  const submit = (event: any) => {
    event.preventDefault();
    onSave({
      id: makeId("BLOCK", existingIds),
      date,
      reason: reason.trim() || "Unavailable",
    } as BlockedSlot);
  };
  return (
    <ModalFrame
      title="Block a calendar date"
      subtitle="Keep new events from being reserved on this date."
      close={onClose}
    >
      <form onSubmit={submit} className="space-y-4">
        <Field
          label="Date"
          type="date"
          min={dateAt(0)}
          value={date}
          onChange={(e: any) => setDate(e.target.value)}
          required
          testid="input-block-date"
        />
        <label className="block">
          <span className="mb-1.5 block text-[10px] font-bold text-[#766c7d]">
            Reason
          </span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Studio closed, private booking, or time off"
            className="w-full rounded-xl border border-[#eee7ef] p-3 text-[11px] outline-none focus:border-[#c9a9d1]"
            data-testid="input-block-reason"
          />
        </label>
        <div className="flex justify-end gap-2 border-t border-[#f0ebf1] pt-4">
          <Button
            variant="outline"
            onClick={onClose}
            testid="button-cancel-block"
          >
            Cancel
          </Button>
          <Button type="submit" testid="button-save-block">
            <ShieldBan size={14} /> Block date
          </Button>
        </div>
      </form>
    </ModalFrame>
  );
}
function SupplierModal({ supplier, onClose, onSave }: any) {
  const [f, setF] = useState<any>(
    supplier || {
      id: "",
      name: "",
      package: "",
      category: "Catering",
      price: "",
      status: "Available",
      contact: "",
    },
  );
  const set = (k: string, v: any) => setF((s: any) => ({ ...s, [k]: v }));
  const submit = (e: any) => {
    e.preventDefault();
    onSave({
      ...f,
      id: f.id || `SUP-${String(Date.now()).slice(-4)}`,
      price: Number(f.price),
    });
  };
  return (
    <ModalFrame
      title={supplier ? "Edit supplier" : "Add a supplier"}
      subtitle="Keep your trusted creative partners close at hand."
      close={onClose}
    >
      <form onSubmit={submit} className="space-y-4">
        <Field
          label="Supplier name"
          value={f.name}
          onChange={(e: any) => set("name", e.target.value)}
          required
          testid="input-supplier-name"
        />
        <Field
          label="Package or service"
          value={f.package}
          onChange={(e: any) => set("package", e.target.value)}
          required
          testid="input-supplier-package"
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Category"
            value={f.category}
            onChange={(e: any) => set("category", e.target.value)}
            options={[
              "Catering",
              "Decoration",
              "Photography",
              "Entertainment",
              "Equipment",
              "Transport",
            ]}
            testid="select-supplier-category-modal"
          />
          <Field
            label="Price (RM)"
            type="number"
            value={f.price}
            onChange={(e: any) => set("price", e.target.value)}
            required
            testid="input-supplier-price"
          />
          <Field
            label="Availability"
            value={f.status}
            onChange={(e: any) => set("status", e.target.value)}
            options={["Available", "Limited", "Unavailable"]}
            testid="select-supplier-status"
          />
          <Field
            label="Contact email"
            type="email"
            value={f.contact}
            onChange={(e: any) => set("contact", e.target.value)}
            testid="input-supplier-contact"
          />
        </div>
        <div className="flex justify-end gap-2 border-t border-[#f0ebf1] pt-4">
          <Button
            variant="outline"
            onClick={onClose}
            testid="button-cancel-supplier"
          >
            Cancel
          </Button>
          <Button type="submit" testid="button-save-supplier">
            <Check size={14} /> Save supplier
          </Button>
        </div>
      </form>
    </ModalFrame>
  );
}
function NoticeModal({ store, close, setLocation }: any) {
  const items = [
    ...store.requests
      .filter((r: Req) => r.status === "New")
      .map((r: Req) => ({
        title: `New request from ${r.customer}`,
        detail: `${r.name} · ${dateLabel(r.date, { day: "numeric", month: "short" })}`,
        link: `/requests/${r.id}`,
        kind: "Request",
      })),
    ...store.proposals
      .filter((p: Proposal) => p.status === "Pending Approval")
      .map((p: Proposal) => ({
        title: `Proposal ready for your review`,
        detail: `${p.event} · ${p.customer}`,
        link: `/proposals/${p.id}`,
        kind: "Approval",
      })),
  ];
  return (
    <ModalFrame
      title="Studio updates"
      subtitle="A small nudge when something needs your attention."
      close={close}
    >
      {items.length ? (
        <div className="space-y-2">
          {items.map((n: any, i: number) => (
            <button
              key={i}
              onClick={() => {
                close();
                setLocation(n.link);
              }}
              className="flex w-full items-center gap-3 rounded-xl border border-[#f0eaf1] p-3 text-left hover:bg-[#fcf8fc]"
              data-testid={`button-notification-${i}`}
            >
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-[#f4e9f3] text-[#845d8b]">
                {n.kind === "Request" ? (
                  <Mail size={15} />
                ) : (
                  <ClipboardCheck size={15} />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-bold">{n.title}</p>
                <p className="mt-1 truncate text-[10px] text-[#918695]">
                  {n.detail}
                </p>
              </div>
              <ChevronRight size={14} className="text-[#a99eae]" />
            </button>
          ))}
        </div>
      ) : (
        <Empty title="All caught up. Take a breath." />
      )}
    </ModalFrame>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={App} />
      <Route component={NotFound} />
    </Switch>
  );
}
export default App;
function StaffLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) setError(error.message);
    setLoading(false);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f7f3f8] p-6">
      <form
        onSubmit={login}
        className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-8 shadow-lg"
      >
        <h1 className="serif text-3xl text-[#77518a]">EventFlow Staff Login</h1>

        <p className="text-sm text-gray-500">
          Sign in to access your business workspace.
        </p>

        <input
          type="email"
          placeholder="Staff email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="w-full rounded-xl border p-3"
        />

        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="w-full rounded-xl border p-3"
        />

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-xl bg-[#77518a] p-3 font-semibold text-white disabled:opacity-50"
        >
          {loading ? "Signing in..." : "Sign In"}
        </button>
      </form>
    </div>
  );
}

function EventFlowWelcome() {
  const [selectedRole, setSelectedRole] = useState<
    "customer" | "business" | null
  >(null);

  if (selectedRole === "business") {
    return (
      <EventFlowRegister
        accountType="business"
        onBack={() => setSelectedRole(null)}
      />
    );
  }

  if (selectedRole === "customer") {
    return (
      <EventFlowRegister
        accountType="customer"
        onBack={() => setSelectedRole(null)}
      />
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <h1 className="text-4xl font-bold">Welcome to EventFlow</h1>

      <p className="text-gray-500">
        Choose how you would like to use EventFlow.
      </p>

      <div className="flex flex-wrap justify-center gap-4">
        <button
          onClick={() => setSelectedRole("customer")}
          className="rounded-xl border p-8 hover:bg-gray-100 hover:text-gray-900"
        >
          Customer
        </button>

        <button
          onClick={() => setSelectedRole("business")}
          className="rounded-xl border p-8 hover:bg-gray-100 hover:text-gray-900"
        >
          Business
        </button>
      </div>
    </div>
  );
}
function AdminApprovalsPage() {
  const [pendingBusinesses, setPendingBusinesses] = useState<
    {
      id: string;
      full_name: string;
      created_at: string;
    }[]
  >([]);

  const [loadingBusinesses, setLoadingBusinesses] = useState(true);
  const [businessError, setBusinessError] = useState("");

  const [processingId, setProcessingId] = useState<string | null>(null);

  async function reviewBusiness(
    businessId: string,
    decision: "approved" | "rejected",
  ) {
    const action = decision === "approved" ? "approve" : "reject";

    if (!window.confirm(`Are you sure you want to ${action} this business?`)) {
      return;
    }

    setProcessingId(businessId);
    setBusinessError("");

    const { error } = await supabase.rpc("review_business_registration", {
      p_user_id: businessId,
      p_decision: decision,
    });

    if (error) {
      setBusinessError(error.message);
    } else {
      setPendingBusinesses((current) =>
        current.filter((business) => business.id !== businessId),
      );
    }

    setProcessingId(null);
  }
  useEffect(() => {
    async function loadPendingBusinesses() {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, created_at")
        .eq("account_type", "business")
        .eq("approval_status", "pending")
        .order("created_at", { ascending: false });

      if (error) {
        setBusinessError(error.message);
      } else {
        setPendingBusinesses(data ?? []);
      }

      setLoadingBusinesses(false);
    }

    void loadPendingBusinesses();
  }, []);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Business Registration Approvals</h1>
        <p className="mt-2 text-gray-600">
          Review and manage business account registrations.
        </p>
      </div>

      <div className="rounded-xl border bg-white p-6">
        <h2 className="text-xl font-semibold">
          Pending Business Registrations
        </h2>
        {loadingBusinesses ? (
          <p className="mt-3 text-gray-500">
            Loading business registrations...
          </p>
        ) : businessError ? (
          <p className="mt-3 text-red-600">Error: {businessError}</p>
        ) : pendingBusinesses.length === 0 ? (
          <p className="mt-3 text-gray-500">
            No pending business registrations.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {pendingBusinesses.map((business) => (
              <div key={business.id} className="rounded-lg border p-4">
                <p className="font-semibold">{business.full_name}</p>

                <p className="mt-1 text-sm text-gray-500">
                  Registered:{" "}
                  {new Date(business.created_at).toLocaleDateString("en-MY")}
                </p>

                <p className="mt-2 text-sm text-amber-600">Pending approval</p>
                <div className="mt-4 flex gap-3">
                  <button
                    type="button"
                    disabled={processingId !== null}
                    onClick={() => reviewBusiness(business.id, "approved")}
                    className="rounded-lg bg-green-600 px-4 py-2 text-white disabled:opacity-50"
                  >
                    {processingId === business.id ? "Processing..." : "Approve"}
                  </button>

                  <button
                    type="button"
                    disabled={processingId !== null}
                    onClick={() => reviewBusiness(business.id, "rejected")}
                    className="rounded-lg bg-red-600 px-4 py-2 text-white disabled:opacity-50"
                  >
                    {processingId === business.id ? "Processing..." : "Reject"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
