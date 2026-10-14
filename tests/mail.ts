// Local mail capture (Mailpit): newest 6-digit code sent to an address.
export async function mailCode(email: string): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const list = await (await fetch(`http://127.0.0.1:54324/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}&limit=1`)).json();
    const id = list.messages?.[0]?.ID;
    if (id) {
      const msg = await (await fetch(`http://127.0.0.1:54324/api/v1/message/${id}`)).json();
      const code = String(msg.Text ?? msg.HTML).match(/\b(\d{6})\b/)?.[1];
      if (code) return code;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no code mailed to ${email}`);
}

// Number of captured messages addressed to an address (DEC-009: refusal means none at all).
export async function mailCount(email: string): Promise<number> {
  const list = await (await fetch(`http://127.0.0.1:54324/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}&limit=50`)).json();
  return Number(list.messages_count ?? list.messages?.length ?? 0);
}
