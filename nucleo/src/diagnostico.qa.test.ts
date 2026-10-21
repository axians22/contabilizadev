// QA (Parte 3): casos de borda do cliente da BrasilAPI, do CNPJ alfanumérico e do diagnóstico.
import { test } from "node:test";
import assert from "node:assert/strict";
import { consultarCnpj, ErroConsultaCnpj, lerRespostaCnpj, type DadosCnpj } from "./brasilapi/cnpj.ts";
import { buscarFalso, respostaGravada, type Exemplo } from "./brasilapi/exemplos.ts";
import { regraDoCnae, REGRAS_CNAE } from "./cnae.ts";
import { diagnosticar } from "./diagnostico.ts";
import { cnpjValido } from "./formato.ts";

const HOJE = "2026-10-16";
const dados = (nome: Exemplo, mudar: (d: DadosCnpj) => void = () => {}) => {
  const d = lerRespostaCnpj(respostaGravada(nome));
  mudar(d);
  return d;
};

test("QA cnpj: alfanumérico em minúsculas e com pontuação vale; letra no DV, tamanho errado e repetidos não", () => {
  assert.equal(cnpjValido("12.abc.345/01de-35"), true);
  assert.equal(cnpjValido("12ABC34501DE3A"), false);
  assert.equal(cnpjValido("12ABC34501DE3"), false);
  assert.equal(cnpjValido("12ABC34501DE355"), false);
  assert.equal(cnpjValido("00000000000000"), false);
  assert.equal(cnpjValido("AAAAAAAAAAAAAA"), false);
  assert.equal(cnpjValido(""), false);
  assert.equal(cnpjValido("00000000000191"), true);
  assert.equal(cnpjValido("00000000000192"), false);
});

test("QA consulta: alfanumérico em minúsculas é enviado em maiúsculas, sem pontuação", async () => {
  const corpo = respostaGravada("alfanumerico");
  const buscar = buscarFalso({ status: 200, corpo });
  const cnpj = String(corpo.cnpj);
  const formatado = `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`.toLowerCase();
  const d = await consultarCnpj(formatado, { buscar });
  assert.equal(d.cnpj, cnpj);
  assert.ok(buscar.chamadas[0].endsWith(`/${cnpj}`));
});

test("QA consulta: 200 com o corpo de erro da BrasilAPI vira resposta-invalida, não quebra", async () => {
  const buscar = buscarFalso({ status: 200, corpo: { message: "CNPJ não encontrado", type: "not_found", name: "NotFoundError" } });
  await assert.rejects(consultarCnpj("00000000000191", { buscar }), (e: unknown) => e instanceof ErroConsultaCnpj && e.motivo === "resposta-invalida");
});

test("QA consulta: 503 e 429 dão mensagens diferentes e claras", async () => {
  await assert.rejects(consultarCnpj("00000000000191", { buscar: buscarFalso({ status: 503 }) }), (e: unknown) => e instanceof ErroConsultaCnpj && e.motivo === "indisponivel" && /503/.test(e.message));
  await assert.rejects(consultarCnpj("00000000000191", { buscar: buscarFalso({ status: 429 }) }), (e: unknown) => e instanceof ErroConsultaCnpj && e.motivo === "limite");
});

test("QA leitura: situação em minúsculas, natureza com hífen, CNAE em texto pontuado e secundários nulos", () => {
  const r = respostaGravada("ti-fator-r");
  r.descricao_situacao_cadastral = " ativa ";
  r.codigo_natureza_juridica = "206-2";
  r.cnae_fiscal = "6201-5/01";
  r.cnaes_secundarios = null;
  r.qsa = null;
  const d = lerRespostaCnpj(r);
  assert.equal(d.situacaoCadastral, "ATIVA");
  assert.equal(d.naturezaJuridica.codigo, "2062");
  assert.equal(d.cnaePrincipal.codigo, "6201501");
  assert.deepEqual(d.cnaesSecundarios, []);
  assert.deepEqual(d.socios, []);
  const diag = diagnosticar(d, HOJE);
  assert.equal(diag.atendido, true);
  assert.equal(diag.anexo, "III ou V");
});

