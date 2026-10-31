import { useState } from 'react';
import { CheckCircle2, ChevronLeft, ChevronRight, Plus, ShieldBan, Trash2 } from 'lucide-react';

type CalendarManagementProps = {
  store: {
    events: Array<{ id: string; name: string; customer: string; date: string; time: string; status: string; guests: number; value: number }>;
    blockedSlots?: Array<{ id: string; date: string; reason: string }>;
  };
  openModal: (modal: { kind: 'event' | 'block'; item?: { date: string } }) => void;
  unblockSlot: (id: string) => void;
};

const localDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const labelDate = (date: string, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) =>
  new Date(`${date}T12:00:00`).toLocaleDateString('en-MY', options);
const money = (value: number) => `RM ${value.toLocaleString('en-MY')}`;

export default function CalendarManagementPage({ store, openModal, unblockSlot }: CalendarManagementProps) {
  const now = new Date();
  const today = localDate(now);
  const [view, setView] = useState<'Month' | 'Week' | 'Day'>('Month');
  const [month, setMonth] = useState(new Date(now.getFullYear(), now.getMonth(), 1));
  const [selected, setSelected] = useState(today);
  const events = store.events.filter((event) => event.status !== 'Cancelled');
  const blocks = store.blockedSlots || [];
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const monthDays = new Date(year, monthIndex + 1, 0).getDate();
  const monthOffset = new Date(year, monthIndex, 1).getDay();
  const selectedEvents = events.filter((event) => event.date === selected);
  const selectedBlock = blocks.find((block) => block.date === selected);
  const monthLabel = month.toLocaleDateString('en-MY', { month: 'long', year: 'numeric' });
  const moveMonth = (amount: number) => {
    const next = new Date(month);
    next.setMonth(next.getMonth() + amount);
    setMonth(next);
  };
  const openForSelectedDate = (kind: 'event' | 'block') => openModal({ kind, item: { date: selected } });
  const dayEvents = (date: string) => events.filter((event) => event.date === date);
  const dayBlock = (date: string) => blocks.find((block) => block.date === date);
  const setCalendarDate = (date: string) => {
    setSelected(date);
    const parsed = new Date(`${date}T12:00:00`);
    setMonth(new Date(parsed.getFullYear(), parsed.getMonth(), 1));
  };
  const changeSelectedDay = (offset: number) => {
    const date = new Date(`${selected}T12:00:00`);
    date.setDate(date.getDate() + offset);
    setCalendarDate(localDate(date));
  };

  const renderDay = (date: string, compact = false) => {
    const items = dayEvents(date);
    const block = dayBlock(date);
    return (
      <button
        key={date}
        type="button"
        onClick={() => setSelected(date)}
        className={`min-h-[78px] border-b border-r border-[#f1edf1] p-1.5 text-left transition hover:bg-[#fcf8fc] sm:min-h-[94px] sm:p-2 ${selected === date ? 'bg-[#f7eff8]' : ''}`}
        data-testid={`calendar-day-${date}`}
      >
        <span className={`grid h-6 w-6 place-items-center rounded-full text-[10px] ${date === today ? 'bg-[#bd7294] text-white' : 'text-[#706779]'}`}>
          {new Date(`${date}T12:00:00`).getDate()}
        </span>
        <div className="mt-1 space-y-1">
          {block && <div className="truncate rounded bg-[#f4e3e9] px-1 py-1 text-[8px] font-bold text-[#9a536f] sm:text-[9px]">Blocked</div>}
          {items.slice(0, block ? 1 : 2).map((event) => (
            <div key={event.id} className="truncate rounded bg-[#fdf1d2] px-1 py-1 text-[8px] font-semibold text-[#8d7130] sm:text-[9px]">{event.name}</div>
          ))}
          {items.length > (block ? 1 : 2) && <p className="text-[8px] text-[#827588]">+{items.length - (block ? 1 : 2)} more</p>}
        </div>
      </button>
    );
  };

  const focusedDates = view === 'Day'
    ? [selected]
    : Array.from({ length: 7 }, (_, index) => {
        const date = new Date(`${selected}T12:00:00`);
        date.setDate(date.getDate() - date.getDay() + index);
        return localDate(date);
      });

  return (
    <div className="fade-in">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 text-[10px] font-bold uppercase tracking-[.2em] text-[#a987a9]">Plan with confidence</div>
          <h1 className="text-[30px] leading-tight tracking-[-.7px] text-[#342b3c] md:text-[36px]">Availability</h1>
          <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-[#827889]">See reserved events and block dates when your studio is unavailable.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => openForSelectedDate('event')} className="inline-flex min-h-9 items-center gap-2 rounded-xl bg-[#bd7294] px-3.5 py-2 text-[12px] font-bold text-white shadow-sm hover:bg-[#a95f81]" data-testid="button-calendar-create-event"><Plus size={14}/> Create event</button>
          {!selectedBlock && selectedEvents.length === 0 && <button type="button" onClick={() => openForSelectedDate('block')} className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-[#e7dce9] bg-white px-3.5 py-2 text-[12px] font-bold text-[#66566e] hover:bg-[#faf6fb]" data-testid="button-calendar-block-date"><ShieldBan size={14}/> Block date</button>}
          <div className="flex rounded-xl border border-[#eee7ef] bg-white p-1">
            {(['Month', 'Week', 'Day'] as const).map((mode) => (
              <button key={mode} type="button" onClick={() => setView(mode)} className={`rounded-lg px-3 py-2 text-[10px] font-bold ${view === mode ? 'bg-[#bd7294] text-white' : 'text-[#827588]'}`} data-testid={`button-calendar-${mode.toLowerCase()}`}>{mode}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-3 text-[10px] font-semibold text-[#827987]">
        <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-[#83b598]"/>Available</span>
        <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-[#e7c96f]"/>Reserved</span>
        <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-[#d77d82]"/>Blocked</span>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.55fr_1fr]">
        <section className="surface overflow-hidden rounded-2xl">
          <div className="flex items-center justify-between border-b border-[#f0ebf1] px-4 py-4">
            <div>
              <h2 className="text-[20px]">{view === 'Month' ? monthLabel : labelDate(selected, { month: 'long', year: 'numeric' })}</h2>
              <p className="mt-1 text-[10px] text-[#9b919e]">{view} view · {events.length} reserved events · {blocks.length} blocked dates</p>
            </div>
            <div className="flex gap-1">
              {view === 'Month' ? (
                <>
                  <button type="button" onClick={() => moveMonth(-1)} aria-label="Previous month" className="rounded-lg p-2 hover:bg-[#f7f2f8]" data-testid="button-calendar-prev"><ChevronLeft size={17}/></button>
                  <button type="button" onClick={() => { setMonth(new Date(now.getFullYear(), now.getMonth(), 1)); setSelected(today); }} className="rounded-lg px-2 text-[10px] font-bold text-[#84618c] hover:bg-[#f7f2f8]" data-testid="button-calendar-today">Today</button>
                  <button type="button" onClick={() => moveMonth(1)} aria-label="Next month" className="rounded-lg p-2 hover:bg-[#f7f2f8]" data-testid="button-calendar-next"><ChevronRight size={17}/></button>
                </>
              ) : (
                <>
                  <button type="button" onClick={() => changeSelectedDay(view === 'Week' ? -7 : -1)} aria-label="Previous date range" className="rounded-lg p-2 hover:bg-[#f7f2f8]" data-testid="button-calendar-range-prev"><ChevronLeft size={17}/></button>
                  <button type="button" onClick={() => setCalendarDate(today)} className="rounded-lg px-2 text-[10px] font-bold text-[#84618c] hover:bg-[#f7f2f8]" data-testid="button-calendar-today">Today</button>
                  <button type="button" onClick={() => changeSelectedDay(view === 'Week' ? 7 : 1)} aria-label="Next date range" className="rounded-lg p-2 hover:bg-[#f7f2f8]" data-testid="button-calendar-range-next"><ChevronRight size={17}/></button>
                </>
              )}
            </div>
          </div>
          {view === 'Month' ? (
            <>
              <div className="grid grid-cols-7 border-b border-[#f0ebf1] bg-[#fcfafc]">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <div key={day} className="py-3 text-center text-[9px] font-bold uppercase tracking-[.1em] text-[#a39aa7]">{day}</div>)}
              </div>
              <div className="grid grid-cols-7">
                {Array.from({ length: monthOffset }, (_, index) => <div key={`empty-${index}`} className="min-h-[78px] border-b border-r border-[#f1edf1] bg-[#fcfbfc] sm:min-h-[94px]"/>)}
                {Array.from({ length: monthDays }, (_, index) => {
                  const date = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(index + 1).padStart(2, '0')}`;
                  return renderDay(date);
                })}
              </div>
            </>
          ) : (
            <div className={`grid grid-cols-1 divide-y divide-[#f0ebf1] ${view === 'Week' ? 'sm:grid-cols-7' : 'sm:grid-cols-1'} sm:divide-x sm:divide-y-0`}>
              {focusedDates.map((date) => (
                <button key={date} type="button" onClick={() => setSelected(date)} className={`min-h-28 p-3 text-left hover:bg-[#fcf8fc] ${date === selected ? 'bg-[#f7eff8]' : ''}`} data-testid={`calendar-${view.toLowerCase()}-${date}`}>
                  <span className="text-[9px] font-bold uppercase text-[#9b8fa0]">{labelDate(date, { weekday: 'short' })}</span>
                  <span className="ml-2 text-[12px] font-bold">{labelDate(date, { day: 'numeric', month: 'short' })}</span>
                  {dayBlock(date) && <div className="mt-2 rounded-md bg-[#f4e3e9] px-2 py-1 text-[9px] font-semibold text-[#9a536f]">Blocked · {dayBlock(date)?.reason}</div>}
                  {dayEvents(date).map((event) => <div key={event.id} className="mt-2 rounded-md bg-[#fdf1d2] px-2 py-1 text-[9px] text-[#8d7130]">{event.time} · {event.name}</div>)}
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="surface rounded-2xl p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-[14px] font-bold tracking-[-.15px] text-[#413747]">Date details</h2>
            <span className="text-[10px] text-[#9d93a0]">{labelDate(selected, { weekday: 'short', day: 'numeric', month: 'long' })}</span>
          </div>
          {selectedBlock ? (
            <div className="mb-3 rounded-xl border border-[#f0dbe3] bg-[#fdf7f9] p-4" data-testid={`calendar-block-${selectedBlock.id}`}>
              <div className="flex items-center gap-2 text-[#9a536f]"><ShieldBan size={16}/><span className="text-[12px] font-bold">Date blocked</span></div>
              <p className="mt-2 text-[11px] leading-relaxed text-[#806873]">{selectedBlock.reason}</p>
              <button type="button" onClick={() => unblockSlot(selectedBlock.id)} className="mt-3 inline-flex items-center gap-1 text-[10px] font-bold text-[#9a536f] hover:underline" data-testid={`button-unblock-${selectedBlock.id}`}><Trash2 size={12}/> Remove block</button>
            </div>
          ) : selectedEvents.length === 0 ? (
            <div className="rounded-xl bg-[#f4f8f5] p-4">
              <div className="flex items-center gap-2 text-[#5c896b]"><CheckCircle2 size={16}/><span className="text-[12px] font-bold">Available to book</span></div>
              <p className="mt-2 text-[10px] leading-relaxed text-[#7d8f80]">No events or blocks are saved for this date.</p>
            </div>
          ) : null}
          {selectedEvents.map((event) => (
            <div key={event.id} className="mb-3 rounded-xl border border-[#f0eaf1] p-3" data-testid={`calendar-event-${event.id}`}>
              <div className="flex items-center justify-between gap-2"><b className="text-[12px]">{event.name}</b><span className="rounded-full bg-[#fdf1d2] px-2 py-1 text-[9px] font-bold text-[#8d7130]">{event.status}</span></div>
              <p className="mt-2 text-[10px] text-[#8d8291]">{event.customer} · {event.time} · {event.guests} guests</p>
              <p className="mt-2 text-[10px] font-semibold text-[#76657e]">{money(event.value)}</p>
            </div>
          ))}
          {selectedEvents.length > 0 && !selectedBlock && <p className="mb-3 text-[10px] text-[#918695]">This date has an event, so a full-day block cannot be added.</p>}
          <div className="mt-4 flex flex-wrap gap-2 border-t border-[#f0ebf1] pt-4">
            <button type="button" onClick={() => openForSelectedDate('event')} className="inline-flex items-center gap-1.5 rounded-lg bg-[#bd7294] px-3 py-2 text-[10px] font-bold text-white hover:bg-[#a95f81]" data-testid="button-date-create-event"><Plus size={13}/> Create event</button>
            {!selectedBlock && selectedEvents.length === 0 && <button type="button" onClick={() => openForSelectedDate('block')} className="inline-flex items-center gap-1.5 rounded-lg border border-[#e7dce9] bg-white px-3 py-2 text-[10px] font-bold text-[#66566e] hover:bg-[#faf6fb]" data-testid="button-date-block"><ShieldBan size={13}/> Block date</button>}
          </div>
          <div className="mt-5 border-t border-[#f0ebf1] pt-4">
            <h3 className="mb-2 text-[11px] font-bold">Next reserved dates</h3>
            {[...events.map((event) => ({ date: event.date, label: event.name, id: event.id })), ...blocks.map((block) => ({ date: block.date, label: `Blocked · ${block.reason}`, id: block.id }))]
              .filter((item) => item.date >= today)
              .sort((a, b) => a.date.localeCompare(b.date))
              .slice(0, 5)
              .map((item) => (
                <button key={item.id} type="button" onClick={() => setCalendarDate(item.date)} className="flex w-full items-center justify-between border-b border-[#f5f0f5] py-2 text-left" data-testid={`button-upcoming-date-${item.id}`}>
                  <span className="truncate pr-2 text-[10px] font-semibold">{labelDate(item.date, { day: 'numeric', month: 'short' })} · {item.label}</span><ChevronRight size={13} className="shrink-0 text-[#a99eae]"/>
                </button>
              ))}
          </div>
        </section>
      </div>
    </div>
  );
}
