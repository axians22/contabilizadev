import { test } from "node:test";
import assert from "node:assert/strict";
import { consultarCnpj, enderecoEmLinha, ErroConsultaCnpj, lerRespostaCnpj, URL_BRASILAPI_CNPJ, type MotivoErroCnpj } from "./cnpj.ts";
import { buscarExemplo, buscarFalso, EXEMPLOS, respostaGravada } from "./exemplos.ts";

const motivo = (m: MotivoErroCnpj, texto?: RegExp) => (e: unknown) => {
  assert.ok(e instanceof ErroConsultaCnpj, String(e));
  assert.equal(e.motivo, m);
  if (texto) assert.match(e.message, texto);
  return true;
};

test("resposta real gravada (Banco do Brasil): campos lidos como a BrasilAPI manda", async () => {
  const buscar = buscarExemplo("banco-do-brasil");
  const d = await consultarCnpj("00.000.000/0001-91", { buscar });
  assert.deepEqual(buscar.chamadas, [`${URL_BRASILAPI_CNPJ}00000000000191`]);
  assert.equal(d.cnpj, "00000000000191");
  assert.equal(d.razaoSocial, "BANCO DO BRASIL SA");
  assert.equal(d.nomeFantasia, "DIRECAO GERAL");
  assert.equal(d.situacaoCadastral, "ATIVA");
  assert.deepEqual(d.naturezaJuridica, { codigo: "2038", descricao: "Sociedade de Economia Mista" });
  assert.deepEqual(d.cnaePrincipal, { codigo: "6422100", descricao: "Bancos múltiplos, com carteira comercial" });
  assert.deepEqual(d.cnaesSecundarios, [{ codigo: "6499999", descricao: "Outras atividades de serviços financeiros não especificadas anteriormente" }]);
  // Optou e foi excluído no mesmo dia: a Receita marca false e manda as duas datas.
  assert.deepEqual(d.simples, { optante: false, dataOpcao: "2007-07-01", dataExclusao: "2007-07-01" });
  assert.deepEqual(d.mei, { optante: false, dataOpcao: "2009-07-01", dataExclusao: "2009-07-01" });
  assert.equal(d.socios.length, 3);
  assert.deepEqual(d.socios[0], {
    nome: "ALAN CARLOS GUEDES DE OLIVEIRA",
    qualificacao: "Diretor",
    dataEntrada: "2023-05-17",
    faixaEtaria: "Entre 41 a 50 anos",
    documento: "***550179**",
    representante: null,
  });
  assert.equal(d.municipio, "BRASILIA");
  assert.equal(d.uf, "DF");
  assert.equal(d.dataInicioAtividade, "1966-08-01");
});

test("todos os exemplos gravados são lidos sem erro", () => {
  for (const nome of EXEMPLOS) assert.ok(lerRespostaCnpj(respostaGravada(nome)).razaoSocial, nome);
});

test("empresa de TI: CNAEs com 7 dígitos, sócios e opção pelo Simples", async () => {
  const d = await consultarCnpj("12345678000195", { buscar: buscarExemplo("ti-fator-r") });
  assert.equal(d.cnaePrincipal.codigo, "6201501");
  assert.deepEqual(d.cnaesSecundarios.map((c) => c.codigo), ["6202300", "6204000", "6209100"]);
  assert.deepEqual(d.simples, { optante: true, dataOpcao: "2022-03-10", dataExclusao: null });
  assert.equal(d.mei.optante, false);
  assert.deepEqual(d.socios.map((s) => s.qualificacao), ["Sócio-Administrador", "Sócio"]);
});

test("secundário com código 0 (\"sem CNAE\" da BrasilAPI) é descartado; repetidos e o próprio principal também", () => {
  assert.deepEqual(lerRespostaCnpj(respostaGravada("ti-anexo-iii")).cnaesSecundarios, []);
  const r = respostaGravada("ti-fator-r");
  r.cnaes_secundarios = [
    { codigo: 6201501, descricao: "repete o principal" },
    { codigo: 6209100, descricao: "Suporte" },
    { codigo: 6209100, descricao: "Suporte" },
    { codigo: "0", descricao: "" },
    { descricao: "sem código" },
  ];
  assert.deepEqual(lerRespostaCnpj(r).cnaesSecundarios, [{ codigo: "6209100", descricao: "Suporte" }]);
});

