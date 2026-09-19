/**
 * What `@firsthandjs/query/vite` turns a `.graphql` import into.
 *
 * `@firsthandjs/query/codegen` writes one of these per operation from the schema.
 * This project has no schema to generate from, so the two declarations are
 * written by hand — which is also what they look like when generated, and is
 * why no call site needs a type argument.
 */
declare module '*/user.graphql' {
  const document: import('@firsthandjs/query').GraphQLDocument<
    { user: { id: string; name: string } },
    { id: string }
  >;
  export default document;
}

declare module '*/rename.graphql' {
  const document: import('@firsthandjs/query').GraphQLDocument<
    { renameUser: { id: string; name: string } },
    { id: string; name: string }
  >;
  export default document;
}

declare module '*.graphql' {
  const document: import('@firsthandjs/query').GraphQLDocument;
  export default document;
}
