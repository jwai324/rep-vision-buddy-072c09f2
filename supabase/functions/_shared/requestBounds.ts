// Server-side size limits on what a coach turn may send to the model. The
// credit gate holds a fixed reserve before the call; with no bound on the
// request itself, one crafted call could put an arbitrary amount of input in
// front of the model against that reserve. The client caps a typed message at
// 500 characters; its context runs from ~75k characters for a fresh account
// to ~240k for one with 200 custom exercises and 60 templates, so the context
// ceiling has little headroom by design. Checked before the gate, so a
// rejected request never takes a concurrency slot.
//
// Two caps that are easy to get wrong: the coach's own replies come back in
// the client's history window (the client sends the last ten messages
// verbatim), so an assistant turn is measured against the output budget, not
// the typed-message cap — the first version of this check applied the 4,000
// character user cap to assistant turns and 413'd every send after one long
// reply. And an assistant turn's tool calls carry their arguments as a JSON
// string outside `content`, which is where a full-template edit lives.
export const MAX_MESSAGES = 40;
export const MAX_USER_MESSAGE_CHARS = 4_000;
// MAX_TOKENS in ai-coach is 8,000; ~5 chars per token leaves room for the
// tool-call JSON that rides along with a reply.
export const MAX_ASSISTANT_MESSAGE_CHARS = 48_000;
// A get_workout_history result over a year of daily sessions measures ~43k.
export const MAX_TOOL_RESULT_CHARS = 64_000;
// One update_set_weight_reps call per set: a "set every set to last time"
// request over four exercises is a dozen results.
export const MAX_ACTION_RESULTS = 40;
export const MAX_CONTEXT_CHARS = 256_000;
// Everything together. The per-part ceilings above sum well past the model's
// window; this is what actually bounds the spend of one turn (~100k tokens).
export const MAX_REQUEST_CHARS = 400_000;

const size = (v: unknown): number => (typeof v === "string" ? v : JSON.stringify(v ?? "")).length;

/** The reason a request is too large to send to the model, or null. */
export function requestTooLarge(messages: unknown, context: unknown, actionResults: unknown): string | null {
  const list = Array.isArray(messages) ? messages : [];
  if (list.length > MAX_MESSAGES) return "Too many messages in this request.";
  let total = 0;
  for (const m of list) {
    if (!m || typeof m !== "object") continue;
    const msg = m as { role?: string; content?: unknown; tool_calls?: unknown };
    let chars = size(msg.content);
    if (Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        const args = (tc as { function?: { arguments?: unknown } })?.function?.arguments;
        if (args !== undefined) chars += size(args);
      }
    }
    const cap = msg.role === "tool"
      ? MAX_TOOL_RESULT_CHARS
      : msg.role === "assistant" ? MAX_ASSISTANT_MESSAGE_CHARS : MAX_USER_MESSAGE_CHARS;
    if (chars > cap) return "A message in this request is too long.";
    total += chars;
  }
  const results = Array.isArray(actionResults) ? actionResults : [];
  if (results.length > MAX_ACTION_RESULTS) return "Too many tool results in this request.";
  for (const r of results) {
    const chars = size(r);
    if (chars > MAX_TOOL_RESULT_CHARS) return "A tool result in this request is too long.";
    total += chars;
  }
  if (context != null) {
    const chars = size(context);
    if (chars > MAX_CONTEXT_CHARS) return "The app context sent with this message is too large.";
    total += chars;
  }
  if (total > MAX_REQUEST_CHARS) return "This request is too large to send to the coach.";
  return null;
}
