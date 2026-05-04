/** One-off / CI helper: Discord command & option descriptions must be ≤100 chars. */
const strings = [
  ["link cmd", "Link your Discord account to a Sleeper username"],
  ["link opt", "Your Sleeper username"],
  ["leagues", "List your Sleeper NFL leagues (this season)"],
  ["drafts", "List your drafts; live ones show pick # and on-the-clock team"],
  [
    "subscribe cmd",
    "In a server: league id + categories. In DM: alerts for all your leagues go to your DMs",
  ],
  [
    "sub league opt",
    "Required in a server (from /leagues). Not used in DM — there, all leagues are included",
  ],
  [
    "sub cat opt",
    "Comma-separated category ids (waivers, transactions, draft_on_the_clock, …). Optional.",
  ],
  ["updates", "Show a snapshot of your Sleeper leagues and drafts (on-demand)"],
  [
    "check-lineup cmd",
    "Check your lineup for issues (IR in starters) and suggest a replacement",
  ],
  [
    "league opt generic",
    "Optional in server (uses channel default); in DM, optional filter to one league",
  ],
  [
    "flex-check",
    "FLEX/Superflex vs dedicated slot by kickoff; suggest a swap if flex plays earlier",
  ],
  [
    "draft-check",
    "Fresh draft status: all drafting in DM; in server defaults to channel league",
  ],
  [
    "draft-status",
    "Same as /draft-check: live drafts, pick #, on-the-clock team, last pick",
  ],
  ["post-summary", "Post your leagues summary to this channel (for the server feed)"],
  ["subscriptions", "List your notification routes"],
  [
    "unsub cmd",
    "Remove routes: in DM (all or one league); in a server, routes for this channel",
  ],
  [
    "unsub league",
    "Only remove routes for this league id; omit to remove all in DM or this channel",
  ],
  [
    "unsub cat",
    "Comma-separated category ids (e.g. transactions); omit = all categories matching above",
  ],
  [
    "route-test",
    "Post a test message here; clears permission-warning flags after a prior error",
  ],
  ["poll-now cmd", "Run one notification poll cycle now (Manage Server only)"],
  [
    "replay opt",
    "Reset poll cursor before running (replays latest week transactions)",
  ],
  ["poll league", "Optional league id for replay reset scope; omit to reset all leagues"],
];

let bad = 0;
for (const [name, v] of strings) {
  const n = [...v].length;
  const flag = n > 100 ? " OVER" : "";
  if (n > 100) bad++;
  console.log(`${n}\t${name}${flag}`);
}
process.exit(bad ? 1 : 0);
