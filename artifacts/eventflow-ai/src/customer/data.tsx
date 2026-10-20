import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type EventStatus = 'Pending Review' | 'Approved' | 'Changes Requested' | 'Accepted';
export type Service = 'Catering' | 'Decoration' | 'Photography' | 'Venue Setup' | 'Equipment';
export type CustomerEvent = {
  id: string;
  name: string;
  type: string;
  date: string;
  location: string;
  guests: number;
  budget: number;
  theme: string;
  services: Service[];
  requirements: string;
  status: EventStatus;
  createdAt: string;
  proposalReady: boolean;
  quotation?: { items: { name: string; detail: string; price: number }[]; total: number };
};
export type ChangeRequest = { id: string; eventId: string; message: string; createdAt: string };
type CustomerState = {
  user: { name: string; email: string } | null;
  events: CustomerEvent[];
  changeRequests: ChangeRequest[];
  signIn: (email: string, password: string, registering?: boolean) => string | null;
  signOut: () => void;
  addEvent: (event: Omit<CustomerEvent, 'id' | 'createdAt' | 'status' | 'proposalReady'>) => string;
  acceptProposal: (id: string) => void;
  requestChanges: (id: string, message: string) => void;
};
type PersistedState = { user: { name: string; email: string } | null; events: CustomerEvent[]; changeRequests: ChangeRequest[] };
const STORAGE_KEY = 'eventflow-customer-v1';
const demoEvents: CustomerEvent[] = [
  {
    id: 'evt-garden-01', name: 'A Garden Dinner for Maya', type: 'Birthday', date: '2027-02-20',
    location: 'The Glasshouse, Kuala Lumpur', guests: 42, budget: 12500, theme: 'Soft garden party',
    services: ['Catering', 'Decoration', 'Photography', 'Venue Setup'],
    requirements: 'An intimate dinner with candlelight, seasonal flowers, and a small cake table. Please keep the setup warm and relaxed.',
    status: 'Approved', createdAt: '2026-04-18T10:30:00.000Z', proposalReady: true,
    quotation: { items: [
      { name: 'Garden table styling', detail: 'Florals, linen, candles and place settings', price: 2850 },
      { name: 'Dinner catering', detail: '42 guests · three-course menu and welcome drinks', price: 5460 },
      { name: 'Event photography', detail: 'Four hours of candid event coverage', price: 1900 },
      { name: 'Venue setup & coordination', detail: 'Setup team and on-the-day coordination', price: 1650 },
    ], total: 11860 },
  },
  {
    id: 'evt-launch-02', name: 'Lumen Studio Launch', type: 'Corporate Event', date: '2026-11-07',
    location: 'Lumen Studio, Petaling Jaya', guests: 80, budget: 18000, theme: 'Modern, warm, and welcoming',
    services: ['Catering', 'Venue Setup', 'Equipment'],
    requirements: 'A relaxed evening launch with light bites, a short welcome speech, and a simple presentation setup.',
    status: 'Pending Review', createdAt: '2026-05-02T09:15:00.000Z', proposalReady: false,
  },
];
function initialState(): PersistedState {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as Partial<PersistedState>;
      return { user: parsed.user ?? null, events: parsed.events?.length ? parsed.events : demoEvents, changeRequests: parsed.changeRequests ?? [] };
    }
  } catch { /* Start with the composed demo workspace when storage is unavailable. */ }
  return { user: null, events: demoEvents, changeRequests: [] };
}
const CustomerContext = createContext<CustomerState | null>(null);
export function CustomerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(initialState);
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* The portal remains usable without storage. */ }
  }, [state]);
  const value = useMemo<CustomerState>(() => ({
    ...state,
    signIn: (email, password, registering = false) => {
      if (!email.trim() || !/^\S+@\S+\.\S+$/.test(email)) return 'Enter a valid email address.';
      if (password.length < 6) return 'Password must be at least 6 characters.';
      const name = email.split('@')[0].split(/[._-]/).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
      setState((current) => ({ ...current, user: { name: registering ? name : name || 'Jamie', email } }));
      return null;
    },
    signOut: () => setState((current) => ({ ...current, user: null })),
    addEvent: (event) => {
      const id = `evt-${Date.now().toString(36)}`;
      setState((current) => ({ ...current, events: [{ ...event, id, createdAt: new Date().toISOString(), status: 'Pending Review', proposalReady: false }, ...current.events] }));
      return id;
    },
    acceptProposal: (id) => setState((current) => ({ ...current, events: current.events.map((event) => event.id === id ? { ...event, status: 'Accepted' } : event) })),
    requestChanges: (id, message) => setState((current) => ({
      ...current,
      changeRequests: [{ id: `chg-${Date.now().toString(36)}`, eventId: id, message, createdAt: new Date().toISOString() }, ...current.changeRequests],
      events: current.events.map((event) => event.id === id ? { ...event, status: 'Changes Requested' } : event),
    })),
  }), [state]);
  return <CustomerContext.Provider value={value}>{children}</CustomerContext.Provider>;
}
export function useCustomer() {
  const context = useContext(CustomerContext);
  if (!context) throw new Error('useCustomer must be used inside CustomerProvider');
  return context;
}
