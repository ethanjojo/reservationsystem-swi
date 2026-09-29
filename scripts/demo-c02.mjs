import assert from 'node:assert/strict';
const base = process.env.API_BASE_URL ?? 'http://localhost:3000';
const token = process.env.DEMO_PATIENT_TOKEN;
const doctorToken = process.env.DEMO_DOCTOR_TOKEN;
if (!doctorToken) throw new Error('Set DEMO_DOCTOR_TOKEN in .env and restart API');
if (!token) throw new Error('Set DEMO_PATIENT_TOKEN in .env and restart API with the same configuration');
const ids = { patientId: '00000000-0000-4000-8000-000000000001', doctorId: '00000000-0000-4000-8000-000000000002', serviceId: '00000000-0000-4000-8000-000000000003' };
async function call(path, method = 'GET', body, expected = 200, key = token) {
  const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json();
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(result)}`);
  console.info(`${method} ${path.split('?')[0]} -> ${response.status} ${result.status ?? result.available ?? result.error?.code ?? ''}`);
  return result;
}
const date = new Date(); date.setUTCDate(date.getUTCDate() + ((8 - date.getUTCDay()) % 7 || 7)); date.setUTCHours(8, 0, 0, 0);
if (date.getTime() < Date.now() + 48 * 60 * 60_000) date.setUTCDate(date.getUTCDate() + 7);
let startsAt;
for (let i = 0; i < 12; i++) {
  const candidate = new Date(date.getTime() + i * 30 * 60_000).toISOString();
  const query = new URLSearchParams({ doctorId: ids.doctorId, serviceId: ids.serviceId, startsAt: candidate });
  if ((await call(`/availability?${query}`)).available) { startsAt = candidate; break; }
}
if (!startsAt) throw new Error('No free demo interval next Monday; use an empty demo doctor');
const query = new URLSearchParams({ doctorId: ids.doctorId, serviceId: ids.serviceId, startsAt });
const created = [];
try {
  await call('/reservations', 'POST', { ...ids, startsAt: 'invalid' }, 400);
  await call('/availability?' + new URLSearchParams({ doctorId: ids.doctorId, serviceId: ids.serviceId, startsAt: 'invalid' }), 'GET', undefined, 400);
  const first = await call('/reservations', 'POST', { ...ids, startsAt }, 201); created.push(first.id);
  assert.equal(first.status, 'DRAFT');
  assert.equal((await call(`/availability?${query}`)).available, true);
  assert.equal((await call(`/reservations/${first.id}/confirm`, 'POST')).status, 'PENDING_APPROVAL');
  assert.equal((await call(`/availability?${query}`)).available, true);
  await call(`/reservations/${first.id}/confirm`, 'POST', undefined, 409);
  await call(`/reservations/${first.id}/approve`, 'POST', undefined, 403);
  assert.equal((await call(`/reservations/${first.id}/approve`, 'POST', undefined, 200, doctorToken)).status, 'CONFIRMED');
  assert.equal((await call(`/availability?${query}`)).available, false);
  const second = await call('/reservations', 'POST', { ...ids, startsAt }, 201); created.push(second.id);
  assert.equal((await call(`/reservations/${second.id}/confirm`, 'POST')).status, 'PENDING_APPROVAL');
  await call(`/reservations/${second.id}/approve`, 'POST', undefined, 409, doctorToken);
  assert.equal((await call(`/reservations/${second.id}`)).status, 'PENDING_APPROVAL');
  assert.equal((await call(`/reservations/${second.id}/reject`, 'POST', undefined, 200, doctorToken)).status, 'REJECTED');
  await call(`/reservations/${second.id}/approve`, 'POST', undefined, 409, doctorToken);
  await call(`/reservations/${first.id}/cancel`, 'POST');
  assert.equal((await call(`/availability?${query}`)).available, true);
  await call(`/reservations/${first.id}/cancel`, 'POST');
  await call('/reservations/00000000-0000-4000-8000-000000000098/cancel', 'POST', undefined, 404);
  const third = await call('/reservations', 'POST', { ...ids, startsAt }, 201); created.push(third.id);
  await call(`/reservations/${third.id}/confirm`, 'POST');
  assert.equal((await call(`/reservations/${third.id}/cancel`, 'POST')).status, 'CANCELLED');
  console.info('C02 v0.2: base operations, approval, rejection and conflict demonstrated successfully. Exact expiry is demonstrated by npm test.');
} finally {
  for (const id of created) {
    const row = await call(`/reservations/${id}`);
    if (!['REJECTED', 'EXPIRED', 'CANCELLED'].includes(row.status)) await call(`/reservations/${id}/cancel`, 'POST');
  }
}
