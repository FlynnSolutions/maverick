/**
 * Where a link out of Maverick goes: one tab in a real browser, replaced on every click. A
 * walkthrough is stepped through by clicking its dev links one after another, so they land in
 * the same tab, which can sit in a window of its own beside Maverick. In Maverick's own window a
 * dev app has none of the browser's sign-in, and failed to load.
 *
 * macOS only, through AppleScript, for a Chromium browser (`config.browser`: Google Chrome
 * unless MAVERICK_BROWSER says another). The tab is the one this process opened last, found
 * again by its id; once it is closed, the next link opens a new window. The URL travels as an
 * argument, never inside the script.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * The script for one browser. Its name has to be a literal for its dictionary to load, so it is
 * quoted here and nowhere else. Each window is asked once, inside the browser, whether it holds
 * the tab, rather than every tab being read out one by one: with hundreds of tabs open that is
 * the difference between instant and a visible lag.
 */
export const tabScript = (browser) => `on run argv
  set theUrl to item 1 of argv
  set wanted to item 2 of argv
  tell application ${JSON.stringify(browser)}
    if wanted is not "" then
      set n to wanted as integer
      repeat with w in windows
        if (count of (tabs of w whose id is n)) > 0 then
          set i to 0
          repeat with t in tabs of w
            set i to i + 1
            if id of t is n then
              set URL of t to theUrl
              set active tab index of w to i
              set index of w to 1
              activate
              return wanted
            end if
          end repeat
        end if
      end repeat
    end if
    set w to make new window
    set URL of active tab of w to theUrl
    activate
    return id of active tab of w as text
  end tell
end run`;

/**
 * A link opener holding its one tab. Clicks are taken one at a time, so a quick second click
 * waits for the first to report its tab rather than opening a window of its own. `open(url)`
 * throws when the browser cannot be driven; the caller falls back.
 */
export const browserTab = (browser) => {
  let tab = "";
  let last = Promise.resolve();
  const go = async (url) => {
    const { stdout } = await run("osascript", ["-e", tabScript(browser), url, tab], { timeout: 10_000 });
    tab = stdout.trim();
  };
  return {
    browser,
    open: (url) => (last = last.catch(() => undefined).then(() => go(url))),
  };
};