test("CNAE com zero à esquerda (a BrasilAPI manda como número) volta com 7 dígitos", () => {
  const r = respostaGravada("ti-fator-r");
  r.cnae_fiscal = 111301;
  assert.equal(lerRespostaCnpj(r).cnaePrincipal.codigo, "0111301");
});

test("CNPJ alfanumérico: vai em maiúsculas e sem pontuação", async () => {
  const buscar = buscarExemplo("alfanumerico");
  const d = await consultarCnpj("12.abc.345/01de-35", { buscar });
  assert.deepEqual(buscar.chamadas, [`${URL_BRASILAPI_CNPJ}12ABC34501DE35`]);
  assert.equal(d.cnpj, "12ABC34501DE35");
});

test("CNPJ com dígito verificador errado nem chega à BrasilAPI", async () => {
  const buscar = buscarFalso();
  for (const c of ["11.222.333/0001-82", "123", "", "12ABC34501DE36", "00000000000000"]) {
    await assert.rejects(consultarCnpj(c, { buscar }), motivo("cnpj-invalido", /dígitos verificadores/), c);
  }
  assert.equal(buscar.chamadas.length, 0);
});

test("404 e 400: CNPJ não encontrado, com mensagem própria para o alfanumérico", async () => {
  await assert.rejects(consultarCnpj("11222333000181", { buscar: buscarFalso({ status: 404, corpo: { message: "CNPJ 11222333000181 não encontrado." } }) }), motivo("nao-encontrado", /não encontrado na Receita/));
  await assert.rejects(consultarCnpj("11222333000181", { buscar: buscarFalso({ status: 400, corpo: {} }) }), motivo("nao-encontrado"));
  await assert.rejects(consultarCnpj("12ABC34501DE35", { buscar: buscarFalso({ status: 404, corpo: {} }) }), motivo("nao-encontrado", /alfanuméricos são novos/));
});

test("429 e 5xx: mensagens de limite e de serviço fora do ar", async () => {
  await assert.rejects(consultarCnpj("11222333000181", { buscar: buscarFalso({ status: 429 }) }), motivo("limite", /Espere um minuto/));
  for (const status of [500, 502, 503, 504]) {
    await assert.rejects(consultarCnpj("11222333000181", { buscar: buscarFalso({ status }) }), motivo("indisponivel", new RegExp(`erro ${status}`)));
  }
  await assert.rejects(consultarCnpj("11222333000181", { buscar: buscarFalso({ status: 302 }) }), motivo("indisponivel", /inesperado \(302\)/));
});

test("tempo esgotado: aborta a requisição e avisa", async () => {
  const inicio = Date.now();
  await assert.rejects(consultarCnpj("11222333000181", { buscar: buscarFalso("pendurar"), tempoLimiteMs: 50 }), motivo("tempo-esgotado", /0.05 segundos/));
  assert.ok(Date.now() - inicio < 2_000);
});

test("falha de rede vira 'indisponível' sem detalhe técnico nem nome do fornecedor", async () => {
  await assert.rejects(consultarCnpj("11222333000181", { buscar: buscarFalso(new Error("getaddrinfo ENOTFOUND brasilapi.com.br")) }), motivo("indisponivel", /^(?!.*(ENOTFOUND|brasilapi)).*Receita Federal/i));
});

test("resposta sem o essencial, que não é JSON ou de outro CNPJ é recusada", async () => {
  const semRazao = respostaGravada("ti-fator-r");
  delete semRazao.razao_social;
  await assert.rejects(consultarCnpj("12345678000195", { buscar: buscarFalso({ status: 200, corpo: semRazao }) }), motivo("resposta-invalida", /razão social/));
  const semCnae = respostaGravada("ti-fator-r");
  semCnae.cnae_fiscal = null;
  await assert.rejects(consultarCnpj("12345678000195", { buscar: buscarFalso({ status: 200, corpo: semCnae }) }), motivo("resposta-invalida", /CNAE principal/));
  await assert.rejects(consultarCnpj("12345678000195", { buscar: buscarFalso({ status: 200, corpo: "<html>" }) }), motivo("resposta-invalida", /não é JSON/));
  await assert.rejects(consultarCnpj("12345678000195", { buscar: buscarFalso({ status: 200, corpo: [] }) }), motivo("resposta-invalida"));
  await assert.rejects(consultarCnpj("98765432000198", { buscar: buscarExemplo("ti-fator-r") }), motivo("resposta-invalida", /no lugar de 98765432000198/));
});

