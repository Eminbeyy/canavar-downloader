// API istemcisi + çevrimdışı kuyruk. Durum değiştiren istekler ağ yoksa kuyruğa alınır, bağlanınca gönderilir.
export class NetError extends Error {}
export class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* özel mod / dolu */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* yoksay */ } },
};
export { store };

export async function api(method, path, body) {
  let res;
  try {
    res = await fetch(path, { method, credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-g90': '1' }, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch { throw new NetError('offline'); }
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : {}; } catch { data = text; }
  if (res.status === 401 && !path.startsWith('/api/auth/')) window.dispatchEvent(new Event('g90:unauth'));
  if (!res.ok) throw new HttpError(res.status, (data && data.error) || 'Bir sorun oluştu');
  return data;
}

const QK = 'g90q';
export const pending = () => store.get(QK, []).length;
export async function mutate(method, path, body) {
  try { return await api(method, path, body); } catch (e) {
    if (!(e instanceof NetError)) throw e;
    const q = store.get(QK, []).filter((x) => !(x.m === method && x.p === path)); // aynı kaynak için son değer geçerli
    q.push({ m: method, p: path, b: body, ts: Date.now() });
    store.set(QK, q);
    return { queued: true };
  }
}
let flushing = false;
export async function flush() {
  if (flushing) return 0;
  flushing = true; let n = 0;
  try {
    let q = store.get(QK, []);
    while (q.length) {
      const it = q[0];
      try { await api(it.m, it.p, it.b); } catch (e) { if (e instanceof NetError) break; /* 4xx: vazgeç */ }
      q = q.slice(1); store.set(QK, q); n++;
    }
  } finally { flushing = false; }
  return n;
}
