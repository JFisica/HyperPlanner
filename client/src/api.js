let pin = localStorage.getItem('ehw_pin') || '';

export function getPin() {
  return pin;
}

export function setPin(p) {
  pin = p;
  localStorage.setItem('ehw_pin', p);
}

export function clearPin() {
  pin = '';
  localStorage.removeItem('ehw_pin');
}

export async function apiGet(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error('Error de red');
  return res.json();
}

export async function apiSend(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Admin-Pin': pin },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON error */
  }
  if (!res.ok) {
    const err = new Error((json && json.error) || `Error ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return json;
}
