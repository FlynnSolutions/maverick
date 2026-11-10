// The way to every live mission, drawn the same on the workspace, the board and the calendar: the
// app reopens on whichever view was last on, so a mission in the air has to be one press away
// from each of them, not only from the workspace's racks.

import { lamp } from "./lamp.js";
import { isEnded, missionWord } from "./mission/state.js";

/** The lamps that want the pilot: a reticle, not an engine. */
export const WANTS_YOU = /^(waiting|blocked)$/;
// The word picks the lamp, except that a mission in review is done with its flying and not with
// you: it waits to be walked and closed, so it wears the reticle, not the finished lamp.
const WORD_LAMP = { "waiting for you": "blocked", error: "idle", done: "done", working: "busy" };
export const lampOf = (m) => (m.status === "review" ? "waiting" : WORD_LAMP[m.word] ?? "busy");

export const missionHref = (projectId, m) => `/mission.html?project=${encodeURIComponent(projectId)}&mission=${encodeURIComponent(m.id)}`;

/** One link per live mission, its lamp and its word, then whatever verbs the view adds after them. */
export const missionLinks = (el, projectId, missions, ...verbs) =>
  el("nav", { class: "cc-missions", "aria-label": "Missions" }, el("span", {}, "Missions"),
    ...missions.filter((m) => !isEnded(m.status)).map((m) => {
      const wants = lampOf(m);
      return el("a", { class: `cc-mission${WANTS_YOU.test(wants) ? " wants" : ""}`, href: missionHref(projectId, m) }, lamp(wants), m.name, el("i", {}, missionWord(m)));
    }),
    ...verbs);
