# @firsthandjs/data-axios

Axios requests as loaders for [`@firsthandjs/data`](https://www.npmjs.com/package/@firsthandjs/data).

```
npm install @firsthandjs/data-axios
```

0.11 kB gzip. It has **no dependency on Axios** and no peer dependency either —
the one method it uses is declared structurally, so it has no opinion about
which version you run, and nothing to follow when that version changes.

```tsx
import axios from 'axios';
import { axiosLoader } from '@firsthandjs/data-axios';
import { tag, useResource } from '@firsthandjs/data';

const accounts = axiosLoader(axios.create({ baseURL: 'https://accounts.example.com' }));

function Profile(props: { id: string }) {
  const profile = useResource(({ tags, ...rest }) => {
    tags(tag('profile', { id: props.id }));
    return accounts<Profile>({ url: `/profiles/${props.id}` })(rest);
  });

  return <h1>{profile.data.value?.name ?? '…'}</h1>;
}
```

`axiosLoader(instance)` returns a function that takes an ordinary Axios request
config — `url`, `method`, `data`, `headers`, `params`, anything — and returns a
loader. The abort `signal` is wired in for you, because Axios takes the same
`signal` the platform does and forgetting it is the mistake that lets a
superseded request finish anyway.

## It takes your client; it never configures it

Your base URL, interceptors, authentication, retries, transformers and
`paramsSerializer` stay on the instance you built. That is the whole design:
a helper that owned the configuration would take control of the thing it is
meant to be helping with.

```ts
const api = axios.create({ baseURL: '/api' });
api.interceptors.request.use((config) => {
  config.headers.authorization = `Bearer ${session.token.value}`;
  return config;
});

export const load = axiosLoader(api);
```

Two APIs are two instances and two loaders, and one component may read from
both.

## Actions

Nothing special — an action's loader is the same function:

```tsx
const save = useAction(async (draft: Draft, { signal, invalidates }) => {
  const saved = await accounts<Profile>({
    url: '/profiles',
    method: 'POST',
    data: draft,
  })({ signal });
  invalidates(tag('profile', { id: saved.id }));
  return saved;
});
```

Axios does not have a cache, so `force` has nothing to reach past and this
package ignores it. If you put a cache in an interceptor, read `force` from the
load context yourself and pass it through as a header or a config flag.

MIT licensed. See the [data guide](https://github.com/firsthandjs/firsthand/blob/main/docs/guide/09-data.md).
