# ADR-0026: A function is a reactive scope, one level up

**Status:** accepted · 2026-09-21 · extends
[ADR-0009](0009-compiler-templates-and-thunks.md), [ADR-0019](0019-strict-reactivity.md)

## Problem

A setup runs once, so a view chosen in it is chosen for ever:

```tsx
component(() => {
  if (token.value === null) {
    return <Navigate to="/sign-in" />; // never runs again
  }
  return <Page />;
});
```

0.7.0 answered this with a **build error** ([ADR-0019](0019-strict-reactivity.md),
`checkDecidedOnce`), which is the right thing to do about a mistake that
produces no exception and a wrong screen twenty minutes later. But a rule whose
whole job is to forbid the natural spelling is a hole in the model, not a
feature of it. Every other framework lets you write an `if` above your markup;
this one had nowhere to put one.

Three things made that hole visible at once:

- **A route guard is the common case**, and the workaround — pushing the choice
  into a child position so it becomes a part — reads worse than the mistake.
- **The check cannot see everything.** It looks for `.value`, so a
  `deepSignal` read goes through unreported, and props were deliberately
  excluded after a recursive component branching on `props.depth` was wrongly
  refused. It catches an important class, not the class.
- **Fine-grained is not always the fast shape.** Twenty sites derived from one
  entity are twenty effects, twenty subscriptions and twenty reads of the same
  signal. That is the shape of every detail view in every application.

## Constraints

- **One model, not two.** A second way to render is a second thing to learn, a
  second set of rules and a second set of surprises. Whatever is added has to
  be the _existing_ rule, applied somewhere new.
- **No hidden machinery.** No registry, no ambient state, no hook ordering, no
  statement the compiler quietly makes reactive, no memoisation behind anyone's
  back. What the source says is what runs.
- **No cost to code that does not use it.** An application that never writes
  the new form must compile and perform exactly as before.
- **A branch that is left is gone.** Not hidden, not retained off-screen: the
  same disposal a part has always done, because that is what the control flow
  says.
- **Measured, not asserted.** The performance claim decides the design, so it
  has to come from the real compiler, not from a hand-written stand-in.

## Options

1. **Keep refusing it.** The error message is good and the workaround is one
   line. Rejected because the workaround is worse to read than the mistake, and
   because the check provably cannot cover the whole class.
2. **Make the setup itself re-runnable**, as React does. Rejected outright: it
   is the one thing this framework exists not to do, and every rule about
   identity, ordering and persistent state follows from the setup running once.
3. **A render function returned from the setup**, which is an ordinary function
   and therefore an ordinary reactive scope.

## Chosen design

Option 3, with one rule doing all the work:

> Every function you write is a reactive scope: it runs again when something it
> read changes. JSX beneath it makes the smallest scopes it can — as long as
> they need nothing from the run that made them.

```tsx
component(() => {
  const draft = signal(''); // setup: once

  return () => {
    // run: again, when what it read changes
    if (!draft.value) {
      return <Empty />;
    }
    return <Editor draft={draft} />;
  };
});
```

**The classification is forced, not chosen.** For every expression in the
markup the compiler asks whether it names a binding the run made. If it does
not, it becomes a part with its own scope, exactly as today. If it does, it
_cannot_ become a part — that value belongs to one call of the run, and a part
holding it would hold a value from a run that is over — so the run writes it,
guarded by what it last wrote. There is no policy here to get wrong: one of the
two is impossible in each case, and the possible one also happens to be the
faster one.

**A site is made once and written afterwards.** The store is an array declared
in the setup, which runs once per instance, so it needs no registry and no
ambient lookup. Each site takes a numbered place in it, fixed at compile time:
a site inside an `if` keeps its place whether or not the branch was taken,
which is why there is no ordering rule of any kind.

**What a site makes belongs to the instance.** Parts, listeners and child
components created when a site is built are opened under an owner taken from
the store, not under the run — a run's scope is cleared before it runs again,
and anything left there would be disposed by the very next run. This was found
by measurement, not by reasoning: the first implementation put them in the run
and the second run tore them down.

**A branch the run leaves is disposed.** Every `return` passes through `ran`,
which disposes the sites this run did not reach. Cleanups fire, parts stop,
nodes go. Coming back builds it again.

**Children keep their instance.** A component in a run is made once; props fed
from run locals are held in cells the run writes, so a prop that did not change
reaches nobody. Props that are not fed from the run stay ordinary live reads
and cost nothing extra.

**Anything a run hands to something built once goes through a cell.** This is
the general form of the rule above, and it is written out because it has been
got wrong three times by being read as a rule about props. A run local is a
binding belonging to one call of the run; anything built once that captures it
goes on reading that call's value for ever, silently, because the page still
renders. So the same treatment is owed to a child a run gives a component, and
to the data a run gives a keyed list, as to a prop — a cell the run writes,
holding the _reading_ rather than the result, so that what it reads is
attributed to the part that displays it rather than to the run. The fourth
instance of this should be caught in review rather than in an issue.

