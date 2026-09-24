export interface WorkingWindow { weekday: number; startMinute: number; endMinute: number }

const clock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Prague", calendar: "iso8601", numberingSystem: "latn",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

function localMinute(instant: number) {
  const parts = Object.fromEntries(clock.formatToParts(instant).map(part => [part.type, part.value]));
  const weekday = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day))).getUTCDay() || 7;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, weekday,
    minute: Number(parts.hour) * 60 + Number(parts.minute) };
}

export function fitsWorkingWindow(startsAt: Date, durationMinutes: number, windows: WorkingWindow[]): boolean {
  const start = startsAt.getTime();
  if (!Number.isFinite(start) || start % 60_000 !== 0 ||
      !Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440) return false;

  // All boundaries have whole-minute precision. Partition [start,end) into its exact
  // minute intervals, including the repeated/skipped local clock minutes at DST.
  const minutes = Array.from({ length: durationMinutes }, (_, i) => localMinute(start + i * 60_000));
  const first = minutes[0]!;
  return windows.some(window =>
    window.weekday === first.weekday && (first.minute - window.startMinute) % 15 === 0 &&
    minutes.every(minute => minute.date === first.date &&
      minute.minute >= window.startMinute && minute.minute < window.endMinute),
  );
}
