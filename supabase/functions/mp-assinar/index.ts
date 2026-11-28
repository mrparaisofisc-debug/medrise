// MedRise: cria a assinatura no Mercado Pago a partir do cartão digitado no site (Card Payment Brick).
// Segredo necessário: MP_ACCESS_TOKEN (Edge Functions > Secrets). Deploy com "Verify JWT" desligado.
const PLANOS: Record<string, string> = {
  mensal: "d2012d47f8094c95adeb650c25d548ad",
  semestral: "14bad69bced24ab9af1c8db97c6ab31d",
};
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

function erroAmigavel(d: { message?: string; cause?: { description?: string }[] }): string {
  const m = `${d?.message ?? ""} ${(d?.cause ?? []).map((c) => c.description ?? "").join(" ")}`.toLowerCase();
  if (/insufficient|saldo|fund/.test(m)) return "Cartão sem limite suficiente. Tente outro cartão.";
  if (/security_code|cvv|cvc/.test(m)) return "Código de segurança inválido. Confira o CVV.";
  if (/expir|vencid/.test(m)) return "Cartão vencido. Confira a validade ou use outro cartão.";
  if (/rejected|recusad|declin|card.*valid|cc_val/.test(m)) return "O cartão foi recusado. Confira os dados ou tente outro cartão.";
  if (/email|payer/.test(m)) return "Confira o e-mail digitado.";
  return "Não foi possível concluir o pagamento. Confira os dados do cartão e tente de novo.";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ erro: "Método inválido." }, 405);
  try {
    const b = await req.json();
    const plano = String(b.plano ?? "");
    const token = String(b.token ?? "");
    const email = String(b.email ?? "").trim().toLowerCase();
    if (!PLANOS[plano]) return json({ erro: "Plano inválido." }, 400);
    if (!token) return json({ erro: "Dados do cartão incompletos." }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ erro: "Digite um e-mail válido." }, 400);

    const mpToken = Deno.env.get("MP_ACCESS_TOKEN");
    if (!mpToken) return json({ erro: "Pagamento ainda não configurado." }, 503);

    const r = await fetch("https://api.mercadopago.com/preapproval", {
      method: "POST",
      headers: { Authorization: `Bearer ${mpToken}`, "Content-Type": "application/json", "X-Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({
        preapproval_plan_id: PLANOS[plano],
        card_token_id: token,
        payer_email: email,
        external_reference: email,
        status: "authorized",
      }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.id) {
      console.log("mp-assinar erro", r.status, JSON.stringify(d).slice(0, 800));
      return json({ erro: erroAmigavel(d) }, 400);
    }

    const base = Deno.env.get("SUPABASE_URL")!;
    const sr = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    await fetch(`${base}/rest/v1/subscriptions?on_conflict=mp_id`, {
      method: "POST",
      headers: { apikey: sr, Authorization: `Bearer ${sr}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ mp_id: d.id, email, plano, status: d.status, next_payment_date: d.next_payment_date ?? null, updated_at: new Date().toISOString() }),
    });
    return json({ ok: true, status: d.status });
  } catch (e) {
    console.log("mp-assinar exceção", String(e));
    return json({ erro: "Erro inesperado. Tente de novo em instantes." }, 500);
  }
});
