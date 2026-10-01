/** Framework-generated prompt labels use English; user text stays byte-for-byte unchanged. */
export function appendUserSupplement(source: string, supplement: string): string {
  return source + '\n\nAdditional requirements:\n' + supplement;
}
