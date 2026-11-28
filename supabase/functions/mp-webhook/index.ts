// MedRise: recebe os avisos do Mercado Pago (assinatura criada, renovada, pausada, cancelada)
// e atualiza a tabela subscriptions. Sempre confere o status direto na API do Mercado Pago,
// então um aviso falso não libera nada. Deploy com "Verify JWT" desligado.
const PIX_DIAS: Record<string, number> = { mensal: 30, semestral: 180 };
const PLANO_POR_ID: Record<string, string> = {
  d2012d47f8094c95adeb650c25d548ad: "mensal",
  "14bad69bced24ab9af1c8db97c6ab31d": "semestral",
};

Deno.serve(async (req) => {
  const ok = () => new Response("ok", { status: 200 });
  try {
    const url = new URL(req.url);
    let body: Record<string, unknown> = {};
    if (req.method === "POST") body = await req.json().catch(() => ({}));
    const tipo = String(body.type ?? body.topic ?? url.searchParams.get("type") ?? url.searchParams.get("topic") ?? "");
    const id = String((body.data as { id?: string })?.id ?? url.searchParams.get("data.id") ?? url.searchParams.get("id") ?? "");
    if (!id) return ok();

    const mp = Deno.env.get("MP_ACCESS_TOKEN")!;
    const H = { Authorization: `Bearer ${mp}` };
    const base = Deno.env.get("SUPABASE_URL")!;
    const sr = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const SH = { apikey: sr, Authorization: `Bearer ${sr}`, "Content-Type": "application/json" };

    // PIX avulso aprovado: libera 30 ou 180 dias (somando com dias que ainda restam)
    if (tipo === "payment" || tipo.startsWith("payment.")) {
      const p = await fetch(`https://api.mercadopago.com/v1/payments/${id}`, { headers: H }).then((r) => r.json()).catch(() => ({}));
      const [tag, plano, email] = String(p.external_reference ?? "").split("|");
      if (p.status !== "approved" || tag !== "pix" || !PIX_DIAS[plano] || !email) return ok();
      const ja = await fetch(`${base}/rest/v1/subscriptions?mp_id=eq.pix-${p.id}&select=mp_id`, { headers: SH }).then((r) => r.json()).catch(() => []);
      if (Array.isArray(ja) && ja.length) return ok();
      const ant = await fetch(`${base}/rest/v1/subscriptions?email=eq.${encodeURIComponent(email)}&status=eq.pix&select=next_payment_date&order=next_payment_date.desc&limit=1`, { headers: SH }).then((r) => r.json()).catch(() => []);
      const aprov = new Date(p.date_approved ?? Date.now()).getTime();
      const resto = Array.isArray(ant) && ant[0]?.next_payment_date ? new Date(ant[0].next_payment_date).getTime() : 0;
      const fim = new Date(Math.max(aprov, resto) + PIX_DIAS[plano] * 864e5);
      await fetch(`${base}/rest/v1/subscriptions?on_conflict=mp_id`, {
        method: "POST", headers: { ...SH, Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify({ mp_id: `pix-${p.id}`, email, plano, status: "pix", next_payment_date: fim.toISOString(), updated_at: new Date().toISOString() }),
      });
      return ok();
    }

    let preId = "";
    if (tipo.includes("authorized_payment")) {
      const p = await fetch(`https://api.mercadopago.com/authorized_payments/${id}`, { headers: H }).then((r) => r.json()).catch(() => ({}));
      preId = p.preapproval_id ?? "";
    } else if (tipo.includes("preapproval")) {
      preId = id;
    }
    if (!preId) return ok();

    const s = await fetch(`https://api.mercadopago.com/preapproval/${preId}`, { headers: H }).then((r) => r.json()).catch(() => ({}));
    if (!s.id) return ok();
    const email = String(s.external_reference || s.payer_email || "").toLowerCase();
    if (!email) return ok();

    await fetch(`${base}/rest/v1/subscriptions?on_conflict=mp_id`, {
      method: "POST",
      headers: { ...SH, Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({
        mp_id: s.id,
        email,
        plano: PLANO_POR_ID[s.preapproval_plan_id] ?? null,
        status: s.status,
        next_payment_date: s.next_payment_date ?? null,
        updated_at: new Date().toISOString(),
      }),
    });
    return ok();
  } catch (e) {
    console.log("mp-webhook exceção", String(e));
    return ok();
  }
});
