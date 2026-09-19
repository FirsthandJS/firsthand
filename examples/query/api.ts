/**
 * A pretend server.
 *
 * Latency and state, in memory: the example is about the cache, and a real
 * endpoint would only add a thing to install before you can look at it. Every
 * call is counted, and the count is on screen — which is how you can see that
 * the second visit to a user costs nothing.
 */
export interface User {
  readonly id: number;
  name: string;
  readonly role: string;
}

const USERS: User[] = [
  { id: 1, name: 'Ada Lovelace', role: 'Analyst' },
  { id: 2, name: 'Grace Hopper', role: 'Rear Admiral' },
  { id: 3, name: 'Karen Spärck Jones', role: 'Researcher' },
];

/** Every request this session made, by name. Displayed by the example. */
export const calls: string[] = [];

const LATENCY = 250;

function respond<T>(label: string, value: T, signal: AbortSignal): Promise<T> {
  calls.push(label);
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      resolve(structuredClone(value));
    }, LATENCY);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    });
  });
}

export function listUsers(signal: AbortSignal): Promise<User[]> {
  return respond('users', USERS, signal);
}

export function readUser(id: number, signal: AbortSignal): Promise<User> {
  const found = USERS.find((user) => user.id === id);
  if (found === undefined) {
    return Promise.reject(new Error(`No user ${String(id)}`));
  }
  return respond(`user:${String(id)}`, found, signal);
}

export function renameUser(id: number, name: string, signal: AbortSignal): Promise<User> {
  const found = USERS.find((user) => user.id === id);
  if (found === undefined) {
    return Promise.reject(new Error(`No user ${String(id)}`));
  }
  found.name = name;
  return respond(`rename:${String(id)}`, found, signal);
}
