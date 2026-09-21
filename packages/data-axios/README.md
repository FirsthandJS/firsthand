# @firsthandjs/data-axios

Axios as a client for [`@firsthandjs/data`](https://www.npmjs.com/package/@firsthandjs/data).

```
npm install @firsthandjs/data-axios
```

0.47 kB gzip. It has **no dependency on Axios** and no peer dependency either —
the one method it uses is declared structurally, so it has no opinion about
which version you run, and nothing to follow when that version changes.

```tsx
import axios from 'axios';
import { createAxiosClient } from '@firsthandjs/data-axios';
import { tag, useResource } from '@firsthandjs/data';

const instance = axios.create({ baseURL: '/api' });
instance.interceptors.response.use(undefined, retryOnce);

export const api = createAxiosClient(instance, {
  // Read per request and untracked: the token may change, and a resource must
  // not depend on it.
  headers: () => ({ authorization: `Bearer ${session.token.peek()}` }),
  cache: { ttl: 30_000 },
});

function Profile(props: { id: string }) {
  const profile = useResource(({ request, tags }) => {
    tags(tag('profile', { id: props.id }));
    return api.get<Profile>(`/profiles/${props.id}`)(request);
  });

  return <h1>{profile.data.value?.name ?? '…'}</h1>;
}
```

## The client

`request`, plus `get`, `post`, `put`, `patch` and `remove` as the shortcuts you
would otherwise write. Each returns a **loader** — a function waiting for the
request — so a call site reads `api.get<T>(url)(request)`.

```ts
api.get<Profile>('/profiles/7');
api.post<Profile>('/profiles', { name: 'Ada' });
api.request<Row[]>({ url: '/rows', method: 'report' });
api.with({ config: { timeout: 1000 } }); // a variation; the cache is shared
api.cache?.forget(); // what a sign-out calls
```

## It takes your instance; it never configures it

Base URL, interceptors, authentication, retries, transformers and
`paramsSerializer` stay on the instance you built. What the client adds is what
Axios has no way of knowing about:

- the **abort signal**, wired in — forgetting it is the mistake that lets a
  superseded request finish anyway;
- **headers read per request**, so a token that changes is the current one, and
  untracked, so a resource never depends on it;
- the **cache**, shared with the rest of the application if you pass one in —
  reads only, keyed by base URL and path, and `force` drops the entry, which is
  how an invalidation reaches through.

Two APIs are two instances and two clients, and one component may read from
both.

MIT licensed. See the [data guide](https://github.com/firsthandjs/firsthand/blob/main/docs/guide/09-data.md#axios).
