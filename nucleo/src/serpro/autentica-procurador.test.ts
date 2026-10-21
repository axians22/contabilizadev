import { test } from "node:test";
import assert from "node:assert/strict";
import { classificarRecusa, enviarTermo, ErroAutenticaProcurador, lerCache, lerDataHoraBrasilia, PEDIDO_AUTENTICA_PROCURADOR } from "./autentica-procurador.ts";
import { cnpj } from "./cliente.ts";
import { clienteFalso } from "./cliente-falso.ts";

const EMPRESA = cnpj("11222333000181");
const XML = '<?xml version="1.0" encoding="UTF-8"?><termoDeAutorizacao>…</termoDeAutorizacao>';

// Resposta do ENVIOXMLASSINADO81 como na documentação oficial (dados já lidos pelo cliente do núcleo).
const OK = {
  status: 200,
  dados: { autenticar_procurador_token: "b06feea3-1ca8-49f4-bdb4-211ab006cb92", data_hora_expiracao: "2026-10-20T00:00:01" },
  mensagens: [{ codigo: "200", texto: "Sucesso na execução." }],
};

test("envia pelo AUTENTICAPROCURADOR/ENVIOXMLASSINADO81 com o XML em base64; a empresa é contribuinte e autora; lê token e expiração (Brasília)", async () => {
  const cliente = clienteFalso(OK);
  const r = await enviarTermo(cliente, XML, EMPRESA, "Enviar o termo");
  assert.deepEqual(r, { token: "b06feea3-1ca8-49f4-bdb4-211ab006cb92", expiraEm: new Date("2026-10-20T03:00:01Z"), reaproveitado: false });
  const [chamada] = cliente.chamadas;
  assert.equal(chamada.acao, "Apoiar");
  assert.deepEqual({ ...chamada.pedido, dados: undefined }, { ...PEDIDO_AUTENTICA_PROCURADOR, dados: undefined });
  assert.deepEqual(PEDIDO_AUTENTICA_PROCURADOR, { idSistema: "AUTENTICAPROCURADOR", idServico: "ENVIOXMLASSINADO81", versaoSistema: "1.0" });
  assert.equal(Buffer.from((chamada.pedido.dados as { xml: string }).xml, "base64").toString("utf8"), XML);
  assert.deepEqual(chamada.opcoes, { contribuinte: EMPRESA, autorPedidoDados: EMPRESA });
  assert.equal(chamada.finalidade, "Enviar o termo");
});

test("304 (termo em cache): o token vem no etag e a expiração no expires; sem eles, erro", async () => {
  const cliente = clienteFalso({
    status: 304,
    dados: undefined,
    mensagens: [],
    cabecalhos: { "cache-control": "termo_autorizacao", etag: '"autenticar_procurador_token:ab87df0b-6d08-3d78-13d2-d474b90b05f3"', expires: "Sat, 15 Oct 2022 00:00:01 GMT" },
  });
  const r = await enviarTermo(cliente, XML, EMPRESA, "Renovar");
  assert.deepEqual(r, { token: "ab87df0b-6d08-3d78-13d2-d474b90b05f3", expiraEm: new Date("2022-10-15T00:00:01Z"), reaproveitado: true });
  const erro = await enviarTermo(clienteFalso({ status: 304, dados: undefined, mensagens: [] }), XML, EMPRESA, "A").catch((e) => e);
  assert.ok(erro instanceof ErroAutenticaProcurador);
  assert.equal(erro.motivo, "desconhecido");
});

