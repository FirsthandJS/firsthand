/**
 * The `.graphql` loader, in a real build.
 *
 * These two documents are imported as files. By the time the browser sees
 * them they are parsed objects with their tags read and their `@tag` /
 * `@invalidates` directives removed — no parser shipped, and nothing the
 * server has not declared in its schema.
 *
 * The transport here asserts that last part rather than trusting it: if a
 * directive ever survived into the document, the story would say so on screen.
 */
import type { Meta, StoryObj } from '@storybook/html-vite';
import { component, provide } from '@firsthandjs/dom';
import {
  GraphQLContext,
  QueryClientContext,
  createQueryClient,
  useGraphQL,
  useGraphQLMutation,
  type GraphQLTransport,
} from '@firsthandjs/query';
import UserQuery from './user.graphql';
import RenameUser from './rename.graphql';
import { firsthand } from '../firsthand';

interface User {
  readonly id: string;
  name: string;
}

const stored: User = { id: '1', name: 'Ada Lovelace' };

/** Stands in for a server, and checks what it was sent. */
const transport: GraphQLTransport = (document, variables) => {
  if (/@(tag|invalidates)/.test(document.source)) {
    return Promise.reject(new Error(`a cache directive reached the server:\n${document.source}`));
  }
  if (document.kind === 'mutation') {
    stored.name = String((variables as { name: unknown }).name);
    return Promise.resolve({ renameUser: { ...stored } });
  }
  return Promise.resolve({ user: { ...stored } });
};

const Profile = component(() => {
  // No type arguments: each document carries its own result and variables.
  const user = useGraphQL(UserQuery, () => ({ id: '1' }));
  const rename = useGraphQLMutation(RenameUser);

  return (
    <section>
      <h2 data-testid="graphql-name">
        {user.status.value === 'error'
          ? `error: ${(user.error.value as Error).message}`
          : (user.data.value?.user.name ?? 'Loading…')}
      </h2>
      <p data-testid="graphql-operation">
        {UserQuery.operation} · tags: {UserQuery.tags.map((template) => template.name).join(', ')}
      </p>
      <pre data-testid="graphql-source">{UserQuery.source.trim()}</pre>
      <button
        data-testid="graphql-rename"
        onClick={() => void rename.mutate({ id: '1', name: 'Grace Hopper' })}
      >
        Rename
      </button>
    </section>
  );
});

export const FromAFile: StoryObj = {
  name: 'Tags from a .graphql file',
  render: () =>
    firsthand(() => {
      const App = component(() => {
        provide(QueryClientContext, createQueryClient({ staleTime: 10_000 }));
        provide(GraphQLContext, transport);
        return <Profile />;
      });
      return <App />;
    }),
};

const meta: Meta = { title: 'GraphQL' };
export default meta;
