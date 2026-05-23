import { Linking, Platform } from 'react-native';

export type CalendarEvent = {
  /** Stable, globally-unique id, e.g. "{set.id}-release@altarttracker". */
  uid: string;
  title: string;
  /** Drop date as a date or timestamptz string; the UTC date portion is used. */
  date: string;
  description?: string;
};

// RFC 5545 text escaping: backslash, semicolon and comma get escaped, and any
// newline becomes a literal "\n". Order matters — escape backslashes first.
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

// "YYYYMMDD" from the UTC date portion of the input. The alert crons interpret
// drop dates by their UTC date, so we match that here for consistency.
function toIcsDate(date: string): string {
  const d = new Date(date);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

// All-day VEVENTs use an exclusive DTEND, so the end date is the day *after*
// the start. Add one UTC day, then re-format.
function nextIcsDate(date: string): string {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + 1);
  return toIcsDate(d.toISOString());
}

// "YYYYMMDDTHHMMSSZ" — the UTC timestamp form used for DTSTAMP.
function toIcsDateTimeUtc(d: Date): string {
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const h = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  const s = String(d.getUTCSeconds()).padStart(2, '0');
  return `${y}${mo}${day}T${h}${mi}${s}Z`;
}

/**
 * Build a valid single-VEVENT VCALENDAR string for an all-day event.
 * Lines are CRLF-terminated per RFC 5545.
 */
export function buildIcs(event: CalendarEvent): string {
  const dtStart = toIcsDate(event.date);
  const dtEnd = nextIcsDate(event.date);
  const dtStamp = toIcsDateTimeUtc(new Date());

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Alt Art Tracker//Upcoming Drops//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${escapeText(event.uid)}`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART;VALUE=DATE:${dtStart}`,
    `DTEND;VALUE=DATE:${dtEnd}`,
    `SUMMARY:${escapeText(event.title)}`,
  ];

  if (event.description) {
    lines.push(`DESCRIPTION:${escapeText(event.description)}`);
  }

  lines.push('END:VEVENT', 'END:VCALENDAR');

  return lines.join('\r\n') + '\r\n';
}

// Lowercase slug for the download filename; falls back to "event".
function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'event';
}

/**
 * Generate the .ics for an event and hand it to the platform's calendar.
 * Web downloads/opens a blob; native uses a best-effort data: URL.
 */
export function addToCalendar(event: CalendarEvent): void {
  const ics = buildIcs(event);

  if (Platform.OS === 'web') {
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slugify(event.title)}.ics`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return;
  }

  // TODO: native polish via expo-sharing when we ship native (EAS)
  void Linking.openURL(
    'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics),
  );
}
