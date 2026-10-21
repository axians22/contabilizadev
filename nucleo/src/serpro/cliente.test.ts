import { test } from "node:test";
import assert from "node:assert/strict";
import type { Transporte } from "../http.ts";
import { cnpj, cpf, criarClienteSerpro, ErroSemResposta, falhaDoErro, type ChamadaRegistrada } from "./cliente.ts";

const PLATAFORMA = "11222333000181";
const CLIENTE = cnpj("11.444.777/0001-61");

function montar(respostas: { status: number; texto: string }[], consumo = { consulta: 0, emissao: 0, declaracao: 0 }) {
  const enviados: { url: string; headers: Record<string, string>; corpo: string; comCertificado: boolean }[] = [];
  const registradas: ChamadaRegistrada[] = [];
  const transporte: Transporte = async (url, headers, corpo, certificado) => {
    enviados.push({ url, headers, corpo, comCertificado: Boolean(certificado) });
    const r = respostas.shift();
    if (!r) throw new Error("sem resposta gravada");
    return r;
  };
  const cliente = criarClienteSerpro({
    consumerKey: "chave",
    consumerSecret: "segredo",
    certificado: { pfx: Buffer.from("pfx"), senha: "x" },
    contratante: PLATAFORMA,
    limitePorPeriodo: 40,
    registro: { registrar: (c) => void registradas.push(c), consumo: () => consumo },
    transporte,
    agora: () => new Date(2026, 9, 16, 12),
  });
  return { cliente, enviados, registradas };
}

const TOKEN = { status: 200, texto: JSON.stringify({ access_token: "a1", jwt_token: "j1", expires_in: 3600 }) };
const OK = (dados: unknown) => ({ status: 200, texto: JSON.stringify({ status: 200, dados: JSON.stringify(dados), mensagens: [{ codigo: "Sucesso", texto: "ok" }] }) });

test("autentica com o certificado, monta o pedido e registra a chamada com custo", async () => {
  const { cliente, enviados, registradas } = montar([TOKEN, OK({ x: 1 })]);
  const r = await cliente.chamar("Consultar", { idSistema: "A", idServico: "B", versaoSistema: "1.0", dados: { y: 2 } }, "Testar", {
    contribuinte: CLIENTE,
  });
  assert.deepEqual(r.dados, { x: 1 });
  assert.equal(enviados[0].comCertificado, true);
  assert.equal(enviados[0].headers["Role-Type"], "TERCEIROS");
  assert.equal(enviados[1].url.endsWith("/Consultar"), true);
  assert.equal(enviados[1].headers.Authorization, "Bearer a1");
  // Sem tokenProcurador, só os cabeçalhos do contrato (a plataforma é a autora do pedido).
  assert.deepEqual(Object.keys(enviados[1].headers).sort(), ["Accept", "Authorization", "Content-Type", "jwt_token"]);
  const corpo = JSON.parse(enviados[1].corpo);
  assert.deepEqual(corpo.contratante, { numero: PLATAFORMA, tipo: 2 });
  assert.deepEqual(corpo.contribuinte, { numero: "11444777000161", tipo: 2 });
  assert.deepEqual(corpo.autorPedidoDados, { numero: PLATAFORMA, tipo: 2 });
  assert.equal(corpo.pedidoDados.dados, '{"y":2}');
  assert.deepEqual(registradas.map((c) => [c.acao, c.custo, c.contribuinte]), [["Autenticar", 0, null], ["Consultar", 0.24, "11444777000161"]]);
});

test("reaproveita o token até expirar e esquece depois de 401", async () => {
  const { cliente, enviados } = montar([TOKEN, OK(1), { status: 401, texto: "{}" }, TOKEN, OK(2)]);
  const pedido = { idSistema: "A", idServico: "B", versaoSistema: "1.0", dados: {} };
  await cliente.chamar("Consultar", pedido, "1", { contribuinte: CLIENTE });
  await cliente.chamar("Consultar", pedido, "2", { contribuinte: CLIENTE });
  await cliente.chamar("Consultar", pedido, "3", { contribuinte: CLIENTE });
  assert.equal(enviados.filter((e) => e.url.includes("authenticate")).length, 2);
});

test("declaração que transmite exige confirmação; simulação não", async () => {
  const { cliente, enviados } = montar([TOKEN, OK({})]);
  const pedido = (indicadorTransmissao: boolean) => ({ idSistema: "PGDASD", idServico: "T", versaoSistema: "1.0", dados: { indicadorTransmissao } });
  await assert.rejects(cliente.chamar("Declarar", pedido(true), "Transmitir", { contribuinte: CLIENTE }), /confirmação/);
  assert.equal(enviados.length, 0);
  await cliente.chamar("Declarar", pedido(false), "Simular", { contribuinte: CLIENTE });
  assert.equal(enviados.length, 2);
});

test("bloqueia sem finalidade, com contribuinte inválido ou acima do limite do período", async () => {
  const { cliente, enviados } = montar([], { consulta: 30, emissao: 5, declaracao: 5 });
  const pedido = { idSistema: "A", idServico: "B", versaoSistema: "1.0", dados: {} };
  await assert.rejects(cliente.chamar("Consultar", pedido, "  ", { contribuinte: CLIENTE }), /finalidade/);
  await assert.rejects(cliente.chamar("Consultar", pedido, "x", { contribuinte: cpf("123") }), /CPF/);
  await assert.rejects(cliente.chamar("Consultar", pedido, "x", { contribuinte: CLIENTE }), /Limite de 40/);
  assert.equal(enviados.length, 0);
});

