"use server";

import { refresh } from "next/cache";
import { banco } from "@/banco";
import { exigirAreaDoAdmin } from "@/lib/autenticacao/servidor";
import { chaveDaPlataforma } from "@/lib/plataforma/servidor";
import { ErroDaPlataforma, guardarCertificado, guardarChaves, TAMANHO_MAXIMO_PFX, type DependenciasSegredos } from "@/lib/plataforma/segredos";
import { lerCnpjPlataforma } from "@/lib/serpro/config";

// Resposta das ações: só a mensagem. Nunca o arquivo, a chave, a senha ou o secret.
export type Resultado = { erro: string } | { ok: string } | undefined;

function dependencias(): DependenciasSegredos {
  const { chave, motivo } = chaveDaPlataforma();
  return { banco: banco(), chave, motivoDaChave: motivo, plataforma: lerCnpjPlataforma() };
}

// As regras (só ADMIN, o que é um certificado válido) estão no serviço e valem mesmo que alguém monte o pedido à mão.
async function executar(acao: () => Promise<string>): Promise<Resultado> {
  let ok: string;
  try {
    ok = await acao();
  } catch (erro) {
    if (erro instanceof ErroDaPlataforma) return { erro: erro.message };
    throw erro;
  }
  refresh();
  return { ok };
}

export async function enviarCertificadoAcao(_anterior: Resultado, dados: FormData): Promise<Resultado> {
  const { usuario } = await exigirAreaDoAdmin("/admin/plataforma");
  const arquivo = dados.get("arquivo");
  const senha = String(dados.get("senha") ?? "");
  return executar(async () => {
    if (!(arquivo instanceof File) || arquivo.size === 0) throw new ErroDaPlataforma("Escolha o arquivo do certificado (.pfx ou .p12).", 400);
    if (arquivo.size > TAMANHO_MAXIMO_PFX) throw new ErroDaPlataforma("Este arquivo é grande demais para um certificado (.pfx ou .p12).", 400);
    const r = await guardarCertificado(dependencias(), usuario, new Uint8Array(await arquivo.arrayBuffer()), senha);
    return `Certificado guardado: ${r?.titular ?? ""}, válido até ${r?.validoAte.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) ?? ""}.`;
  });
}

export async function guardarChavesAcao(_anterior: Resultado, dados: FormData): Promise<Resultado> {
  const { usuario } = await exigirAreaDoAdmin("/admin/plataforma");
  return executar(async () => {
    await guardarChaves(dependencias(), usuario, String(dados.get("consumerKey") ?? ""), String(dados.get("consumerSecret") ?? ""));
    return "Chaves guardadas.";
  });
}