test("recusas viram ErroAutenticaProcurador com o motivo pelo código oficial (a tela escolhe a mensagem própria)", async () => {
  const casos: [string, number, string][] = [
    ["[AcessoNegado-AUTENTICAPROCURADOR-010]", 403, "certificado-vencido"],
    ["[AcessoNegado-AUTENTICAPROCURADOR-037]", 403, "certificado-revogado"],
    ["[AcessoNegado-AUTENTICAPROCURADOR-011]", 403, "certificado"],
    ["[AcessoNegado-AUTENTICAPROCURADOR-040]", 403, "certificado"],
    ["[AcessoNegado-AUTENTICAPROCURADOR-041]", 403, "certificado"],
    ["[AcessoNegado-AUTENTICAPROCURADOR-012]", 403, "configuracao"],
    ["[EntradaIncorreta-AUTENTICAPROCURADOR-017]", 400, "vigencia"],
    ["[EntradaIncorreta-AUTENTICAPROCURADOR-018]", 400, "vigencia"],
    ["[AcessoNegado-AUTENTICAPROCURADOR-013]", 403, "termo"],
    ["[EntradaIncorreta-AUTENTICAPROCURADOR-033]", 400, "termo"],
    ["[Erro-AUTENTICAPROCURADOR-003]", 500, "indisponivel"],
    ["[Erro-AUTENTICAPROCURADOR-099]", 500, "desconhecido"],
  ];
  for (const [codigo, status, motivo] of casos) {
    const erro = await enviarTermo(clienteFalso({ status, dados: undefined, mensagens: [{ codigo, texto: "texto da API" }] }), XML, EMPRESA, "A").catch((e) => e);
    assert.ok(erro instanceof ErroAutenticaProcurador, codigo);
    assert.equal(erro.motivo, motivo, codigo);
    assert.equal(erro.status, status);
    assert.equal(erro.codigo, /(\d{3})\]$/.exec(codigo)![1]);
    assert.match(erro.message, /texto da API/); // o detalhe técnico vai para o log
  }
  // O código também é achado no texto (algumas respostas trazem só o número no campo codigo).
  assert.deepEqual(classificarRecusa(403, [{ codigo: "403", texto: "[AcessoNegado-AUTENTICAPROCURADOR-021] sem ICP" }]), { motivo: "certificado", codigo: "021" });
  assert.deepEqual(classificarRecusa(503, []), { motivo: "indisponivel", codigo: null });
  assert.deepEqual(classificarRecusa(429, []), { motivo: "indisponivel", codigo: null });
  assert.deepEqual(classificarRecusa(401, []), { motivo: "configuracao", codigo: null });
  assert.deepEqual(classificarRecusa(400, [{ codigo: "X", texto: "y" }]), { motivo: "desconhecido", codigo: null });
});

test("200 sem a data de expiração, falha de rede e limite do contrato", async () => {
  const semData = await enviarTermo(clienteFalso({ status: 200, dados: { autenticar_procurador_token: "t" }, mensagens: [] }), XML, EMPRESA, "A").catch((e) => e);
  assert.equal(semData.motivo, "desconhecido");
  const rede = await enviarTermo(clienteFalso(new Error("rede caiu")), XML, EMPRESA, "A").catch((e) => e);
  assert.ok(rede instanceof ErroAutenticaProcurador);
  assert.equal(rede.motivo, "indisponivel");
  assert.match(rede.message, /rede caiu/);
  const limite = await enviarTermo(clienteFalso(new Error("Limite de 40 chamadas no período de cobrança atingido. Nada foi enviado.")), XML, EMPRESA, "A").catch((e) => e);
  assert.equal(limite.motivo, "configuracao");
});

test("lê data e hora de Brasília e o cache do 304", () => {
  assert.deepEqual(lerDataHoraBrasilia("2022-08-12T00:00:01"), new Date("2022-08-12T03:00:01Z"));
  assert.equal(lerDataHoraBrasilia("2022-08-12"), null);
  assert.equal(lerDataHoraBrasilia("2022-13-45T00:00:00"), null);
  assert.equal(lerDataHoraBrasilia("2022-02-30T00:00:00"), null);
  assert.equal(lerCache({ etag: '"outro:1"', expires: "Sat, 15 Oct 2022 00:00:01 GMT" }), null);
  assert.equal(lerCache({ etag: '"autenticar_procurador_token:abc"', expires: "amanhã" }), null);
  assert.equal(lerCache({ etag: '"autenticar_procurador_token:abc"' }), null);
});
