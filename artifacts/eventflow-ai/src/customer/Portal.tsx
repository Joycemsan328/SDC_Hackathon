import { useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type FormEvent, type ReactNode } from 'react';
import { Link, Route, Switch, useLocation } from 'wouter';
import {
  ArrowLeft, ArrowRight, CalendarDays, Check, CheckCircle2, CircleHelp, ClipboardList,
  Clock3, Flower2, Heart, LayoutDashboard, LogOut, MapPin, Menu, MessageSquareText,
  Plus, Sparkles, X,
} from 'lucide-react';
import { useCustomer, type CustomerEvent, type EventStatus, type Service } from './data';

const navItems = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/events', label: 'My events', icon: CalendarDays },
  { href: '/events/new', label: 'New request', icon: Plus },
];
const services: Service[] = ['Catering', 'Decoration', 'Photography', 'Venue Setup', 'Equipment'];
const money = (value: number) => `RM ${value.toLocaleString('en-MY')}`;
const friendlyDate = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString('en-MY', { day: 'numeric', month: 'long', year: 'numeric' });

function Brand({ compact = false }: { compact?: boolean }) {
  return <div className="flex items-center gap-3" data-testid="brand-eventflow">
    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#efd6e1] text-[#9f5e7d]"><Flower2 size={20} strokeWidth={1.7} /></div>
    {!compact && <span className="font-[var(--app-font-serif)] text-[18px] font-extrabold tracking-[-.05em] text-[#453b4a]">eventflow<span className="text-[#bd829d]">.</span></span>}
  </div>;
}
function Button({ children, className = '', variant = 'primary', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'quiet' | 'outline' }) {
  const styles = variant === 'primary' ? 'bg-[#bb7d99] text-white shadow-[0_5px_14px_rgba(166,101,134,.18)] hover:bg-[#a96887]' : variant === 'outline' ? 'border border-[#e6dce6] bg-white text-[#605568] hover:border-[#c9a7bc] hover:bg-[#fcf8fb]' : 'text-[#766d7d] hover:bg-[#f7f1f5]';
  return <button {...props} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-all duration-200 hover:-translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}>{children}</button>;
}
function StatusBadge({ status }: { status: EventStatus }) {
  const style = status === 'Approved for Customer' ? 'bg-[#e9f3ed] text-[#52745f]' : status === 'Customer Accepted' ? 'bg-[#e8f3ed] text-[#52745f]' : status === 'Changes Requested' ? 'bg-[#f5edf8] text-[#80648d]' : status === 'AI Draft' ? 'bg-[#f1edf7] text-[#80648d]' : 'bg-[#fbf1df] text-[#947745]';
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold tracking-[.01em] ${style}`} data-testid={`status-event-${status.toLowerCase().replaceAll(' ', '-')}`}><span className="h-1.5 w-1.5 rounded-full bg-current opacity-75" />{status}</span>;
}
function AppShell({ children }: { children: ReactNode }) {
  const [path, setPath] = useLocation();
  const { user, signOut } = useCustomer();
  const [menuOpen, setMenuOpen] = useState(false);
  const [helpMessage, setHelpMessage] = useState(false);
  const active = path.startsWith('/events/new') ? '/events/new' : path.startsWith('/events') ? '/events' : '/dashboard';
  const logout = () => { signOut(); setPath('/login'); };
  return <div className="min-h-[100dvh] bg-[#fcfaf9] text-[#514858]">
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[252px] flex-col border-r border-[#eee4e9] bg-[#fffafa] px-6 py-7 lg:flex">
      <Link href="/dashboard" className="mb-11 flex items-center gap-3 no-underline"><Brand /></Link>
      <div className="mb-3 px-3 text-[10px] font-bold uppercase tracking-[.17em] text-[#a39aa6]">Workspace</div>
      <nav className="space-y-1.5" aria-label="Main navigation">
        {navItems.map(({ href, label, icon: Icon }) => <Link key={href} href={href} data-testid={`link-nav-${label.toLowerCase().replaceAll(' ', '-')}`} className={`group flex items-center gap-3 rounded-xl px-3.5 py-3 text-[13px] font-semibold no-underline transition-colors ${active === href ? 'bg-[#f5e8ef] text-[#9c5f7d]' : 'text-[#797180] hover:bg-[#f8f2f5]'}`}><Icon size={17} strokeWidth={1.8} />{label}{href === '/events/new' && <span className="ml-auto text-[11px]">＋</span>}</Link>)}
      </nav>
      <div className="mt-auto rounded-2xl bg-[#f6eef5] p-4">
        <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-xl bg-white text-[#aa7395]"><CircleHelp size={16} /></div>
        <p className="mb-1 text-sm font-bold text-[#584e5e]">A hand when you need it</p>
        <p className="mb-3 text-xs leading-relaxed text-[#857b8b]">Your event planner is just a note away.</p>
        <button onClick={() => setHelpMessage(true)} className="text-xs font-bold text-[#9c5f7d] underline decoration-[#d7b6c7] underline-offset-4" data-testid="button-contact-planner">Contact your planner</button>
      </div>
      <button onClick={logout} className="mt-5 flex items-center gap-3 rounded-xl px-3.5 py-3 text-left text-sm font-semibold text-[#817886] hover:bg-[#f8f2f5]" data-testid="button-sign-out"><LogOut size={16} />Sign out</button>
    </aside>
    <div className="lg:pl-[252px]">
      <header className="sticky top-0 z-20 flex h-[72px] items-center justify-between border-b border-[#efe8eb] bg-[#fcfaf9]/95 px-5 backdrop-blur-md sm:px-8 lg:px-10">
        <Link href="/dashboard" className="flex items-center gap-2 no-underline lg:hidden"><Brand compact /><span className="font-[var(--app-font-serif)] text-base font-extrabold tracking-[-.04em]">eventflow<span className="text-[#bd829d]">.</span></span></Link>
        <div className="hidden text-xs text-[#938a96] lg:block">Your planning space <span className="mx-2 text-[#d9cfd7]">/</span> <span className="font-semibold text-[#655b6a]">{active === '/dashboard' ? 'Overview' : active === '/events' ? 'My events' : 'New request'}</span></div>
        <div className="flex items-center gap-3">
          <span className="hidden text-sm font-medium text-[#746b79] sm:block" data-testid="text-customer-name">Hello, {user?.name || 'Jamie'}</span>
          <div className="flex h-9 w-9 items-center justify-center rounded-full border border-[#eedbe5] bg-[#f3e4eb] text-xs font-bold text-[#9d6682]" data-testid="avatar-customer">{(user?.name || 'J').slice(0, 1).toUpperCase()}</div>
          <button className="ml-1 flex h-9 w-9 items-center justify-center rounded-lg text-[#817886] hover:bg-[#f5edf2] lg:hidden" aria-label="Open menu" onClick={() => setMenuOpen(!menuOpen)} data-testid="button-mobile-menu">{menuOpen ? <X size={19} /> : <Menu size={19} />}</button>
        </div>
      </header>
      {menuOpen && <div className="absolute left-0 right-0 z-20 border-b border-[#eee4e9] bg-[#fffafa] p-3 shadow-lg lg:hidden">{navItems.map(({ href, label, icon: Icon }) => <Link key={href} href={href} onClick={() => setMenuOpen(false)} className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold text-[#6c6270] no-underline hover:bg-[#f5e8ef]"><Icon size={17} />{label}</Link>)}<button onClick={logout} className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold text-[#6c6270]"><LogOut size={17} />Sign out</button></div>}
      <main className="mx-auto max-w-[1280px] px-5 pb-16 pt-8 sm:px-8 sm:pt-10 lg:px-10">
        {helpMessage && <div role="status" className="mb-5 flex items-center gap-2 rounded-xl border border-[#d6e8dc] bg-[#f2f8f4] px-4 py-3 text-xs text-[#56765f]" data-testid="status-planner-contact"><CheckCircle2 size={16} />Your planner will be in touch soon.<button className="ml-auto" onClick={() => setHelpMessage(false)} aria-label="Dismiss" data-testid="button-dismiss-planner-contact"><X size={15} /></button></div>}
        {children}
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-3 border-t border-[#eee4e9] bg-white/95 px-2 pb-[max(8px,env(safe-area-inset-bottom))] pt-2 backdrop-blur lg:hidden">
        {navItems.map(({ href, label, icon: Icon }) => <Link key={href} href={href} className={`flex flex-col items-center gap-1 rounded-xl py-1.5 text-[10px] font-semibold no-underline ${active === href ? 'text-[#a35f80]' : 'text-[#988e9b]'}`} data-testid={`link-mobile-${label.toLowerCase().replaceAll(' ', '-')}`}><Icon size={18} />{label === 'New request' ? 'Create' : label}</Link>)}
      </nav>
    </div>
  </div>;
}
function PageTitle({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div>{eyebrow && <p className="mb-2 text-[10px] font-bold uppercase tracking-[.18em] text-[#ad7794]">{eyebrow}</p>}<h1 className="text-[30px] font-extrabold leading-tight text-[#453b4b] sm:text-[36px]" data-testid="text-page-title">{title}</h1>{description && <p className="mt-2 max-w-xl text-sm leading-relaxed text-[#8b818e]">{description}</p>}</div>{action}</div>;
}
function EventCard({ event, compact = false }: { event: CustomerEvent; compact?: boolean }) {
  return <article className={`ef-card rounded-2xl p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_32px_rgba(85,60,87,.08)] sm:p-6 ${compact ? '' : ''}`} data-testid={`card-event-${event.id}`}>
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
      <div className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center gap-2"><StatusBadge status={event.status} /><span className="text-[11px] font-semibold uppercase tracking-[.1em] text-[#a69ba7]">{event.type}</span><span className="rounded-full bg-[#f6f1f5] px-2.5 py-1 text-[10px] font-semibold text-[#817486]">{event.requestSource === 'supabase' ? 'Saved request' : 'Demo sample'}</span></div>
        <h3 className="mb-2 truncate text-[18px] font-bold text-[#514657]">{event.name}</h3>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-[#8d8490]"><span className="inline-flex items-center gap-1.5"><CalendarDays size={14} />{friendlyDate(event.date)}</span><span className="inline-flex items-center gap-1.5"><MapPin size={14} />{event.location}</span></div>
      </div>
      <Link href={`/events/${event.id}`} className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-[#e8dfe7] bg-white px-4 text-xs font-bold text-[#78677a] no-underline transition-colors hover:border-[#c9a7bc] hover:bg-[#fcf8fb]" data-testid={`button-view-event-${event.id}`}>View details <ArrowRight size={14} /></Link>
    </div>
    {!compact && <div className="mt-5 grid grid-cols-2 gap-3 border-t border-[#f0eaf0] pt-4 sm:max-w-[430px]"><div><div className="text-[10px] uppercase tracking-[.12em] text-[#a198a4]">Event date</div><div className="mt-1 text-sm font-semibold text-[#615765]">{friendlyDate(event.date)}</div></div><div><div className="text-[10px] uppercase tracking-[.12em] text-[#a198a4]">Your budget</div><div className="mt-1 text-sm font-semibold text-[#615765]">{money(event.budget)}</div></div></div>}
  </article>;
}
function EmptyEvents() {
  return <div className="rounded-2xl border border-dashed border-[#e6dce5] bg-white/65 px-6 py-12 text-center"><div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#f5e8ef] text-[#a76686]"><CalendarDays size={22} /></div><h3 className="text-lg font-bold text-[#534a59]">Your next occasion starts here</h3><p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-[#8c8290]">Tell us what you have in mind. A real event planner will help shape the details with you.</p><Link href="/events/new" className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#bb7d99] px-4 text-sm font-bold text-white no-underline"><Plus size={16} />Create an event request</Link></div>;
}
function Dashboard() {
  const { user, events } = useCustomer();
  const sorted = useMemo(() => [...events].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [events]);
  const awaiting = events.filter((event) => event.status !== 'Approved for Customer' && event.status !== 'Customer Accepted').length;
  return <div className="ef-enter">
    <section className="relative mb-8 overflow-hidden rounded-[26px] bg-[#f4e7ed] px-6 py-8 sm:px-9 sm:py-9">
      <div className="pointer-events-none absolute -right-8 -top-20 h-64 w-64 rounded-full border border-[#e8d3df] opacity-70" /><div className="pointer-events-none absolute right-16 top-12 h-36 w-36 rounded-full border border-[#e6d1dd] opacity-60" />
      <div className="relative max-w-[680px]">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-white/65 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[.15em] text-[#a46b88]"><Sparkles size={13} />Your event, thoughtfully planned</div>
        <h1 className="text-[31px] font-extrabold leading-[1.12] text-[#493c4d] sm:text-[39px]" data-testid="text-dashboard-welcome">Good things are<br className="hidden sm:block" /> coming together, {user?.name?.split(' ')[0] || 'Jamie'}.</h1>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-[#7d6e7d]">Keep your ideas, requests, and event plans in one calm little place.</p>
        <Link href="/events/new" className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#ae718f] px-4 text-sm font-bold text-white no-underline shadow-[0_6px_18px_rgba(150,94,124,.19)] transition-all hover:-translate-y-0.5 hover:bg-[#9f6280]" data-testid="button-create-event"><Plus size={17} />Create an event</Link>
      </div>
      <div className="absolute bottom-8 right-[9%] hidden h-[116px] w-[116px] items-center justify-center rounded-[34px] border border-white/80 bg-white/55 text-[#b9829d] shadow-[0_15px_35px_rgba(132,84,113,.08)] sm:flex"><Flower2 size={55} strokeWidth={1.1} /></div>
    </section>
    <div className="mb-8 grid grid-cols-2 gap-3 sm:gap-4">
      <div className="ef-card rounded-2xl p-4 sm:p-5"><div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-[#f6eaf0] text-[#a46c88]"><ClipboardList size={17} /></div><div className="text-2xl font-extrabold text-[#504656]" data-testid="text-event-count">{events.length.toString().padStart(2, '0')}</div><div className="mt-1 text-xs text-[#918795]">Events in your workspace</div></div>
      <div className="ef-card rounded-2xl p-4 sm:p-5"><div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-[#f1edf7] text-[#8d79a1]"><Clock3 size={17} /></div><div className="text-2xl font-extrabold text-[#504656]" data-testid="text-awaiting-count">{awaiting.toString().padStart(2, '0')}</div><div className="mt-1 text-xs text-[#918795]">Waiting on the next step</div></div>
    </div>
    <section>
      <div className="mb-4 flex items-end justify-between"><div><p className="mb-1 text-[10px] font-bold uppercase tracking-[.16em] text-[#a77a94]">Your plans</p><h2 className="text-[22px] font-extrabold text-[#4f4654]">My events</h2></div><Link href="/events" className="flex items-center gap-1 text-xs font-bold text-[#a66b89] no-underline hover:text-[#89536d]" data-testid="link-all-events">See all <ArrowRight size={14} /></Link></div>
      {sorted.length ? <div className="space-y-3">{sorted.slice(0, 2).map((event) => <EventCard event={event} compact key={event.id} />)}</div> : <EmptyEvents />}
    </section>
    <section className="mt-8 rounded-2xl border border-[#eee6ee] bg-white/65 p-5 sm:p-6"><div className="flex items-start gap-4"><div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#f4edf6] text-[#8e789d]"><Heart size={18} /></div><div><h3 className="text-sm font-bold text-[#5a5060]">A personal touch, all the way through</h3><p className="mt-1 max-w-2xl text-xs leading-relaxed text-[#8d8291]">Each request is reviewed by your planning team. Once your proposal is ready, you can review the details here and decide what feels right.</p></div></div></section>
  </div>;
}
function EventsList() {
  const { events } = useCustomer();
  const [filter, setFilter] = useState('All events');
  const visible = [...events].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).filter((event) => filter === 'All events' || (filter === 'In review' ? event.status !== 'Approved for Customer' && event.status !== 'Customer Accepted' : event.status === 'Approved for Customer' || event.status === 'Customer Accepted'));
  return <div className="ef-enter"><PageTitle eyebrow="Your plans" title="My events" description="Every occasion you’re planning with us, gathered in one place." action={<Link href="/events/new" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#bb7d99] px-4 text-sm font-bold text-white no-underline shadow-sm transition-all hover:-translate-y-0.5 hover:bg-[#a96887]" data-testid="button-new-event"><Plus size={16} />New event</Link>} />
    <div className="mb-5 flex flex-wrap gap-2">{['All events', 'In review', 'Proposal ready'].map((item) => <button key={item} onClick={() => setFilter(item)} className={`rounded-full px-4 py-2 text-xs font-bold transition-colors ${filter === item ? 'bg-[#ebd8e2] text-[#955d79]' : 'border border-[#ebe3e9] bg-white text-[#887e8c] hover:bg-[#fbf6f9]'}`} data-testid={`button-filter-${item.toLowerCase().replaceAll(' ', '-')}`}>{item}</button>)}</div>
    {visible.length ? <div className="space-y-3">{visible.map((event) => <EventCard event={event} key={event.id} />)}</div> : <div className="ef-card rounded-2xl p-10 text-center"><p className="font-semibold text-[#655a69]">Nothing in this view just yet.</p><p className="mt-1 text-sm text-[#958b98]">Your events will appear here as they take shape.</p></div>}
  </div>;
}

const inputClass = 'mt-1.5 min-h-11 w-full rounded-xl border border-[#e8e0e8] bg-white px-3.5 text-sm text-[#514858] outline-none transition-colors placeholder:text-[#b1a8b4] focus:border-[#c795ae] focus:ring-2 focus:ring-[#f2e5ec]';
const labelClass = 'text-xs font-bold text-[#655b69]';
function CreateEvent() {
  const { createRequest, addEvent, generateProposal, events } = useCustomer();
  const [, setLocation] = useLocation();
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [createdEventId, setCreatedEventId] = useState<string | null>(null);
  const [retryInput, setRetryInput] = useState<Omit<CustomerEvent, "id" | "createdAt" | "status" | "proposal" | "acceptedPlanId"> | null>(null);
  const submissionLock = useRef(false);
  const generationLock = useRef(false);
  const [selected, setSelected] = useState<Service[]>([]);
  const createdEvent = events.find((item) => item.id === createdEventId);
  const toggle = (service: Service) => setSelected((current) => current.includes(service) ? current.filter((item) => item !== service) : [...current, service]);
  const generate = async (id: string, input: Omit<CustomerEvent, "id" | "createdAt" | "status" | "proposal" | "acceptedPlanId">) => {
    if (generationLock.current) return;
    generationLock.current = true;
    setIsGenerating(true);
    setError('');
    try {
      await generateProposal(id, input, 'supabase');
      setSubmitted(true);
      window.setTimeout(() => setLocation(`/events/${id}`), 900);
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : 'We couldn’t generate your plans. Please try again.');
    } finally {
      generationLock.current = false;
      setIsGenerating(false);
    }
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isGenerating || isSaving || submissionLock.current) return;
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name') || '').trim();
    const type = String(form.get('type') || '');
    const date = String(form.get('date') || '');
    const location = String(form.get('location') || '').trim();
    const guests = Number(form.get('guests'));
    const budget = Number(form.get('budget'));
    if (!name || !type || !date || !location || guests < 1 || budget < 1) { setError('Please complete the event name, type, date, location, guest count, and budget.'); return; }
    if (date < new Date().toISOString().slice(0, 10)) { setError('Please choose a date in the future.'); return; }
    const eventInput = { name, type, date, location, guests, budget, theme: String(form.get('theme') || '').trim(), services: selected, requirements: String(form.get('requirements') || '').trim() };
    if (createdEventId) {
      if (retryInput) void generate(createdEventId, retryInput);
      return;
    }

    submissionLock.current = true;
    setIsSaving(true);
    setError('');
    try {
      const id = await createRequest(eventInput);
      addEvent(eventInput, id, 'supabase');
      setCreatedEventId(id);
      setRetryInput(eventInput);
      void generate(id, eventInput);
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'We couldn’t save your request. Please try again.');
    } finally {
      submissionLock.current = false;
      setIsSaving(false);
    }
  };
  if (submitted) return <div className="ef-enter mx-auto max-w-xl py-12 text-center"><div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-[22px] bg-[#e9f3ed] text-[#62836b]"><CheckCircle2 size={32} /></div><h1 className="text-3xl font-extrabold text-[#4d4352]">Your idea is with us.</h1><p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-[#8a808e]">{createdEvent?.status === 'Pending Business Approval' ? <>Your AI-generated Plan A and Plan B are saved. You can compare the drafts before the planning team approves a final quotation.</> : <>Your request is saved with an <strong className="text-[#6c5d70]">Unapproved AI Draft — Demo Only</strong>. It is not approved for acceptance.</>}</p><p className="mt-5 text-xs font-semibold text-[#aa7893]">Opening your request details…</p></div>;
  return <div className="ef-enter">
    <button onClick={() => setLocation('/events')} className="mb-5 inline-flex items-center gap-2 text-xs font-bold text-[#8c7d8e] hover:text-[#9c5f7d]" data-testid="button-back-events"><ArrowLeft size={15} />Back to my events</button>
    <PageTitle eyebrow="A new occasion" title="Let’s plan something lovely." description="Share a few details to help your planner understand what you have in mind." />
    <form onSubmit={submit} className="max-w-[850px]" data-testid="form-create-event">
      {error && <div role="alert" className="mb-5 rounded-xl border border-[#efcfd1] bg-[#fff4f4] px-4 py-3 text-sm text-[#a34e58]" data-testid="status-form-error">{error}</div>}
      <div className="ef-card mb-4 rounded-2xl p-5 sm:p-7">
        <div className="mb-5 flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#f6eaf0] text-[#a46c88]"><CalendarDays size={17} /></div><div><h2 className="text-base font-bold text-[#574d5d]">The occasion</h2><p className="text-xs text-[#968c99]">Start with the essentials.</p></div></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="sm:col-span-2"><span className={labelClass}>Event name <span className="text-[#bd7c9b]">*</span></span><input name="name" required placeholder="e.g. A Garden Dinner for Maya" className={inputClass} data-testid="input-event-name" /></label>
          <label><span className={labelClass}>Event type <span className="text-[#bd7c9b]">*</span></span><select name="type" required defaultValue="" className={inputClass} data-testid="select-event-type"><option value="" disabled>Select event type</option>{['Birthday', 'Wedding', 'Corporate Event', 'Other'].map((type) => <option key={type}>{type}</option>)}</select></label>
          <label><span className={labelClass}>Date <span className="text-[#bd7c9b]">*</span></span><input type="date" name="date" required min={new Date().toISOString().slice(0, 10)} className={inputClass} data-testid="input-event-date" /></label>
          <label className="sm:col-span-2"><span className={labelClass}>Location <span className="text-[#bd7c9b]">*</span></span><input name="location" required placeholder="Venue or area, city" className={inputClass} data-testid="input-event-location" /></label>
          <label><span className={labelClass}>Number of guests <span className="text-[#bd7c9b]">*</span></span><input type="number" name="guests" min="1" required placeholder="e.g. 60" className={inputClass} data-testid="input-event-guests" /></label>
          <label><span className={labelClass}>Your budget (RM) <span className="text-[#bd7c9b]">*</span></span><div className="relative"><span className="absolute left-3.5 top-[22px] text-sm text-[#938897]">RM</span><input type="number" name="budget" min="1" required placeholder="e.g. 12000" className={`${inputClass} pl-12`} data-testid="input-event-budget" /></div></label>
          <label className="sm:col-span-2"><span className={labelClass}>Theme or feeling</span><input name="theme" placeholder="e.g. relaxed garden party, modern and minimal" className={inputClass} data-testid="input-event-theme" /></label>
        </div>
      </div>
      <div className="ef-card mb-4 rounded-2xl p-5 sm:p-7">
        <div className="mb-5 flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#f1edf7] text-[#89769c]"><Sparkles size={17} /></div><div><h2 className="text-base font-bold text-[#574d5d]">What would you like help with?</h2><p className="text-xs text-[#968c99]">Choose any services that feel useful.</p></div></div>
        <div className="grid gap-2 sm:grid-cols-2">{services.map((service) => <label key={service} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3.5 text-sm transition-colors ${selected.includes(service) ? 'border-[#d5b5c7] bg-[#fcf7fa] text-[#76596f]' : 'border-[#eee8ee] bg-white text-[#776e7b] hover:bg-[#fcfafb]'}`}><input type="checkbox" checked={selected.includes(service)} onChange={() => toggle(service)} className="h-4 w-4 accent-[#b67694]" data-testid={`checkbox-service-${service.toLowerCase().replaceAll(' ', '-')}`} /><span className="font-medium">{service}</span>{selected.includes(service) && <Check size={15} className="ml-auto text-[#a26a88]" />}</label>)}</div>
        <label className="mt-5 block"><span className={labelClass}>Anything else we should know?</span><textarea name="requirements" rows={4} placeholder="Share your ideas, must-haves, or anything that would make the day feel like yours." className={`${inputClass} resize-y py-3`} data-testid="textarea-event-requirements" /></label>
      </div>
      <div className="flex flex-col-reverse items-stretch justify-between gap-3 sm:flex-row sm:items-center"><p className="text-xs text-[#968c99]">Your request is private to you and your planning team.</p><div className="flex flex-col gap-2 sm:flex-row">{createdEventId && error && retryInput && <Button type="button" variant="outline" disabled={isGenerating || isSaving} onClick={() => void generate(createdEventId, retryInput)} data-testid="button-retry-proposal">Retry proposal generation</Button>}<Button type="submit" disabled={isGenerating || isSaving} className="px-6" data-testid="button-submit-event">{isSaving ? <><span className="animate-spin">◌</span> Saving your request…</> : isGenerating ? <><span className="animate-spin">◌</span> Generating Plan A and Plan B…</> : <>Send event request <ArrowRight size={15} /></>}</Button></div></div>
    </form>
  </div>;
}
function DetailSection({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return <section className="ef-card rounded-2xl p-5 sm:p-6"><div className="mb-4 flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#f6edf3] text-[#a16e8a]">{icon}</div><h2 className="text-base font-bold text-[#574d5d]">{title}</h2></div>{children}</section>;
}
function EventDetail({ id }: { id?: string }) {
  const { events, changeRequests, acceptProposal, preferProposal, requestChanges, generateProposal } = useCustomer();
  const [, setLocation] = useLocation();
  const [showChangeForm, setShowChangeForm] = useState(false);
  const [changeText, setChangeText] = useState('');
  const [feedback, setFeedback] = useState('');
  const [generationError, setGenerationError] = useState('');
  const [isGeneratingProposal, setIsGeneratingProposal] = useState(false);
  const generationInFlight = useRef(false);
  const event = events.find((item) => item.id === id);
  const requests = changeRequests.filter((request) => request.eventId === id);
  if (!event) return <div className="ef-card rounded-2xl p-10 text-center"><h1 className="text-xl font-bold">We couldn’t find that event.</h1><Link href="/events" className="mt-4 inline-flex text-sm font-bold text-[#a66b89]">Back to my events</Link></div>;
  const isAiDraft = event.status === 'AI Draft' && event.proposal?.source === 'ai-service';
  const isPendingBusinessApproval = event.status === 'Pending Business Approval' && event.proposal?.source === 'persisted-ai';
  const canViewProposal = Boolean(event.proposal);
  const handleGenerateProposal = async () => {
    if (generationInFlight.current || event.requestSource !== 'supabase' || event.proposal) return;
    generationInFlight.current = true;
    setIsGeneratingProposal(true);
    setGenerationError('');
    try {
      await generateProposal(event.id, {
        name: event.name,
        type: event.type,
        date: event.date,
        location: event.location,
        guests: event.guests,
        budget: event.budget,
        theme: event.theme,
        services: event.services,
        requirements: event.requirements,
      }, 'supabase');
      setFeedback('Plan A and Plan B have been generated. Review the saved drafts below.');
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : 'Could not generate the proposal. Please try again later.');
    } finally {
      generationInFlight.current = false;
      setIsGeneratingProposal(false);
    }
  };
  const handleAccept = (planId: 'A' | 'B') => { acceptProposal(event.id, planId); setFeedback(`Plan ${planId} accepted. Your planner will be in touch with the next steps.`); };
  const submitChanges = (formEvent: FormEvent) => { formEvent.preventDefault(); if (!changeText.trim() || event.status === 'Customer Accepted') return; requestChanges(event.id, changeText.trim()); setShowChangeForm(false); setChangeText(''); setFeedback('Update saved in this demo. Your original request and proposal history have not been overwritten.'); };
  return <div className="ef-enter">
    <button onClick={() => setLocation('/events')} className="mb-5 inline-flex items-center gap-2 text-xs font-bold text-[#8c7d8e] hover:text-[#9c5f7d]" data-testid="button-back-to-events"><ArrowLeft size={15} />Back to my events</button>
    <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
      <div><div className="mb-3 flex flex-wrap items-center gap-2"><StatusBadge status={event.status} /><span className="text-[11px] font-semibold uppercase tracking-[.1em] text-[#a69ba7]">{event.type}</span></div><h1 className="text-[29px] font-extrabold leading-tight text-[#493f4e] sm:text-[36px]" data-testid="text-event-detail-name">{event.name}</h1><p className="mt-2 flex items-center gap-2 text-sm text-[#897f8d]"><CalendarDays size={15} />{friendlyDate(event.date)} <span className="text-[#d5cbd4]">·</span><MapPin size={15} />{event.location}</p></div>
      <div className="rounded-xl border border-[#eee6ed] bg-white px-4 py-3"><div className="text-[10px] font-bold uppercase tracking-[.12em] text-[#a198a4]">Your budget</div><div className="mt-1 text-base font-extrabold text-[#5b4f60]" data-testid="text-event-budget">{money(event.budget)}</div></div>
    </div>
    {feedback && <div role="status" className="mb-5 flex items-start gap-2 rounded-xl border border-[#d6e8dc] bg-[#f2f8f4] px-4 py-3 text-sm text-[#56765f]" data-testid="status-action-feedback"><CheckCircle2 size={17} className="mt-0.5 shrink-0" />{feedback}<button className="ml-auto" onClick={() => setFeedback('')} aria-label="Dismiss"><X size={15} /></button></div>}
    {!canViewProposal && <div className="mb-5 rounded-2xl border border-[#eadfc8] bg-[#fbf6eb] p-5 sm:p-6"><div className="flex gap-3"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-[#aa8954]"><Clock3 size={17} /></div><div><h2 className="text-sm font-bold text-[#66583e]">{event.status === 'Changes Requested' ? 'Your update is awaiting review.' : event.status === 'AI Draft' ? 'Your request is being shaped.' : 'Your planner is reviewing your request.'}</h2><p className="mt-1 max-w-2xl text-xs leading-relaxed text-[#8f805f]">{event.status === 'Changes Requested' ? 'Your latest requirements are saved. Proposal options will be available after business review and approval.' : 'Your AI proposal will appear here once it has been generated and saved. You can review the draft before business approval.'}</p></div></div></div>}
    {!canViewProposal && event.requestSource === 'supabase' && <div className="mb-5 rounded-2xl border border-[#e9dce5] bg-white p-5 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="text-sm font-bold text-[#574d5d]">Generate your AI proposal</h2><p className="mt-1 text-xs leading-relaxed text-[#8b818e]">Generate Plan A and Plan B for this saved event. This may use RunPod credits.</p></div>
        <Button type="button" disabled={isGeneratingProposal} onClick={() => void handleGenerateProposal()} data-testid="button-generate-persisted-proposal"><Sparkles size={16} />{isGeneratingProposal ? 'Generating Plan A & B…' : 'Generate AI Proposal'}</Button>
      </div>
      {generationError && <p role="alert" className="mt-3 rounded-xl border border-[#efcfd1] bg-[#fff4f4] px-4 py-3 text-sm text-[#a34e58]" data-testid="status-proposal-generation-error">{generationError}</p>}
    </div>}
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <div className="space-y-4">
        <DetailSection icon={<ClipboardList size={17} />} title="Your event details">
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">{[['Date', friendlyDate(event.date)], ['Location', event.location], ['Guest count', `${event.guests} guests`], ['Theme', event.theme || 'Not specified'], ['Budget', money(event.budget)]].map(([key, value]) => <div key={key}><dt className="text-[10px] font-bold uppercase tracking-[.1em] text-[#a097a4]">{key}</dt><dd className="mt-1 text-sm font-semibold text-[#635969]" data-testid={`text-detail-${key.toLowerCase().replaceAll(' ', '-')}`}>{value}</dd></div>)}</dl>
          <div className="mt-5 border-t border-[#f0eaf0] pt-4"><div className="mb-2 text-[10px] font-bold uppercase tracking-[.1em] text-[#a097a4]">Services you’re interested in</div><div className="flex flex-wrap gap-2">{event.services.length ? event.services.map((service) => <span key={service} className="rounded-full bg-[#f6f0f5] px-3 py-1.5 text-xs font-semibold text-[#7d6d81]">{service}</span>) : <span className="text-xs text-[#958b98]">No specific services selected</span>}</div></div>
          {event.requirements && <div className="mt-5 border-t border-[#f0eaf0] pt-4"><div className="mb-2 text-[10px] font-bold uppercase tracking-[.1em] text-[#a097a4]">Additional requirements</div><p className="text-sm leading-relaxed text-[#756b7a]" data-testid="text-event-requirements">{event.requirements}</p></div>}
        </DetailSection>
        {event.status !== 'Customer Accepted' && <DetailSection icon={<MessageSquareText size={17} />} title="Update your request">
          <p className="mb-3 text-sm leading-relaxed text-[#817586]">Have a new idea? Tell us what you would like to add or change. Your original event request stays the same until the planning team reviews this update.</p>
          {!showChangeForm ? <Button variant="outline" onClick={() => setShowChangeForm(true)} data-testid="button-update-request"><Plus size={16} />Add a new update</Button> : <form onSubmit={submitChanges} className="rounded-xl border border-[#eee4ec] bg-[#fdfafb] p-4" data-testid="form-update-request">
            <label className="text-xs font-bold text-[#655b69]" htmlFor="update-request">What would you like to update?</label>
            <textarea id="update-request" value={changeText} onChange={(e) => setChangeText(e.target.value)} required maxLength={2000} rows={4} className={`${inputClass} py-3`} placeholder="e.g. Please change the theme to Garden Party, increase to 50 guests, and include photography." data-testid="textarea-update-request" />
            <p className="mt-2 text-[11px] text-[#988e9b]">This update is saved locally for this demo. Business staff will receive it after a shared backend is connected.</p>
            <div className="mt-3 flex justify-end gap-2"><Button type="button" variant="quiet" onClick={() => { setShowChangeForm(false); setChangeText(''); }} data-testid="button-cancel-update">Cancel</Button><Button type="submit" disabled={!changeText.trim()} data-testid="button-submit-update">Submit Update <ArrowRight size={14} /></Button></div>
          </form>}
        </DetailSection>}
        {canViewProposal && event.proposal && <DetailSection icon={<Sparkles size={17} />} title={isPendingBusinessApproval ? 'Compare your AI draft plans' : isAiDraft ? 'Compare your AI draft plans' : 'Compare your approved plans'}>
          <div className={`mb-4 rounded-xl px-4 py-3 text-xs leading-relaxed ${isAiDraft || isPendingBusinessApproval ? 'border border-[#e6d9ef] bg-[#f7f2fa] text-[#705d7f]' : 'bg-[#f7eff4] text-[#7e6c80]'}`} data-testid={isPendingBusinessApproval ? 'status-proposal-pending-business-approval' : isAiDraft ? 'status-ai-draft-not-approved' : 'status-approved-proposal'}>{isPendingBusinessApproval ? <><strong>AI Draft — not a confirmed quotation.</strong> Compare both plans and indicate which you prefer. Your preference is only saved on this screen for now; it is not yet sent to the business team.</> : isAiDraft ? <><strong>Unapproved AI Draft — Demo Only.</strong> These AI-generated plans are for development/demo review only and cannot be accepted until the planning team approves them.</> : 'These options have business approval and are ready for you. Both are estimates; review the assumptions and unconfirmed costs before choosing.'}</div>
          <div className="grid gap-4 xl:grid-cols-2">{event.proposal.plans.map((plan) => {
            const overBudget = plan.total - event.budget;
            const accepted = event.acceptedPlanId === plan.id;
            return <article key={plan.id} className={`rounded-2xl border p-4 sm:p-5 ${accepted ? 'border-[#aac9b1] bg-[#f7fbf7]' : 'border-[#eee5ec] bg-white'}`} data-testid={`card-plan-${plan.id.toLowerCase()}`}>
              <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-[#a77a94]">Plan {plan.id}</p><h3 className="mt-1 text-lg font-extrabold text-[#514657]">{plan.title}</h3></div>{accepted && <span className="rounded-full bg-[#e8f3ed] px-3 py-1 text-[10px] font-bold text-[#52745f]">Selected</span>}</div>
              <p className="mt-3 text-sm leading-relaxed text-[#756b7a]">{plan.concept}</p>
              <div className="mt-4 space-y-4 border-t border-[#f0eaf0] pt-4">
                <div><h4 className="text-[10px] font-bold uppercase tracking-[.1em] text-[#a097a4]">Event concept and theme</h4><p className="mt-1 text-xs font-semibold text-[#635969]">{plan.theme}</p></div>
                <div><h4 className="text-[10px] font-bold uppercase tracking-[.1em] text-[#a097a4]">Event timeline</h4><ol className="mt-2 space-y-2">{plan.timeline.map((item) => <li key={item.time} className="grid grid-cols-[68px_1fr] gap-2 text-xs"><span className="font-bold text-[#9b6883]">{item.time}</span><span className="text-[#756b7a]">{item.activity}</span></li>)}</ol></div>
                <div><h4 className="text-[10px] font-bold uppercase tracking-[.1em] text-[#a097a4]">Venue and setup</h4><p className="mt-1 text-xs font-semibold text-[#635969]">{plan.venue.name}</p><p className="mt-1 text-xs leading-relaxed text-[#756b7a]">{plan.venue.setup}</p></div>
                <div><h4 className="text-[10px] font-bold uppercase tracking-[.1em] text-[#a097a4]">Catering and selected services</h4><p className="mt-1 text-xs leading-relaxed text-[#756b7a]">{plan.catering}</p><ul className="mt-2 flex flex-wrap gap-1.5">{plan.services.map((service) => <li key={service} className="rounded-full bg-[#f6f0f5] px-2.5 py-1 text-[10px] font-semibold text-[#7d6d81]">{service}</li>)}</ul></div>
                <div><h4 className="text-[10px] font-bold uppercase tracking-[.1em] text-[#a097a4]">Itemized cost breakdown</h4><div className="mt-2 space-y-2">{plan.costs.map((item) => <div key={item.name} className="flex items-start justify-between gap-3 border-b border-[#f3edf2] pb-2 text-xs"><div><p className="font-bold text-[#5a5060]">{item.name} {!item.confirmed && <span className="font-normal text-[#9a8461]">· unconfirmed</span>}</p><p className="mt-0.5 text-[#908693]">{item.detail}</p></div><span className="shrink-0 font-semibold text-[#5c5261]">{money(item.price)}</span></div>)}</div></div>
                <div className="rounded-xl bg-[#fbf7fa] p-3"><div className="flex items-end justify-between gap-2"><div><p className="text-xs font-extrabold text-[#554a5b]">Estimated total</p><p className="mt-1 text-[10px] text-[#9a909d]">Budget: {money(event.budget)}</p></div><p className="text-lg font-extrabold text-[#9e6582]">{money(plan.total)}</p></div><p className={`mt-2 text-xs font-semibold ${overBudget > 0 ? 'text-[#9a6c4c]' : 'text-[#587660]'}`}>{overBudget > 0 ? `${money(overBudget)} over budget` : `${money(-overBudget)} under budget`}</p></div>
                <div><h4 className="text-[10px] font-bold uppercase tracking-[.1em] text-[#a097a4]">AI recommendation</h4><p className="mt-1 text-xs leading-relaxed text-[#756b7a]">{plan.recommendation}</p></div>
                <div className="grid gap-3 sm:grid-cols-2"><div><h4 className="text-[10px] font-bold uppercase tracking-[.1em] text-[#a097a4]">Assumptions</h4><ul className="mt-1 list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-[#756b7a]">{plan.assumptions.map((item) => <li key={item}>{item}</li>)}</ul></div><div><h4 className="text-[10px] font-bold uppercase tracking-[.1em] text-[#a097a4]">Unconfirmed costs</h4><ul className="mt-1 list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-[#756b7a]">{plan.unconfirmedCosts.map((item) => <li key={item}>{item}</li>)}</ul></div></div>
              </div>
              {event.status === 'Approved for Customer' && <Button onClick={() => handleAccept(plan.id)} className="mt-4 w-full" data-testid={`button-accept-plan-${plan.id.toLowerCase()}`}><Check size={16} />Accept Plan {plan.id}</Button>}
              {isPendingBusinessApproval && <Button variant="outline" onClick={() => { preferProposal(event.id, plan.id); setFeedback(`Plan ${plan.id} saved as your preference in this browser. Business submission is not connected yet.`); }} className="mt-4 w-full" data-testid={`button-prefer-plan-${plan.id.toLowerCase()}`}><Heart size={16} />{event.preferredPlanId === plan.id ? `Preferred: Plan ${plan.id}` : `I prefer Plan ${plan.id}`}</Button>}
            </article>;
          })}</div>
          {event.status === 'Customer Accepted' && <div className="mt-4 flex items-center gap-2 rounded-xl bg-[#edf5ef] px-4 py-3 text-sm font-semibold text-[#587660]" data-testid="status-proposal-accepted"><CheckCircle2 size={17} />Plan {event.acceptedPlanId} accepted</div>}
        </DetailSection>}
        {requests.length > 0 && <DetailSection icon={<MessageSquareText size={17} />} title="Your request updates">
          <div className="space-y-3">{requests.map((request) => <div key={request.id} className="rounded-xl border border-[#eee7ef] bg-[#fdfbfc] p-4" data-testid={`card-change-request-${request.id}`}><p className="text-sm leading-relaxed text-[#6c6270]">{request.message}</p><p className="mt-2 text-[10px] font-semibold uppercase tracking-[.1em] text-[#a398a5]">Added {new Date(request.createdAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })}</p></div>)}</div>
        </DetailSection>}
      </div>
      <aside className="space-y-4">
        <div className="rounded-2xl bg-[#f4e9ef] p-5"><div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-white/70 text-[#a46b88]"><Heart size={17} /></div><h3 className="text-sm font-bold text-[#5d4d5d]">Planned around you</h3><p className="mt-2 text-xs leading-relaxed text-[#827180]">Your planner will shape the details with your priorities, guest list, and budget in mind.</p></div>
        {canViewProposal && <div className="ef-card rounded-2xl p-5"><h3 className="text-sm font-bold text-[#594f5e]">A note on estimates</h3><p className="mt-2 text-xs leading-relaxed text-[#8b818e]">These are AI-generated estimates, not confirmed quotations. Your preferred plan still needs business review; prices and suppliers require confirmation.</p><p className="mt-2 text-[10px] text-[#a097a4]">{event.proposal?.source === 'persisted-ai' ? 'Saved AI proposal · pending business approval' : event.proposal?.source === 'ai-service' ? 'AI-generated estimate · pending business approval' : 'Sample proposal data · demo'}</p></div>}
      </aside>
    </div>
  </div>;
}
function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const { signIn } = useCustomer();
  const [, setLocation] = useLocation();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [demoMessage, setDemoMessage] = useState('');
  const isRegister = mode === 'register';
  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(''); setNotice(''); setDemoMessage(''); setLoading(true);
    const form = new FormData(event.currentTarget);
    const result = await signIn(String(form.get('email')), String(form.get('password')), isRegister, String(form.get('fullName') ?? ''));
    setLoading(false);
    if (result.error) setError(result.error);
    else if (result.message) setNotice(result.message);
    else if (result.signedIn) setLocation('/dashboard');
  };
  const demo = () => setDemoMessage('Please sign in or create a customer account. The sample events remain available after authentication.');
  return <div className="grid min-h-[100dvh] bg-[#fcfaf9] lg:grid-cols-[minmax(400px,1fr)_minmax(460px,1fr)]">
    <section className="relative hidden overflow-hidden bg-[#f3e4eb] p-12 lg:flex lg:flex-col lg:justify-between xl:p-16">
      <div className="absolute -left-24 top-[22%] h-[410px] w-[410px] rounded-full border border-[#e3ccd9]" /><div className="absolute left-16 top-[32%] h-[300px] w-[300px] rounded-full border border-[#e3ccd9]" /><div className="absolute right-[-10%] top-[39%] h-[220px] w-[220px] rounded-full bg-[#e8d2dd]/60" />
      <Link href="/login" className="relative inline-flex w-fit items-center gap-3 no-underline"><Brand /></Link>
      <div className="relative max-w-lg pb-7"><div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/65 text-[#a36b89]"><Flower2 size={23} /></div><p className="mb-3 text-[10px] font-bold uppercase tracking-[.19em] text-[#9d6c87]">A calmer way to celebrate</p><h1 className="text-[40px] font-extrabold leading-[1.08] text-[#4e4053] xl:text-[48px]">The best days<br />begin with a plan.</h1><p className="mt-5 max-w-sm text-sm leading-relaxed text-[#806e7d]">A thoughtful place to shape your event, stay close to the details, and enjoy the build-up.</p><div className="mt-8 flex items-center gap-3"><div className="flex -space-x-2"><span className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-[#f3e4eb] bg-[#d6c1df] text-[10px] font-bold text-[#62566b]">E</span><span className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-[#f3e4eb] bg-[#e9c8c0] text-[10px] font-bold text-[#6d5651]">M</span><span className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-[#f3e4eb] bg-[#c6d9cb] text-[10px] font-bold text-[#4e6855]">A</span></div><span className="text-xs font-medium text-[#817180]">Made personal, from the first note.</span></div></div>
      <p className="relative text-[11px] text-[#9a8292]">A little more ease for the moments that matter.</p>
    </section>
    <section className="flex min-h-[100dvh] items-center justify-center px-5 py-12 sm:px-10">
      <div className="w-full max-w-[420px] ef-enter">
        <div className="mb-9 lg:hidden"><Brand /></div>
        <p className="mb-2 text-[10px] font-bold uppercase tracking-[.18em] text-[#aa7793]">{isRegister ? 'A lovely place to start' : 'Welcome back'}</p>
        <h2 className="text-[31px] font-extrabold leading-tight text-[#4b414f]" data-testid="text-auth-title">{isRegister ? 'Create your account' : 'Sign in to your space'}</h2>
        <p className="mt-2 text-sm text-[#8d8391]">{isRegister ? 'Your planning journey starts with a few details.' : 'Your plans are right where you left them.'}</p>
        {error && <div role="alert" className="mt-5 rounded-xl border border-[#efcfd1] bg-[#fff4f4] px-4 py-3 text-sm text-[#a34e58]" data-testid="status-auth-error">{error}</div>}
        {notice && <div role="status" className="mt-5 rounded-xl border border-[#d6e8dc] bg-[#f2f8f4] px-4 py-3 text-sm text-[#56765f]">{notice}</div>}
        {demoMessage && <div role="status" className="mt-5 rounded-xl border border-[#e5d9e2] bg-white px-4 py-3 text-sm text-[#706275]">{demoMessage}</div>}
        <form onSubmit={onSubmit} className="mt-7 space-y-4">
          {isRegister && <label className="block"><span className={labelClass}>Full name</span><input name="fullName" type="text" required autoComplete="name" placeholder="Your name" className={inputClass} data-testid="input-auth-name" /></label>}
          <label className="block"><span className={labelClass}>Email address</span><input name="email" type="email" required autoComplete="email" placeholder="you@example.com" className={inputClass} data-testid="input-auth-email" /></label>
          <label className="block"><span className={labelClass}>Password</span><input name="password" type="password" required minLength={6} autoComplete={isRegister ? 'new-password' : 'current-password'} placeholder="At least 6 characters" className={inputClass} data-testid="input-auth-password" /></label>
          <Button type="submit" disabled={loading} className="mt-2 w-full" data-testid={isRegister ? 'button-register' : 'button-login'}>{loading ? (isRegister ? 'Creating account…' : 'Signing in…') : (isRegister ? 'Create account' : 'Sign in')} {!loading && <ArrowRight size={15} />}</Button>
        </form>
        <div className="my-6 flex items-center gap-3"><div className="h-px flex-1 bg-[#eee6ec]" /><span className="text-[10px] font-semibold uppercase tracking-[.12em] text-[#aaa0ad]">or try the demo</span><div className="h-px flex-1 bg-[#eee6ec]" /></div>
        <button type="button" onClick={demo} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-[#e5d9e2] bg-white text-sm font-bold text-[#706275] transition-colors hover:bg-[#fcf7fa]" data-testid="button-demo-login"><Sparkles size={16} className="text-[#aa7190]" />View sample events after sign in</button>
        <p className="mt-6 text-center text-xs text-[#8d8391]">{isRegister ? 'Already planning with us?' : 'New to EventFlow?'} <Link href={isRegister ? '/login' : '/register'} className="font-bold text-[#a26684] no-underline hover:underline" data-testid={isRegister ? 'link-login' : 'link-register'}>{isRegister ? 'Sign in' : 'Create an account'}</Link></p>
        <p className="mt-8 text-center text-[10px] leading-relaxed text-[#a69ca8]">Sign in with your EventFlow customer account.<br />Sample events are retained for demonstration.</p>
      </div>
    </section>
  </div>;
}
function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, authLoading } = useCustomer();
  if (authLoading) return <div className="flex min-h-[100dvh] items-center justify-center bg-[#fcfaf9] text-sm text-[#817886]" role="status">Restoring your secure session…</div>;
  if (!user) return <RedirectToLogin />;
  return <AppShell>{children}</AppShell>;
}
function RedirectToLogin() {
  const [, setLocation] = useLocation();
  useEffect(() => { setLocation('/login'); }, [setLocation]);
  return <div className="min-h-[100dvh] bg-[#fcfaf9]" />;
}
export function CustomerArea() {
  return <Switch>
    <Route path="/"><RedirectToLogin /></Route>
    <Route path="/login"><AuthPage mode="login" /></Route>
    <Route path="/register"><AuthPage mode="register" /></Route>
    <Route path="/dashboard"><ProtectedRoute><Dashboard /></ProtectedRoute></Route>
    <Route path="/events"><ProtectedRoute><EventsList /></ProtectedRoute></Route>
    <Route path="/events/new"><ProtectedRoute><CreateEvent /></ProtectedRoute></Route>
    <Route path="/events/:id">{(params) => <ProtectedRoute><EventDetail id={params.id} /></ProtectedRoute>}</Route>
    <Route><NotFound /></Route>
  </Switch>;
}
function NotFound() {
  return <div className="ef-card mx-auto mt-12 max-w-xl rounded-2xl p-10 text-center"><p className="text-[10px] font-bold uppercase tracking-[.16em] text-[#a77a94]">A small detour</p><h1 className="mt-2 text-3xl font-extrabold text-[#4f4654]">This page isn’t here.</h1><p className="mt-2 text-sm text-[#8d8391]">Let’s get you back to your plans.</p><Link href="/dashboard" className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[#bb7d99] px-4 py-3 text-sm font-bold text-white no-underline"><ArrowLeft size={15} />Back to overview</Link></div>;
}
