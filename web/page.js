// What the pages off the board share beyond the bar: the way a page that cannot open says so.

/** A page that cannot open says why in the page, with the one way on, instead of a red line in the bar. */
export const cannotOpen = (page, title, why, href, label) => {
  const section = document.createElement("section");
  section.className = "page-missing";
  const h1 = document.createElement("h1");
  h1.textContent = title;
  const p = document.createElement("p");
  p.textContent = why;
  const a = document.createElement("a");
  a.className = "button-link primary";
  a.href = href;
  a.textContent = label;
  section.append(h1, p, a);
  page.replaceChildren(section);
};
