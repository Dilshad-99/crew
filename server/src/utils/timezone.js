// IANA timezone → UTC offset in minutes with zero date libraries: Intl's shortOffset formats to "GMT+5:30"-style strings that parse cleanly. Returns null for unknown zones so callers can score defensively instead of crashing.
export function utcOffsetMinutes(timeZone) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" }).formatToParts(new Date());
    const tzPart = parts.find((p) => p.type === "timeZoneName");
    const match = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(tzPart?.value || "");
    if (!match) return null;
    const sign = match[1] === "-" ? -1 : 1;
    return sign * (Number(match[2]) * 60 + Number(match[3] || 0));
  } catch {
    return null;
  }
}