test("QA tabela: as 8 subclasses de TI do MVP estão com a tributação certa", () => {
  const esperado: Record<string, string> = {
    "6201501": "fator-r",
    "6201502": "fator-r",
    "6202300": "fator-r",
    "6203100": "fator-r",
    "6204000": "fator-r",
    "6209100": "anexo-fixo",
    "6311900": "anexo-fixo",
    "6319400": "anexo-fixo",
  };
  for (const [c, t] of Object.entries(esperado)) assert.equal(regraDoCnae(c).tributacao, t, c);
  assert.equal(REGRAS_CNAE.length, 8);
  assert.equal(regraDoCnae("7490-1/04").tributacao, "nao-atendido");
});

test("QA diagnóstico: só Anexo III fixo (6209 + 6311) não depende do Fator R e não tem explicação", () => {
  const d = diagnosticar(
    dados("ti-fator-r", (x) => {
      x.cnaePrincipal = { codigo: "6209100", descricao: "" };
      x.cnaesSecundarios = [{ codigo: "6311900", descricao: "" }];
    }),
    HOJE,
  );
  assert.equal(d.atendido, true);
  assert.equal(d.anexo, "III");
  assert.equal(d.dependeFatorR, false);
  assert.equal(d.dependeFatorR, false);
  assert.equal(d.atividades[0].descricao.length > 0, true, "descrição da tabela quando a Receita não manda");
});

test("QA diagnóstico: MEI que também não é ATIVA e tem CNAE fora: todos os motivos aparecem", () => {
  const d = diagnosticar(
    dados("mei", (x) => {
      x.situacaoCadastral = "INAPTA";
      x.cnaesSecundarios = [{ codigo: "4751201", descricao: "Comércio varejista de informática" }];
    }),
    HOJE,
  );
  assert.equal(d.atendido, false);
  assert.ok(d.impedimentos.map((n) => n.detalhe).some((m) => /INAPTA/.test(m)));
  assert.ok(d.impedimentos.map((n) => n.detalhe).some((m) => /MEI/.test(m)));
  assert.ok(d.impedimentos.map((n) => n.detalhe).some((m) => /4751-2\/01/.test(m)));
});

test("QA diagnóstico: exclusão do Simples em 31/12 vista em 31/12 já vale; vista em 30/12 é aviso", () => {
  const base = dados("ti-fator-r", (x) => (x.simples = { optante: true, dataOpcao: "2022-01-01", dataExclusao: "2026-12-31" }));
  const vespera = diagnosticar(base, "2026-12-30");
  assert.equal(vespera.atendido, true);
  assert.equal(vespera.observacoes.map((n) => n.detalhe).length > 0, true);
  const dia = diagnosticar(base, "2026-12-31");
  assert.equal(dia.atendido, false);
});

// Empresa fora do Simples (não optante, excluída) ou MEI não é tributada por anexo do Simples: o diagnóstico não
// pode dizer "Anexo III ou V — depende do Fator R" nem explicar o Fator R como se valesse para ela.
test("QA diagnóstico: fora do Simples ou MEI não recebe anexo nem explicação do Fator R", () => {
  const naoOptante = diagnosticar(dados("ti-fator-r", (x) => (x.simples = { optante: false, dataOpcao: null, dataExclusao: null })), HOJE);
  assert.equal(naoOptante.atendido, false);
  assert.equal(naoOptante.anexo, null, "não optante do Simples não tem anexo");
  assert.equal(naoOptante.dependeFatorR, false);
  const mei = diagnosticar(dados("mei"), HOJE);
  assert.equal(mei.atendido, false);
  assert.equal(mei.anexo, null, "MEI paga o DAS-MEI fixo, não tem anexo");
  assert.equal(mei.dependeFatorR, false);
});