test("falha de rede e autenticação recusada ficam registradas", async () => {
  const { cliente, registradas } = montar([{ status: 403, texto: "negado" }]);
  const pedido = { idSistema: "A", idServico: "B", versaoSistema: "1.0", dados: {} };
  await assert.rejects(cliente.chamar("Emitir", pedido, "x", { contribuinte: CLIENTE }), /HTTP 403/);
  assert.equal(registradas[0].status, 403);
  await assert.rejects(cliente.chamar("Emitir", pedido, "x", { contribuinte: CLIENTE }), /sem resposta/);
  assert.equal(registradas[1].status, null);
});

test("pedido que saiu sem resposta vira ErroSemResposta (a transmissão fica incerta); recusa antes de enviar, não", async () => {
  const { cliente, registradas } = montar([TOKEN]);
  const pedido = { idSistema: "A", idServico: "B", versaoSistema: "1.0", dados: {} };
  await assert.rejects(cliente.chamar("Emitir", pedido, "x", { contribuinte: CLIENTE }), (e) => e instanceof ErroSemResposta && /sem resposta/.test(e.message));
  assert.equal(registradas.at(-1)?.status, null);
  assert.deepEqual(falhaDoErro(new ErroSemResposta("caiu")), { ok: false, detalhe: "caiu", semResposta: true });
  assert.deepEqual(falhaDoErro(new Error("Limite de 40 chamadas")), { ok: false, detalhe: "Limite de 40 chamadas" });
});

test("resposta que não é JSON vira mensagem", async () => {
  const { cliente } = montar([TOKEN, { status: 502, texto: "<html>Bad gateway</html>" }]);
  const r = await cliente.chamar("Consultar", { idSistema: "A", idServico: "B", versaoSistema: "1.0", dados: "" }, "x", { contribuinte: CLIENTE });
  assert.equal(r.status, 502);
  assert.match(r.mensagens[0].texto, /Bad gateway/);
});

test("sem chaves ou com contratante inválido nem cria o cliente", () => {
  const base = { certificado: { pfx: Buffer.from(""), senha: "" }, limitePorPeriodo: 1, registro: { registrar() {}, consumo: () => ({ consulta: 0, emissao: 0, declaracao: 0 }) } };
  assert.throws(() => criarClienteSerpro({ ...base, consumerKey: "", consumerSecret: "", contratante: PLATAFORMA }), /chaves/);
  assert.throws(() => criarClienteSerpro({ ...base, consumerKey: "a", consumerSecret: "b", contratante: "123" }), /Contratante/);
});

test("CNPJ alfanumérico: cnpj() mantém as letras (maiúsculas) e o cliente aceita como contribuinte", async () => {
  assert.deepEqual(cnpj("12.abc.345/01de-35"), { numero: "12ABC34501DE35", tipo: 2 });
  const { cliente, enviados } = montar([TOKEN, OK({})]);
  await cliente.chamar("Consultar", { idSistema: "A", idServico: "B", versaoSistema: "1", dados: {} }, "x", { contribuinte: cnpj("12ABC34501DE35") });
  assert.deepEqual(JSON.parse(enviados[1].corpo).contribuinte, { numero: "12ABC34501DE35", tipo: 2 });
  await assert.rejects(cliente.chamar("Consultar", { idSistema: "A", idServico: "B", versaoSistema: "1", dados: {} }, "x", { contribuinte: { numero: "12ABC34501DEXX", tipo: 2 } }), /CNPJ com 14/);
});

test("com o token do termo de autorização: header autenticar_procurador_token e a empresa como autora do pedido", async () => {
  const { cliente, enviados, registradas } = montar([TOKEN, OK(1)]);
  await cliente.chamar("Consultar", { idSistema: "A", idServico: "B", versaoSistema: "1.0", dados: {} }, "Testar", {
    contribuinte: CLIENTE,
    autorPedidoDados: CLIENTE,
    tokenProcurador: "b06feea3-1ca8-49f4-bdb4-211ab006cb92",
  });
  assert.equal(enviados[1].headers.autenticar_procurador_token, "b06feea3-1ca8-49f4-bdb4-211ab006cb92");
  const corpo = JSON.parse(enviados[1].corpo);
  assert.deepEqual(corpo.autorPedidoDados, { numero: "11444777000161", tipo: 2 });
  assert.deepEqual(corpo.contratante, { numero: PLATAFORMA, tipo: 2 });
  // O token nunca vai para o registro das chamadas.
  assert.doesNotMatch(JSON.stringify(registradas), /b06feea3/);
});

test("token de procurador malformado (quebra de linha, vazio) é recusado antes de chamar", async () => {
  const { cliente, enviados } = montar([TOKEN, OK(1)]);
  const pedido = { idSistema: "A", idServico: "B", versaoSistema: "1.0", dados: {} };
  await assert.rejects(cliente.chamar("Consultar", pedido, "x", { contribuinte: CLIENTE, tokenProcurador: "abc\r\nX-Outro: 1" }), /Token de procurador inválido/);
  await assert.rejects(cliente.chamar("Consultar", pedido, "x", { contribuinte: CLIENTE, tokenProcurador: "" }), /Token de procurador inválido/);
  assert.equal(enviados.length, 0);
});