test("campos estranhos viram nulo em vez de quebrar (datas, booleanos e sócios sem nome)", () => {
  const r = respostaGravada("ti-fator-r");
  r.opcao_pelo_simples = null;
  r.data_opcao_pelo_simples = "10/03/2022";
  r.opcao_pelo_mei = "N";
  r.nome_fantasia = "  ";
  r.qsa = [{ nome_socio: "" }, null, { nome_socio: "SÓ NOME" }];
  const d = lerRespostaCnpj(r);
  assert.deepEqual(d.simples, { optante: null, dataOpcao: null, dataExclusao: null });
  assert.equal(d.mei.optante, null);
  assert.equal(d.nomeFantasia, null);
  assert.deepEqual(d.socios, [{ nome: "SÓ NOME", qualificacao: "", dataEntrada: null, faixaEtaria: null, documento: null, representante: null }]);
});

test("manda User-Agent (sem ele a BrasilAPI responde 403 ao fetch do Node)", async () => {
  let cabecalhos: Record<string, string> = {};
  await assert.rejects(
    consultarCnpj("11222333000181", { buscar: async (_url, init) => ((cabecalhos = init.headers), { status: 404, json: async () => ({}) }) }),
  );
  assert.match(cabecalhos["User-Agent"] ?? "", /\S/);
});

test("nenhuma mensagem de erro cita o fornecedor", async () => {
  for (const status of [302, 403, 429, 500, 503]) {
    await assert.rejects(consultarCnpj("11222333000181", { buscar: buscarFalso({ status }) }), (e: Error) => !/brasil ?api/i.test(e.message));
  }
});

test("endereço da sede: tipo + logradouro, número, complemento, bairro e CEP com 8 dígitos", () => {
  const d = lerRespostaCnpj(respostaGravada("ti-fator-r"));
  assert.deepEqual(d.endereco, { logradouro: "RUA DOS EXEMPLOS", numero: "100", complemento: "SALA 1", bairro: "CENTRO", cep: "88010000" });
  assert.equal(enderecoEmLinha(d.endereco, d.municipio, d.uf), "RUA DOS EXEMPLOS, 100, SALA 1 - CENTRO - FLORIANOPOLIS/SC - CEP 88010-000");
  // Logradouro que já começa com o tipo não repete o tipo (resposta real do Banco do Brasil).
  assert.equal(lerRespostaCnpj(respostaGravada("banco-do-brasil")).endereco?.logradouro, "QUADRA SAUN QUADRA 5 BLOCO B TORRE I, II, III");
  const r = respostaGravada("ti-fator-r");
  r.descricao_tipo_de_logradouro = "RUA";
  r.logradouro = "Rua das Flores";
  r.cep = 1310100; // número sem o zero da frente
  r.complemento = "";
  assert.deepEqual(lerRespostaCnpj(r).endereco, { logradouro: "Rua das Flores", numero: "100", complemento: null, bairro: "CENTRO", cep: "01310100" });
});

test("endereço ausente ou vazio: campos null e linha null; CEP lixo é descartado", () => {
  const r = respostaGravada("ti-fator-r");
  for (const c of ["descricao_tipo_de_logradouro", "logradouro", "numero", "complemento", "bairro"]) r[c] = "";
  r.cep = "000";
  const d = lerRespostaCnpj(r);
  assert.deepEqual(d.endereco, { logradouro: null, numero: null, complemento: null, bairro: null, cep: null });
  assert.equal(enderecoEmLinha(d.endereco), null);
  assert.equal(enderecoEmLinha(undefined, "FLORIANOPOLIS", "SC"), "FLORIANOPOLIS/SC");
  r.cep = "123456789";
  assert.equal(lerRespostaCnpj(r).endereco?.cep, null);
});
