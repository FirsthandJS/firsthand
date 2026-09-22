/**
 * How the panel looks.
 *
 * Its own module because it changes for its own reasons — a colour, a width,
 * a state nobody could see — and because ninety lines of CSS in the middle of
 * the code that builds the panel makes both harder to read.
 *
 * `all: initial` at the top is the point of the shadow root: the page's
 * stylesheet cannot reach in, and this cannot reach out. An inspector that
 * changes what it is inspecting is worse than no inspector.
 */

export const STYLE = `:host { all: initial; }
.panel {
  position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
  width: 460px; max-height: 78vh; display: flex; flex-direction: column;
  font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #e6e6e6; background: #1c1c1f; border: 1px solid #3a3a40;
  border-radius: 10px; box-shadow: 0 10px 40px rgb(0 0 0 / 0.45);
}
header { display: flex; align-items: center; gap: 6px; padding: 8px 10px;
  border-bottom: 1px solid #3a3a40; }
header strong { font-weight: 600; letter-spacing: 0.02em; flex: 1; }
button { font: inherit; color: inherit; background: #2a2a30; border: 1px solid #45454d;
  border-radius: 5px; padding: 3px 8px; cursor: pointer; }
button:hover { background: #34343c; }
button[aria-pressed='true'] { background: #3d5afe; border-color: #3d5afe; color: #fff; }
.body { display: flex; flex-direction: column; overflow: hidden; padding: 12px; min-height: 0; }
/* The list scrolls; the detail stays where it can be read. Without this the
   call stack sits below everything and is only reachable by scrolling past
   the whole log — which is exactly when you least want to. */
/* Two independent scroll areas: the list above, the detail below. Each gets
   its own, because a call stack that can only be reached by scrolling past
   forty rows of log is out of reach exactly when it is wanted. */
.scroll { overflow-y: auto; overflow-x: hidden; flex: 1 1 auto; min-height: 60px; }
.pinned { flex: 0 1 auto; min-height: 140px; max-height: 65%; overflow-y: auto;
  overflow-x: hidden; margin-top: 8px; padding-top: 8px;
  border-top: 1px solid #3a3a40; }
.detail-head { display: flex; align-items: center; gap: 8px; }
.detail-head .hint { margin: 0; flex: 1; }
.detail-head button { padding: 0 6px; line-height: 1.4; }
.empty { color: #8a8a94; }
.hint { color: #7c7c88; margin: 14px 0 6px; font-size: 10px; text-transform: uppercase;
  letter-spacing: 0.1em; }
.hint:first-child { margin-top: 0; }
.section + .section { margin-top: 2px; }
.stack { margin: 4px 0 0; }
.stack div { color: #9a9aa6; padding-left: 10px; border-left: 1px solid #3a3a40; }
.stack div:first-child { color: #e6e6e6; }
.filters { display: flex; gap: 6px; align-items: center; margin-bottom: 8px; flex-wrap: wrap; }
.filters .chip { background: #2a2a30; border: 1px solid #45454d; border-radius: 999px;
  padding: 1px 9px; cursor: pointer; color: #9ecbff; }
.filters .chip[aria-pressed='true'] { background: #3d5afe; border-color: #3d5afe; color: #fff; }
.count { color: #7c7c88; }

/* The path, as boxes and arrows rather than as three lines of text. */
.flow { display: flex; flex-direction: column; align-items: stretch; gap: 0; }
.box { border: 1px solid #45454d; border-radius: 7px; padding: 6px 9px; background: #232329;
  display: flex; align-items: baseline; gap: 8px; }
.box .tag { font-size: 10px; text-transform: uppercase; letter-spacing: 0.07em;
  padding: 1px 5px; border-radius: 4px; background: #34343c; color: #b9b9c4; }
.box .label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.box .val { color: #c3e88d; }
.box.signal { border-color: #3d5afe; }
.box.signal .tag { background: #23306b; color: #b6c4ff; }
.box.computed { border-color: #c792ea; }
.box.computed .tag { background: #3a2b47; color: #e6c8ff; }
.box.part { border-color: #ffcb6b; }
.box.part .tag { background: #4a3a1c; color: #ffdfa1; }
.box.trigger { box-shadow: 0 0 0 2px #3d5afe66; }
.arrow { align-self: center; color: #6a6a76; font-size: 14px; line-height: 1; padding: 3px 0; }

/* The component stack, as crumbs. */
.crumbs { display: flex; flex-wrap: wrap; gap: 4px; margin: 0 0 10px; }
.crumb { background: #2a2a30; border: 1px solid #45454d; border-radius: 999px;
  padding: 1px 8px; color: #c792ea; }
.crumb + .crumb::before { content: '›'; color: #8a8a94; margin-right: 6px; margin-left: -4px; }

/* The timeline: one row per update, a bar for how much it woke. */
.track { display: flex; flex-direction: column; gap: 4px; }
.tick { display: grid; grid-template-columns: 52px minmax(0, 1fr) auto auto; gap: 8px;
  align-items: center; padding: 3px 4px; border-radius: 5px; cursor: pointer; }
.tick:hover { background: #26262c; }
.tick[aria-selected='true'] { background: #23306b; }
.tick .when { color: #8a8a94; text-align: right; }
.tick .who { color: #9ecbff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tick .where { color: #7c7c88; white-space: nowrap; }
.tick .bar { height: 8px; border-radius: 4px; background: #3d5afe; min-width: 4px; }
.tick .bar.none { background: #4a4a54; }
.detail .ran { color: #ffdfa1; }
.cause { color: #ffcb6b; margin: 10px 0 0; }
.event { display: grid; grid-template-columns: 84px 1fr; gap: 8px; padding: 2px 0; }
.event .created { color: #c3e88d; }
.event .invalidated { color: #ffcb6b; }
.event .dropped { color: #f07178; }
.event .tags { color: #9ecbff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }`;

/** The element the picker is over, highlighted without touching its styles. */
export const OUTLINE = 'firsthand-devtools-outline';

/** The one rule that has to live in the page, because the outline is on it. */
export const OUTLINE_STYLE = `.${OUTLINE} { outline: 2px solid #3d5afe !important; outline-offset: 1px; }`;
