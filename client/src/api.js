export async function apiGet(path) {
  const res = await fetch(path);
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) {
    const err = new Error((json && json.error) || `Error ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

export async function apiSend(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) {
    const err = new Error((json && json.error) || `Error ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return json;
}
