// A resposta da rota de saúde (GET /api/saude), usada pelo health check do Coolify: 200 {ok:true} quando a aplicação e o
// banco respondem, 503 {ok:false} quando o banco não responde (ou demora mais que o limite). Pública (está em ROTAS_PUBLICAS),
// então não revela nada: nem versão, nem segredo, nem dado, nem o erro do banco (esse vai só para o log). Não chama
// nenhum serviço externo.
export const ENDERECO_DA_SAUDE = "/api/saude";
export const LIMITE_DO_BANCO_MS = 3000;

export async function respostaDaSaude(pingarBanco: () => Promise<unknown>, limiteMs = LIMITE_DO_BANCO_MS): Promise<Response> {
  const semCache = { "cache-control": "no-store" };
  let espera: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      pingarBanco(),
      new Promise((_, recusar) => {
        espera = setTimeout(() => recusar(new Error(`o banco não respondeu em ${limiteMs} ms`)), limiteMs);
      }),
    ]);
    return Response.json({ ok: true }, { status: 200, headers: semCache });
  } catch (erro) {
    console.error("[saude] Banco não respondeu:", (erro as Error).message);
    return Response.json({ ok: false }, { status: 503, headers: semCache });
  } finally {
    clearTimeout(espera);
  }
}
