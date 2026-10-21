// Roda uma vez quando o servidor sobe: configuração de login inválida derruba a subida (e não vira um erro só
// na hora de entrar). Os avisos (login desligado, sem Client ID, sem admin) aparecem a cada subida.
// A TOKEN_CHAVE (cifra do termo de autorização e do token de cada empresa) e a PLATAFORMA_CHAVE (cifra do certificado e
// das chaves da plataforma) também são conferidas aqui: ausentes, inválidas ou iguais derrubam a subida, com a instrução
// de como gerar.
// Sem PLATAFORMA_CNPJ, sem a razão social da plataforma ou sem o certificado e as chaves do contrato (guardados pelo ADMIN
// em /admin/plataforma ou, como alternativa, no ambiente) o site sobe, com aviso no log, e a assinatura do termo fica
// indisponível (as telas dizem isso ao cliente sem detalhes técnicos).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { lerConfigAutenticacao, avisosDaConfig } = await import("@/lib/autenticacao/config");
  const config = lerConfigAutenticacao();
  for (const aviso of avisosDaConfig(config)) console.warn(`[login] ${aviso}`);
  const { lerChavePlataforma, lerChaveToken } = await import("@/lib/termo/cifra");
  lerChaveToken(process.env.TOKEN_CHAVE);
  const chavePlataforma = lerChavePlataforma(process.env.PLATAFORMA_CHAVE, process.env.TOKEN_CHAVE);
  const { lerRazaoPlataforma } = await import("@/lib/serpro/config");
  const { montarPlataforma } = await import("@/lib/plataforma/montagem");
  const { lerGuardado, NADA_GUARDADO } = await import("@/lib/plataforma/segredos");
  let guardado = NADA_GUARDADO;
  try {
    const { banco } = await import("@/banco");
    guardado = await lerGuardado(banco(), chavePlataforma);
  } catch (erro) {
    console.warn(`[plataforma] Não foi possível ler o certificado e as chaves guardados no banco: ${(erro as Error).message}`);
  }
  // O certificado da plataforma é resolvido uma vez só, para o Serpro e para o eSocial.
  const { serpro, esocial } = montarPlataforma(process.env, guardado);
  if (!serpro.pronto) console.warn(`[serpro] ${serpro.motivo}`);
  // eSocial (Parte 7): a plataforma transmite com o próprio certificado; sem ele, o passo do eSocial fica no modo guiado.
  if (!esocial.pronto) console.warn(`[esocial] ${esocial.motivo}`);
  if (process.env.PLATAFORMA_CNPJ?.trim() && !lerRazaoPlataforma()) {
    console.warn("[serpro] Falta PLATAFORMA_RAZAO_SOCIAL: o termo de autorização usa a razão social guardada da empresa com o PLATAFORMA_CNPJ; sem ela, a assinatura fica indisponível.");
  }
}
