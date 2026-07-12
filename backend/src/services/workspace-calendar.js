const { googleFetch } = require('./google-auth');

const CAL = 'https://www.googleapis.com/calendar/v3/calendars/primary';

function toEventSummary(event) {
  const start = event.start?.dateTime || event.start?.date || '';
  const end = event.end?.dateTime || event.end?.date || '';
  return {
    id: event.id,
    summary: event.summary || '(no title)',
    description: event.description || '',
    location: event.location || '',
    start,
    end,
    html_link: event.htmlLink || null,
    all_day: Boolean(event.start?.date),
    status: event.status || 'confirmed',
  };
}

async function listEvents({ days = 14, maxResults = 50 } = {}) {
  const timeMin = new Date().toISOString();
  const timeMax = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    maxResults: String(maxResults),
    singleEvents: 'true',
    orderBy: 'startTime',
  });

  const data = await googleFetch(`${CAL}/events?${params}`);
  return (data.items || []).map(toEventSummary);
}

async function createEvent({ summary, description, location, start, end, allDay }) {
  const payload = {
    summary,
    description: description || undefined,
    location: location || undefined,
    start: allDay ? { date: start.slice(0, 10) } : { dateTime: start },
    end: allDay ? { date: end.slice(0, 10) } : { dateTime: end },
  };

  const event = await googleFetch(`${CAL}/events`, {
    method: 'POST',
    body: payload,
  });
  return toEventSummary(event);
}

async function updateEvent(eventId, { summary, description, location, start, end, allDay }) {
  const existing = await googleFetch(`${CAL}/events/${eventId}`);
  const payload = {
    ...existing,
    summary: summary ?? existing.summary,
    description: description ?? existing.description,
    location: location ?? existing.location,
  };

  if (start) {
    payload.start = allDay ? { date: start.slice(0, 10) } : { dateTime: start };
  }
  if (end) {
    payload.end = allDay ? { date: end.slice(0, 10) } : { dateTime: end };
  }

  const event = await googleFetch(`${CAL}/events/${eventId}`, {
    method: 'PUT',
    body: payload,
  });
  return toEventSummary(event);
}

async function deleteEvent(eventId) {
  await googleFetch(`${CAL}/events/${eventId}`, { method: 'DELETE' });
  return true;
}

module.exports = {
  listEvents,
  createEvent,
  updateEvent,
  deleteEvent,
  toEventSummary,
};
