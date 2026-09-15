// The Maverick jet, top-down, nose to the right, drawn in a 48x20 box: pointed nose, canopy,
// leading-edge extensions into swept wings, twin tails, horizontal stabilisers, twin nozzles.
// One silhouette for the flyby, the runway marker, and the favicon (which copies the paths).

const NS = "http://www.w3.org/2000/svg";

export const JET_BOX = "0 0 48 20";
export const JET_BODY =
  "M48 10 L41 8.6 L36 7.8 L30 7.2 L28 6.8 L13 0.8 L10 1.6 L15 7.2 L9 7.4 L3 4.6 L1 5.2 L4 8.2 L1 8.6 L1 9.6 L2.5 10 L1 10.4 L1 11.4 L4 11.8 L1 14.8 L3 15.4 L9 12.6 L15 12.8 L10 18.4 L13 19.2 L28 13.2 L30 12.8 L36 12.2 L41 11.4 Z";
/** Darker details laid over the body: canopy, intakes, and the twin tail fins seen edge-on. */
export const JET_DETAIL = [
  "M41.5 10 L38 8.9 L33.5 9.2 L32 10 L33.5 10.8 L38 11.1 Z",
  "M29 8.1 L24 7.4 L24 8.6 Z",
  "M29 11.9 L24 12.6 L24 11.4 Z",
  "M11 8.3 L4.5 7.5 L5 8.4 Z",
  "M11 11.7 L4.5 12.5 L5 11.6 Z",
];

/** An SVG element carrying the jet; `cls` goes on the svg, the paths take .body and .detail. */
export const jetSvg = (cls = "jet-glyph") => {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", JET_BOX);
  svg.setAttribute("class", cls);
  svg.append(...jetPaths());
  return svg;
};

/** The body and detail paths alone, for callers that build their own group. */
export const jetPaths = () => {
  const body = document.createElementNS(NS, "path");
  body.setAttribute("d", JET_BODY);
  body.setAttribute("class", "body");
  const details = JET_DETAIL.map((d) => {
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", d);
    p.setAttribute("class", "detail");
    return p;
  });
  return [body, ...details];
};
