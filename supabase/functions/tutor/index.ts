// MedRise: Tutor com IA e correção de discursivas (Supabase Edge Function)
const MODEL = "claude-haiku-5-5";
const LIMITE_DIA = 30;
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const auth = req.headers.get("Authorization") ?? "";
    const apikey = req.headers.get("apikey") ?? "";
    const base = Deno.env.get("SUPABASE_URL")!;
    const h = { Authorization: auth, apikey, "Content-Type": "application/json" };
    const u = await fetch(`${base}/auth/v1/user`, { headers: h });
    if (!u.ok) return json({ erro: "Faça login para usar o tutor." }, 401);
    const lim = await fetch(`${base}/rest/v1/rpc/usar_ia_eu`, { method: "POST", headers: h, body: JSON.stringify({ p_lim: LIMITE_DIA }) });
    if (!lim.ok) return json({ erro: `Você usou as ${LIMITE_DIA} perguntas de hoje. Amanhã libera de novo.` }, 429);

    const b = await req.json();
    const q = b.q ?? {};
    const ctx = `Banca: ${q.banca ?? ""} ${q.ano ?? ""}\nÁrea/tema: ${q.area ?? ""} / ${q.tema ?? ""}\nEnunciado: ${q.e ?? ""}\n` +
      (q.a?.length ? `Alternativas:\n${q.a.map((t: string, i: number) => "ABCDE"[i] + ") " + t).join("\n")}\nGabarito oficial: ${q.gab ?? ""}\n` : `Gabarito oficial (resposta esperada): ${q.resp ?? ""}\n`) +
      `Comentário MedRise: ${q.com ?? ""}`;
    let system: string, messages: { role: string; content: string }[], maxTokens = 700;
    if (b.modo === "corrigir") {
      system = "Você é um corretor de provas de residência médica no Brasil. Compare a resposta do aluno com o gabarito oficial e dê uma nota de 0 a 10. Aceite sinônimos e respostas equivalentes. Responda SOMENTE um JSON: {\"nota\": número, \"feedback\": \"2 a 4 frases em português, diretas, dizendo o que acertou, o que faltou e como responder na prova\"}.";
      messages = [{ role: "user", content: `${ctx}\n\nResposta do aluno: ${String(b.resposta ?? "").slice(0, 1500)}` }];
      maxTokens = 400;
    } else if (b.modo === "pista") {
      const nivel = Math.max(1, Math.min(3, Number(b.nivel) || 1));
      const guia = [
        "Aponte só o dado do enunciado em que o aluno deve prestar mais atenção.",
        "Dê o raciocínio ou conceito que leva ao caminho certo, sem dizer qual alternativa é a correta.",
        "Ajude a eliminar uma ou duas alternativas ERRADAS, dizendo a letra delas e por quê. Nunca diga qual é a correta.",
      ][nivel - 1];
      system = "Você é o Tutor MedRise. O aluno ainda NÃO respondeu a questão abaixo e pediu uma pista. Regras obrigatórias: no máximo 2 frases, português informal; NUNCA revele a alternativa correta, nunca cite a letra correta nem o texto dela, nem diga o diagnóstico/conduta final se isso entregar a resposta; sem dica de memorização. " +
        `Pista nível ${nivel} de 3: ${guia}\n\nQUESTÃO:\n` + ctx;
      const hist = Array.isArray(b.hist) ? b.hist.slice(-2) : [];
      messages = hist.map((m: { role: string; content: string }) => ({ role: "user", content: String(m.content).slice(0, 2000) }));
      if (!messages.length) messages = [{ role: "user", content: "Me dá uma pista." }];
      maxTokens = 200;
    } else {
      system = "Você é o Tutor MedRise, professor de preparatório para residência médica no Brasil. Explique a questão abaixo de forma clara e curta (até 180 palavras), em português informal, como um bom professor de cursinho. Use o gabarito oficial como verdade; se o aluno discordar, explique por que a banca considerou aquela resposta. Não invente doses ou dados que não tenha certeza. Termine com uma dica de memorização quando fizer sentido.\n\nQUESTÃO:\n" + ctx;
      const hist = Array.isArray(b.hist) ? b.hist.slice(-8) : [];
      messages = hist.map((m: { role: string; content: string }) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content).slice(0, 2000) }));
      if (!messages.length) messages = [{ role: "user", content: "Não entendi essa questão, me explica." }];
    }
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages }),
    });
    const d = await r.json();
    if (!r.ok) return json({ erro: "O tutor está indisponível agora. Tente de novo em instantes." }, 502);
    const texto = (d.content ?? []).filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("\n").trim();
    if (b.modo === "corrigir") {
      const m = texto.match(/\{[\s\S]*\}/);
      try { const o = JSON.parse(m ? m[0] : texto); return json({ nota: Math.max(0, Math.min(10, Math.round(+o.nota))), feedback: String(o.feedback ?? "") }); }
      catch { return json({ nota: null, feedback: texto }); }
    }
    return json({ texto });
  } catch (_e) {
    return json({ erro: "Erro inesperado no tutor." }, 500);
  }
});