**Handlers are what they look like.** A closure over a run local is a new
function on every run, and it replaces the previous one on the node — so it is
never stale, and always exactly as old as the DOM beside it. `on()` had to
learn to replace rather than add for non-delegated types, keyed by the options
as well as the type so that `onClick:native` and `onClick:once` remain two
listeners.

**What cannot be written is built again.** A spread, a `ref` or a keyed list
that depends on the run turns retention off for that site, which falls back to
today's behaviour: slower, never wrong.

**Two refusals**, both the existing rule said once more:

- Nothing persistent is made in a run (`signal`, `computed`, `effect`,
  `useResource`, …). Persistent things are made in the setup.
- Repeated markup carries a key. Where markup stands answers for one of it;
  only a key answers for many.

**And a plain function that returns markup is a view** — a reactive scope with
no setup, recognised inside a module by the compiler and across one by a mark
it emits. Writing it as a tag is what gives it a place and a scope; calling it
is a function call and behaves like one. This is what `component()` is _for_
after this ADR: it means the view needs a setup.

## Performance

`npm run bench:runs`, recorded in `benchmarks/results/render-functions.json`.
1000 components of 20 sites derived from one signal, both compiled by the real
compiler and both verified to render 20 000 nodes before timing:

|                       | mount    | update    | heap    |
| --------------------- | -------- | --------- | ------- |
| a site per expression | 31.40 ms | 11.435 ms | 14.0 MB |
| one render function   | 20.70 ms | 8.355 ms  | 8.8 MB  |

1.52x, 1.36x and 1.59x. Most of it is arithmetic on effects: twenty
subscriptions and twenty reads of one signal become one of each.

The shape matters and the ADR says so: twenty sites with twenty _independent_
sources is the opposite case, and there the fine-grained form wins, because a
run would look at all twenty to write the one that moved. The classification
means a component that mixes the two gets both behaviours, so the question
rarely has to be answered by the developer at all.

Three measurements changed the design rather than confirming it:

- A guard that compares against the DOM (`text.data !== next`) is **slower than
  no guard at all** — reading a text node back materialises a string. The
  remembered value is kept instead, and the same guard was added to the
  existing part path, where it is worth about 2x on its own.
- Straight-line writes with local variables beat an array-and-loop by only
  about 3 %, so the emitted form uses helpers and stays readable.
- A hand-written stand-in promised 2.1x on the update path; the real emission
  delivers 1.36x. The difference is the `site(store, index)` lookup per write.
  The stand-in is in the repository's history, and the honest number is the one
  above.

## Memory

Less, not more: 13.8 MB to 8.8 MB in the measured shape, because an effect with
its dependency links costs more than a slot in an array. A site store is one
array per instance plus one small record per site and per write.

The published runtime grew about 0.35 kB gzip, and the bundle budget went from
6 kB to 7 kB to admit it. The new functions are separate exports, so an
application that never returns a render function does not pay for them; the
figure that moved is the everything-imported one.

## DX

What a developer does about this: nothing, unless they want an `if`. Shape 2 —
a setup returning markup — is shape 3 with an empty body, and is unchanged in
behaviour and in cost.

What they gain is that the reactive graph is drawn with function boundaries
they can see. `const person = profile.value` in a statement says _this view
treats the profile as one thing_; the same read in the markup says _this site
follows it on its own_. One normal line of JavaScript, two granularities, both
visible.

What they must know is the short list the guide ends on: statements are the
run's dependencies and markup expressions are not; persistent things go in the
setup; repeated markup takes a key; a handler passed to a child is a new
function every run. Development says the last one out loud rather than leaving
it to be found, and says so too when a run keeps running and keeps writing
nothing:

```
<OrderTable> ran 20 times and wrote nothing.
```

That is the shape of every diagnostic this ADR adds: bookkeeping, said out
loud, with nothing optimised behind anyone's back.

## Rejected alternatives

- **Re-running the setup** (option 2). Every rule in this framework about
  identity and persistent state depends on it running once.
- **Hoisting derivations automatically.** The compiler could memoise
  `const sorted = expensiveSort(rows.value)` and remove the one sharp edge of
  the model. It would also mean code that the source says runs does not run,
  which is the kind of hidden cleverness this project refuses. `computed` is
  the tool, it already exists, and the developer places it where they can see
  it.
- **A runtime slot registry** so that view functions keep their DOM across
  calls. That is React's hook dispatcher wearing a different hat — ambient
  state, order-sensitive, invisible. A view function rebuilds instead, which is
  what a function call looks like.
- **Making the whole run write every site**, ignoring the classification. That
  is the literal reading of the rule and it measured 2.6x slower on a
  forty-site component, because it writes everything whatever changed.
- **Keeping an abandoned branch alive** so that returning to it is free. Cheap,
  and it makes a hidden `<Editor/>` keep its state for ever. The control flow
  says the branch is gone.
