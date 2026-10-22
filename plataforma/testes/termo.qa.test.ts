// QA (Parte 4, ciclo 1 do termo): casos que os testes do engenheiro não cobrem.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { certificadoIcpDeTeste, confiancaDeTeste, type OpcoesCertificadoIcp } from "@contabilizadev/nucleo/certificado-teste";
import type { Certificado } from "@contabilizadev/nucleo/http";
import { clienteFalso } from "@contabilizadev/nucleo/serpro/cliente-falso";
import type { Resposta } from "@contabilizadev/nucleo/serpro/cliente";
import { abrirCertificado, assinarTermo, montarTermo, vigenciaPara } from "@contabilizadev/nucleo/serpro/termo-autorizacao";
import { termosAutorizacao } from "@/banco/esquema";
import { entrarComGoogle } from "@/lib/autenticacao/servico";
import { exigirAcessoEmpresa, type AcessoEmpresa } from "@/lib/empresas/acesso";
import { criarEmpresa } from "@/lib/empresas/servico";
import { liberada } from "@/lib/termo/situacao";
import { contextoSerpro, parametrosDoTermo, registrarTermo, situacaoTermo, type DependenciasTermo, type ParametrosTermo } from "@/lib/termo/termo";
import { prepararBancoDeTeste, type BancoDeTeste } from "./banco-de-teste";
import { deps as depsLogin, perfil } from "./apoio";
import { dadosDeSocio } from "./apoio-empresa";

let t: BancoDeTeste;
before(async () => (t = await prepararBancoDeTeste()));
beforeEach(() => t.limpar());
after(() => t.fechar());

const DIA = 24 * 60 * 60 * 1000;
const AGORA = new Date();
const depois = (ms: number) => new Date(AGORA.getTime() + ms);
const CHAVE = randomBytes(32);
const PLATAFORMA = { numero: "11444777000161", nome: "PLATAFORMA DE TESTE LTDA" };
const EMPRESA = "12345678000195";
const PERFIS = {
  admin: perfil("admin@plataforma.com", "sub-admin"),
  intruso: perfil("intruso@x.com", "sub-intruso"),
  ana: perfil("ana@a.com", "sub-ana"),
};
const tokenRecebido = (token: string, expira: string): Resposta => ({
  status: 200,
  dados: { autenticar_procurador_token: token, data_hora_expiracao: expira },
  mensagens: [{ codigo: "200", texto: "Sucesso na execução." }],
});
const meiaNoiteDeAmanha = (agora: Date) => `${new Date(agora.getTime() + DIA).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" })}T23:59:59`;

const dependencias = (cliente: DependenciasTermo["cliente"], agora = AGORA): DependenciasTermo => ({
  banco: t.banco,
  chave: CHAVE,
  cliente,
  contratante: PLATAFORMA,
  adminEmails: ["admin@plataforma.com"],
  confianca: confiancaDeTeste(),
  agora: () => agora,
});
const entrar = async (quem: keyof typeof PERFIS) =>
  (await entrarComGoogle(depsLogin(t.banco, PERFIS, { adminEmails: ["admin@plataforma.com"] }), quem)).usuario;

function assinarNoNavegador(certificado: Certificado, p: ParametrosTermo): string {
  const aberto = abrirCertificado(new Uint8Array(certificado.pfx), certificado.senha);
  const termo = montarTermo({
    destinatario: p.contratante,
    assinadoPor: { numero: aberto.titular.numero, nome: p.empresa.razaoSocial },
    dataAssinatura: p.dataAssinatura,
    vigencia: vigenciaPara(p.vigenciaMaxima, aberto),
  });
  return assinarTermo(termo, aberto);
}
const eCnpj = (extra: Partial<OpcoesCertificadoIcp> = {}) => certificadoIcpDeTeste({ tipo: "PJ", numero: EMPRESA, nome: "EMPRESA QA LTDA", ...extra });

