/** Discord interaction reply `content` max length. */
export const DISCORD_REPLY_CONTENT_MAX = 2000;

/**
 * Concatenate a header and list lines; if the result would exceed Discord's limit,
 * stop early and append how many items were omitted.
 */
export function truncateDiscordReply(headerLine: string, itemLines: string[]): string {
  let text = headerLine.trimEnd();
  for (let i = 0; i < itemLines.length; i++) {
    const line = itemLines[i]!;
    const next = text ? `${text}\n${line}` : line;
    if (next.length <= DISCORD_REPLY_CONTENT_MAX) {
      text = next;
      continue;
    }
    if (!text) {
      return `${line.slice(0, Math.max(0, DISCORD_REPLY_CONTENT_MAX - 40))}\n_…(line truncated)._`.slice(
        0,
        DISCORD_REPLY_CONTENT_MAX,
      );
    }
    const omitted = itemLines.length - i;
    const tail = `\n_…and ${omitted} more not shown (Discord ${DISCORD_REPLY_CONTENT_MAX} character limit)._`;
    const withTail = `${text}${tail}`;
    return withTail.length <= DISCORD_REPLY_CONTENT_MAX
      ? withTail
      : text.slice(0, DISCORD_REPLY_CONTENT_MAX);
  }
  return text.slice(0, DISCORD_REPLY_CONTENT_MAX);
}
