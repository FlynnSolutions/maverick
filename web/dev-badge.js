/**
 * The development badge: in the app's window, when the server it shows is not the packed copy,
 * the bar says so and names the checkout, so a person working on Maverick can never mistake
 * their checkout for the app's own copy. A browser tab gets no badge; whoever opened one knows
 * what they pointed it at. Read off the server's own `/api/about`, so the app has nothing to tell
 * the page and an attached server is caught the same as one started with `--source`.
 */
export const mountDevBadge = async () => {
  if (!/Electron/.test(navigator.userAgent)) return;
  const about = await fetch("/api/about").then((r) => r.json()).catch(() => undefined);
  if (!about || about.packed) return;
  const badge = document.createElement("a");
  badge.className = "dev-badge";
  badge.href = "/";
  badge.title = `This window shows a server running from ${about.source}, not the app's own copy. The app menu can reopen it on the app's own server.`;
  badge.textContent = `development · ${about.source.replace(/^\/Users\/[^/]+\//, "~/")}`;
  document.querySelector(".brand")?.after(badge);
};