async function empresaDe(quem: keyof typeof PERFIS, cnpj: string, razaoSocial: string): Promise<AcessoEmpresa> {
  const usuario = await entrar(quem);
  await dadosDeSocio(t.banco, usuario); // "Seus dados": o termo confere o CPF do responsável pelo e-CNPJ
  const empresa = await criarEmpresa(t.banco, usuario, { cnpj, razaoSocial });
  return exigirAcessoEmpresa(t.banco, usuario, empresa.id);
}

describe("QA: empresa da própria plataforma (automático sem termo)", () => {
  // O automático sem termo vale só porque a empresa É o contratante. Mas quem cadastra o CNPJ não prova nada: qualquer
  // usuário comum que cadastrar o PLATAFORMA_CNPJ antes do administrador ganharia o automático (e, nas Partes 5+, as
  // declarações, guias, caixa postal e situação fiscal da plataforma) sem assinar nada.
  it("um usuário comum que cadastrou o CNPJ da plataforma NÃO recebe o automático sem termo", async () => {
    const intruso = await empresaDe("intruso", PLATAFORMA.numero, PLATAFORMA.nome);
    assert.equal(intruso.papel, "DONO");
    const s = await situacaoTermo(dependencias(clienteFalso()), intruso);
    assert.equal(liberada(s), false, `situação obtida: ${JSON.stringify(s)}`);
    await assert.rejects(contextoSerpro(dependencias(clienteFalso()), intruso));
  });
});

describe("QA: termo recusado e assinado de novo com o mesmo termo no mesmo dia", () => {
  it("o mesmo XML reenviado depois da recusa limpa a marca e religa (uma linha só, sem duplicar)", async () => {
    const acesso = await empresaDe("ana", EMPRESA, "EMPRESA QA LTDA");
    const cert = eCnpj();
    const d = dependencias(clienteFalso(tokenRecebido("t1", meiaNoiteDeAmanha(AGORA))));
    const xml = assinarNoNavegador(cert, await parametrosDoTermo(d, acesso));
    await registrarTermo(d, acesso, xml);
    // Marca a recusa (como a renovação faria) e expira o token.
    await t.banco.update(termosAutorizacao).set({ recusadoEm: AGORA, recusaMotivo: "termo", tokenCifrado: null, tokenExpiraEm: null }).where(eq(termosAutorizacao.empresaId, acesso.empresaId));
    assert.equal((await situacaoTermo(d, acesso)).estado, "recusada");
    const reenvio = clienteFalso(tokenRecebido("t2", meiaNoiteDeAmanha(AGORA)));
    const r = await registrarTermo(dependencias(reenvio), acesso, xml);
    assert.equal(r.enviado, true);
    assert.equal(r.situacao.estado, "vigente");
    const linhas = await t.banco.select().from(termosAutorizacao).where(eq(termosAutorizacao.empresaId, acesso.empresaId));
    assert.equal(linhas.length, 1);
    assert.equal(linhas[0].recusadoEm, null);
    assert.equal((await contextoSerpro(dependencias(clienteFalso(), depois(60_000)), acesso)).tokenProcurador, "t2");
  });

  it("token que expira exatamente agora não é usado: renova", async () => {
    const acesso = await empresaDe("ana", EMPRESA, "EMPRESA QA LTDA");
    await registrarTermo(dependencias(clienteFalso(tokenRecebido("t1", meiaNoiteDeAmanha(AGORA)))), acesso, assinarNoNavegador(eCnpj(), await parametrosDoTermo(dependencias(clienteFalso()), acesso)));
    const [linha] = await t.banco.select().from(termosAutorizacao).where(eq(termosAutorizacao.empresaId, acesso.empresaId));
    const instante = linha.tokenExpiraEm!;
    const novo = clienteFalso(tokenRecebido("t-novo", meiaNoiteDeAmanha(instante)));
    assert.equal((await contextoSerpro(dependencias(novo, instante), acesso)).tokenProcurador, "t-novo");
    assert.equal(novo.chamadas.length, 1);
  });
});
