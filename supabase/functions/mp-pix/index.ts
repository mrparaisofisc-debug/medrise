// MedRise: PIX avulso (sem renovação). Mensal = 30 dias, Semestral = 180 dias.
// acao "criar": gera o PIX e devolve o QR code. acao "status": diz se já foi pago.
// Segredo: MP_ACCESS_TOKEN. Deploy com "Verify JWT" desligado.
const PLANOS: Record<string, { valor: number; dias: number; nome: string }> = {
  mensal: { valor: 159, dias: 30, nome: "MedRise Plano Mensal (30 dias)" },
  semestral: { valor: 699, dias: 180, nome: "MedRise Plano Semestral (6 meses)" },
};
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const b = await req.json();
    const mp = Deno.env.get("MP_ACCESS_TOKEN");
    if (!mp) return json({ erro: "Pagamento ainda não configurado." }, 503);
    const base = Deno.env.get("SUPABASE_URL")!;

    if (b.acao === "status") {
      const id = String(b.id ?? "").replace(/\D/g, "");
      if (!id) return json({ erro: "PIX inválido." }, 400);
      const p = await fetch(`https://api.mercadopago.com/v1/payments/${id}`, { headers: { Authorization: `Bearer ${mp}` } }).then((r) => r.json());
      if (p.status === "approved") await gravar(p, base);
      return json({ status: p.status ?? "desconhecido" });
    }

    const plano = String(b.plano ?? "");
    const email = String(b.email ?? "").trim().toLowerCase();
    if (!PLANOS[plano]) return json({ erro: "Plano inválido." }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ erro: "Digite um e-mail válido." }, 400);
    const P = PLANOS[plano];
    const r = await fetch("https://api.mercadopago.com/v1/payments", {
      method: "POST",
      headers: { Authorization: `Bearer ${mp}`, "Content-Type": "application/json", "X-Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({
        transaction_amount: P.valor,
        description: P.nome,
        payment_method_id: "pix",
        payer: { email },
        external_reference: `pix|${plano}|${email}`,
        notification_url: `${base}/functions/v1/mp-webhook`,
        date_of_expiration: new Date(Date.now() + 30 * 60e3).toISOString().replace("Z", "-00:00"),
      }),
    });
    const d = await r.json().catch(() => ({}));
    const td = d?.point_of_interaction?.transaction_data;
    if (!r.ok || !td?.qr_code) {
      console.log("mp-pix erro", r.status, JSON.stringify(d).slice(0, 800));
      return json({ erro: "Não foi possível gerar o PIX agora. Tente de novo em instantes." }, 400);
    }
    return json({ id: d.id, qr: td.qr_code, qr64: td.qr_code_base64, valor: P.valor });
  } catch (e) {
    console.log("mp-pix exceção", String(e));
    return json({ erro: "Erro inesperado. Tente de novo." }, 500);
  }
});

// libera o acesso: grava uma linha "pix" com validade de 30 ou 180 dias a partir da aprovação
// se o aluno ainda tem dias de um PIX anterior, os dias novos somam no fim
async function gravar(p: Record<string, any>, base: string) {
  const [tag, plano, email] = String(p.external_reference ?? "").split("|");
  if (tag !== "pix" || !PLANOS[plano] || !email) return;
  const sr = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const H = { apikey: sr, Authorization: `Bearer ${sr}` };
  const ja = await fetch(`${base}/rest/v1/subscriptions?mp_id=eq.pix-${p.id}&select=mp_id`, { headers: H }).then((r) => r.json()).catch(() => []);
  if (Array.isArray(ja) && ja.length) return; // já liberado
  const ant = await fetch(`${base}/rest/v1/subscriptions?email=eq.${encodeURIComponent(email)}&status=eq.pix&select=next_payment_date&order=next_payment_date.desc&limit=1`, { headers: H }).then((r) => r.json()).catch(() => []);
  const aprov = new Date(p.date_approved ?? Date.now()).getTime();
  const resto = Array.isArray(ant) && ant[0]?.next_payment_date ? new Date(ant[0].next_payment_date).getTime() : 0;
  const fim = new Date(Math.max(aprov, resto) + PLANOS[plano].dias * 864e5);
  await fetch(`${base}/rest/v1/subscriptions?on_conflict=mp_id`, {
    method: "POST",
    headers: { apikey: sr, Authorization: `Bearer ${sr}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ mp_id: `pix-${p.id}`, email, plano, status: "pix", next_payment_date: fim.toISOString(), updated_at: new Date().toISOString() }),
  });
}
