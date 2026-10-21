// Telas da Parte 7 (HTML do servidor, como o navegador recebe): o passo do eSocial na rotina do mês em cada situação
// (pronto para assinar, processando, sem resposta, recusado, concluído, sem cadastros, sem o certificado da plataforma,
// lançado no portal e a empresa da plataforma), o caminho no portal com os valores prontos (passo 21), o resumo da
// confirmação, o cartão do painel e o aviso do sino. Explicações só no tooltip; para o cliente a fonte é "eSocial", sem
// termos técnicos da ligação.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { ListaDeAvisos } from "@/app/(painel)/avisos/lista";
import { SinoVisual as Sino } from "@/app/(painel)/sino-visual";
import { avisoDoEsocial } from "@/lib/avisos/fontes";
import { MesesNoEsocial, PassoEsocial, situacaoDoMes, type AcoesDoEsocial } from "@/app/(painel)/roteiro/esocial";
import { Tabela } from "@/app/tabela";
import { somarMeses } from "@contabilizadev/nucleo/meses";
import type { Envio, Evento, ResumoEsocial, SituacaoEsocial } from "@/lib/esocial/envio";
import { MENSAGENS_DO_ESOCIAL } from "@/lib/esocial/mensagens";
import { linhasDoResumo } from "@/lib/esocial/resumo";
import { explicacoes, semExplicacoes, texto } from "./tela";

const roteador = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} } as never;
const nada = async () => undefined;
const ACOES: AcoesDoEsocial = { preparar: async () => ({ erro: "" }), enviar: nada, enviarPelaPlataforma: nada, repetir: nada, atualizar: nada, marcarPortal: nada };
const EMPRESA = { id: "00000000-0000-4000-8000-000000000001", cnpj: "98765432000198" };
const AGORA = new Date("2026-10-19T13:00:00Z");

const CONFIG = {
  empresaId: EMPRESA.id, cpf: "52998224725", categoria: "723", matricula: "1", lotacao: "1", tabRubrica: "0001", rubricaProLabore: "100", rubricaInss: "843",
  qtdProLabore: "220.00", diaPagamento: 5, pagamentoNoMes: "seguinte" as const, origem: "importado" as const, importadoDe: "2026-08", atualizadoEm: AGORA, atualizadoPorId: null,
};
const envio = (extra: Partial<Envio>): Envio => ({
  id: "e1", empresaId: EMPRESA.id, mes: "2026-09", tipo: "mensal", estado: "aguardando", loteAtual: 1, totalLotes: 2, protocolo: "P", cpf: CONFIG.cpf, valores: null, transDctf: true,
  certificado: null, mensagem: null, ocorrencias: null, consultas: 0, proximaConsultaEm: null, criadoEm: AGORA, enviadoEm: AGORA, fechadoEm: null, terminadoEm: null, usuarioId: null, ...extra,
});
const remuneracao: Evento = {
  id: "r1", empresaId: EMPRESA.id, envioId: "e1", mes: "2026-09", tipo: "evtRemun", idEvento: "ID1", lote: 1, cpf: CONFIG.cpf, indRetif: 1, ideDmDev: "D", xml: "", signedInfo: null,
  estado: "aceito", cdResposta: "201", recibo: "1.1.0000000000000000101", ocorrencias: null, valores: { proLabore: 1621, inss: 178.31, liquido: 1442.69 }, criadoEm: AGORA, processadoEm: AGORA,
};
const BASE: SituacaoEsocial = {
  mes: "2026-09", config: CONFIG, proLabore: 1621, valores: { proLabore: 1621, inss: 178.31, liquido: 1442.69 }, envio: null, emAndamento: null, remuneracao: null,
  pagamentoAceito: false, fechado: false, portal: false, concluido: false, pagamento: { dtPgto: "2026-09-05", perRef: "2026-08", ideDmDev: "D8", liquido: 1442.69 }, semDemonstrativoAnterior: null, prazo: "2026-10-15",
};
const RESUMO: ResumoEsocial = { mes: "2026-09", tipo: "mensal", cpf: CONFIG.cpf, proLabore: 1621, inss: 178.31, liquido: 1442.69, pagamento: { perRef: "2026-08", dtPgto: "2026-09-05", liquido: 1442.69 }, eventos: ["S-1200", "S-1210", "S-1299"], semPagamentoDe: null };

function passo(s: Partial<SituacaoEsocial>, o: Partial<{ disponivel: boolean; propria: boolean; motivo: string | null; motivoRetificar: string | null; previa: ResumoEsocial | null; meses: SituacaoEsocial[] }> = {}) {
  const props = { acoes: ACOES, numero: 6, empresa: EMPRESA, s: { ...BASE, ...s }, disponivel: true, propria: false, motivo: null, motivoRetificar: MENSAGENS_DO_ESOCIAL.nadaARetificar, previa: null, previaRetificacao: null, ...o };
  return renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: roteador }, createElement(PassoEsocial, props)));
}

// Para o cliente a fonte é o eSocial: nada de termos técnicos da ligação nem do contrato.
function semTermosTecnicos(html: string) {
  assert.doesNotMatch(html, /web\s*-?\s*service|\bSOAP\b|serpro|integra contador/i);
}

describe("passo do eSocial na rotina do mês", () => {
  it("pronto para enviar: os valores para conferir, a data do pagamento e o assinador; o resto no tooltip", () => {
    const html = passo({});
    const t = texto(html);
    assert.match(t, /eSocial \(pró-labore\)/);
    assert.match(t, /Prazo 15\/10\/2026/);
    assert.match(t, /Rubrica 100 \(tabela 0001\): pró-labore R\$\s1\.621,00 · quantidade 220,00/);
    assert.match(t, /Rubrica 843: INSS descontado \(11%\) R\$\s178,31/);
    assert.match(t, /Pagamento no mês \(líquido\) R\$\s1\.442,69 em 05\/09\/2026, do pró-labore de agosto de 2026/);
    assert.match(html, /type="date"[^>]*value="2026-09-05"/);
    assert.match(t, /Procurando certificado guardado neste navegador/);
    const dicas = explicacoes(html).map((e) => e.rotulo);
    for (const r of ["O que vai ao eSocial todo mês?", "Que pagamento é este?", "O que é o modo guiado?"]) assert.ok(dicas.includes(r), r);
    // O passo 21 (portal) fica recolhido quando dá para fazer aqui.
    assert.match(html, /<details class="group">/);
    semTermosTecnicos(html);
  });

  it("processando: o lote atual e o botão de atualizar; sem resposta: enviar de novo, com a explicação no tooltip", () => {
    const processando = texto(passo({ emAndamento: envio({}) }, { motivo: MENSAGENS_DO_ESOCIAL.emAndamento }));
    assert.match(processando, /O eSocial está processando \(lote 1 de 2\)\. O resultado aparece aqui sozinho\./);
    assert.match(processando, /Atualizar o resultado/);
    const incerto = passo({ emAndamento: envio({ estado: "incerto" }) }, { motivo: MENSAGENS_DO_ESOCIAL.incerto });
    assert.match(texto(incerto), /Enviar de novo/);
    assert.ok(explicacoes(incerto).some((e) => e.rotulo === "Enviar de novo não duplica?"));
    assert.equal(texto(semExplicacoes(incerto)).match(/sem duplicar/g)?.length, 1);
  });

  it("recusado: a mensagem própria e a resposta do eSocial no tooltip; enviado: o recibo", () => {
    const recusado = passo({ envio: envio({ estado: "recusado", mensagem: MENSAGENS_DO_ESOCIAL.recusado, ocorrencias: [{ evento: "S-1200", codigo: "1", descricao: "Campo de preenchimento obrigatório." }] }) });
    assert.match(texto(recusado), /O eSocial recusou o envio/);
    const resposta = explicacoes(recusado).find((e) => e.rotulo === "O que o eSocial respondeu?");
    assert.match(resposta?.texto ?? "", /S-1200: Campo de preenchimento obrigatório\. \(código 1\)/);
    const enviado = texto(passo({ remuneracao, fechado: true, concluido: true }, { motivo: MENSAGENS_DO_ESOCIAL.jaEnviado }));
    assert.match(enviado, /Enviado/);
    assert.match(enviado, /Remuneração no eSocial · recibo 1\.1\.0000000000000000101 · R\$\s1\.621,00/);
  });

  it("retificação só quando o pró-labore mudou, recolhida e explicada no tooltip", () => {
    const html = passo({ remuneracao, fechado: true, concluido: true, proLabore: 2000 }, { motivo: MENSAGENS_DO_ESOCIAL.jaEnviado, motivoRetificar: null });
    assert.match(texto(html), /Retificar o pró-labore enviado O pró-labore no eSocial \(R\$\s1\.621,00\) é diferente do informado \(R\$\s2\.000,00\)/);
    assert.ok(explicacoes(html).some((e) => e.rotulo === "Como funciona a retificação?"));
  });

  it("sem cadastros ou sem o certificado da plataforma: o motivo, o caminho e o portal aberto com os valores (passo 21)", () => {
    const semConfig = passo({ config: null }, { motivo: MENSAGENS_DO_ESOCIAL.semConfig });
    assert.match(texto(semConfig), /Configure os cadastros do eSocial da empresa antes de enviar/);
    assert.match(semConfig, /href="\/esocial"/);
    assert.match(semConfig, /<details class="group" open="">/);
    const indisponivel = passo({}, { disponivel: false });
    const t = texto(indisponivel);
    assert.match(t, /O envio ao eSocial por aqui ainda não está disponível/);
    assert.match(t, /Faça no portal Pró-labore no eSocial/);
    assert.match(t, /Gestão da Folha/);
    assert.match(t, /Já lancei no portal/);
    assert.match(indisponivel, /href="https:\/\/login\.esocial\.gov\.br\/"/);
    assert.doesNotMatch(t, /Disponível aqui depois da autorização/);
    semTermosTecnicos(indisponivel);
  });

  it("lançado no portal: conta como feito e dá para desfazer", () => {
    const t = texto(passo({ portal: true, concluido: true }, { motivo: MENSAGENS_DO_ESOCIAL.concluido }));
    assert.match(t, /Lançado no portal/);
    assert.match(t, /Desfazer: ainda não lancei/);
  });

  it("empresa da plataforma: a confirmação com o resumo (assinada no servidor)", () => {
    const html = passo({}, { propria: true, previa: RESUMO });
    const t = texto(html);
    assert.match(t, /Enviar ao eSocial/);
    assert.match(t, /Sócio \(CPF\) 529\.982\.247-25/);
    assert.match(t, /Eventos remuneração \(S-1200\), pagamento \(S-1210\), fechamento do mês \(S-1299\)/);
    assert.match(t, /DCTFWeb transmitida pelo eSocial no fechamento/);
    assert.match(t, /O fechamento do mês pede a transmissão da DCTFWeb do INSS/);
    assert.match(html, /name="proLabore" value="1621"/);
    assert.match(html, /name="semPagamentoAnterior" value="nao"/);
  });

  it("pago no mês seguinte sem o envio do mês anterior: aviso com o link para importar e a escolha explícita de fechar sem o pagamento", () => {
    const html = passo({ pagamento: null, semDemonstrativoAnterior: "2026-08" });
    const t = texto(html);
    assert.match(t, /O envio do pró-labore de agosto de 2026 não está aqui: o pagamento dele, feito neste mês, não vai junto\./);
    assert.match(html, /href="\/esocial"[^>]*>Importar agosto de 2026/);
    assert.match(t, /Fechar o mês sem o pagamento do pró-labore de agosto de 2026/);
    assert.match(html, /type="checkbox"/);
    semTermosTecnicos(html);
    // Empresa da plataforma: a prévia já mostra que o pagamento não vai, e a confirmação leva a escolha.
    const propria = passo({ pagamento: null, semDemonstrativoAnterior: "2026-08" }, { propria: true, previa: { ...RESUMO, pagamento: null, eventos: ["S-1200", "S-1299"], semPagamentoDe: "2026-08" } });
    assert.match(texto(propria), /Pagamento o do pró-labore de agosto de 2026 não vai/);
    assert.match(propria, /name="semPagamentoAnterior" value="sim"/);
    // Sem o problema, nada disso aparece.
    assert.doesNotMatch(texto(passo({})), /não está aqui|Fechar o mês sem o pagamento/);
  });

  it("textos da retificação dizem a verdade: o novo fechamento manda a DCTFWeb retificadora", () => {
    const t = texto(passo({ remuneracao: { ...remuneracao, valores: { proLabore: 1000, inss: 110, liquido: 890 } }, fechado: true, concluido: true }, { motivo: MENSAGENS_DO_ESOCIAL.jaEnviado, motivoRetificar: null }));
    assert.match(t, /O novo fechamento gera a DCTFWeb retificadora e pede ao eSocial a transmissão dela/);
    assert.doesNotMatch(t, /manda a DCTFWeb de novo\)/);
  });
});

describe("resumo, painel e sino", () => {
  it("resumo da confirmação: com o fechamento, a DCTFWeb vai pelo eSocial; sem fechamento, sem a linha da DCTFWeb", () => {
    assert.deepEqual(linhasDoResumo(RESUMO).at(-1), ["DCTFWeb", "transmitida pelo eSocial no fechamento"]);
    assert.deepEqual(linhasDoResumo({ ...RESUMO, pagamento: null, semPagamentoDe: "2026-08" }).find(([n]) => n === "Pagamento"), ["Pagamento", "o do pró-labore de agosto de 2026 não vai"]);
    assert.ok(!linhasDoResumo({ ...RESUMO, eventos: ["S-1200"] }).some(([n]) => n === "DCTFWeb"));
    assert.deepEqual(linhasDoResumo({ ...RESUMO, pagamento: null }).find(([n]) => n === "Pagamento informado"), undefined);
  });

  it("sino: o prazo do eSocial perto (amarelo) ou vencido (vermelho), com o link; feito, nada", () => {
    assert.deepEqual(avisoDoEsocial(null), []);
    assert.deepEqual(avisoDoEsocial({ mes: "2026-09", hoje: "2026-10-01", feito: false }), []);
    const [vence] = avisoDoEsocial({ mes: "2026-09", hoje: "2026-10-12", feito: false });
    assert.deepEqual([vence.nivel, vence.titulo, vence.link], ["vence", "eSocial de setembro de 2026 vence em 3 dias", { href: "/roteiro?mes=2026-09#passo-6", texto: "Enviar ao eSocial" }]);
    const [vencida] = avisoDoEsocial({ mes: "2026-09", hoje: "2026-10-19", feito: false });
    assert.equal(vencida.nivel, "vencida");
    assert.deepEqual(avisoDoEsocial({ mes: "2026-09", hoje: "2026-10-19", feito: true }), []);
    const html = renderToStaticMarkup(createElement(Sino, { avisos: [vencida] }));
    assert.match(html, /bg-bad/);
    assert.match(html, /href="\/avisos"/);
    // O link de onde resolver fica na página Avisos e mensagens (o sino só leva até ela).
    const lista = renderToStaticMarkup(createElement(ListaDeAvisos, { avisos: [vencida], cnpj: null, rotulo: "Avisos da empresa" }));
    assert.match(lista, /href="\/roteiro\?mes=2026-09#passo-6"[^>]*>Enviar ao eSocial</);
  });
});

// Pedido do usuário (20/10/2026): a aba eSocial ficou só com a configuração (grupo "Configuração"); a situação dos meses
// no eSocial, que ela mostrava, foi para o Roteiro (passo 6), sem duplicar.
describe("eSocial: a configuração na aba eSocial, a situação dos meses no Roteiro (passo 6)", () => {
  const APP = path.join(import.meta.dirname, "..", "app", "(painel)");
  const fonte = (rel: string) => readFileSync(path.join(APP, rel), "utf8");

  it("o passo 6 mostra os últimos 12 meses (pró-labore, situação, prazo e recibo), recolhidos, com o mês aberto em destaque", () => {
    const meses: SituacaoEsocial[] = [
      { ...BASE, remuneracao, fechado: true, concluido: true },
      { ...BASE, mes: "2026-08", prazo: "2026-09-15", remuneracao: { ...remuneracao, estado: "importado", recibo: "1.1.0000000000000000088" }, concluido: true },
      { ...BASE, mes: "2026-07", prazo: "2026-08-17", proLabore: null, valores: null },
      { ...BASE, mes: "2026-06", prazo: "2026-07-15", portal: true, concluido: true },
    ];
    const html = passo({}, { meses });
    const t = texto(html);
    assert.match(t, /Os últimos 12 meses no eSocial/);
    assert.match(html, /<details class="border-t border-line pt-3"><summary[^>]*>Os últimos 12 meses no eSocial/);
    assert.match(t, /setembro de 2026 R\$\s1\.621,00 Enviado e fechado 15\/10\/2026 1\.1\.0000000000000000101/);
    assert.match(t, /agosto de 2026 R\$\s1\.621,00 Enviado pelo contador 15\/09\/2026 1\.1\.0000000000000000088/);
    assert.match(t, /julho de 2026 — Sem pró-labore informado 17\/08\/2026 —/);
    assert.match(t, /junho de 2026 R\$\s1\.621,00 Lançado no portal/);
    // Cada mês abre a rotina dele, neste passo; o mês aberto fica marcado.
    assert.match(html, /href="\/roteiro\?mes=2026-08#passo-6"/);
    assert.match(html, /<a aria-current="page"[^>]*href="\/roteiro\?mes=2026-09#passo-6"|<a[^>]*href="\/roteiro\?mes=2026-09#passo-6"[^>]*aria-current="page"/);
    assert.ok(explicacoes(html).some((e) => e.rotulo === "O que mostra a tabela?" && /dia 15 do mês seguinte/.test(e.texto)));
    semTermosTecnicos(html);
    // Sem a lista, o passo não mostra a tabela.
    assert.doesNotMatch(texto(passo({})), /Os últimos 12 meses no eSocial/);
  });

  it("a tabela abre na página do mês aberto: mês antigo (página 2) e o último da lista ficam à vista", () => {
    // 12 meses de 2026-09 a 2025-10, 6 por página: 2026-03 abre a página 2 (2026-03 a 2025-10).
    const doze = Array.from({ length: 12 }, (_, i) => ({ ...BASE, mes: somarMeses("2026-09", -i), prazo: `${somarMeses("2026-09", 1 - i)}-15` }));
    const marcado = (html: string, mes: string) =>
      new RegExp(`<a aria-current="page"[^>]*href="/roteiro\\?mes=${mes}#passo-6"|<a[^>]*href="/roteiro\\?mes=${mes}#passo-6"[^>]*aria-current="page"`).test(html);
    for (const atual of ["2026-03", "2025-10"]) {
      const html = renderToStaticMarkup(createElement(MesesNoEsocial, { meses: doze, atual }));
      assert.ok(marcado(html, atual), atual);
      assert.doesNotMatch(html, /mes=2026-09#passo-6/);
      assert.match(texto(html), /7–12 de 12/);
    }
    // Primeira página para o mês da página 1 e para um mês fora da lista.
    for (const atual of ["2026-04", "2027-01"]) {
      const html = renderToStaticMarkup(createElement(MesesNoEsocial, { meses: doze, atual }));
      assert.match(texto(html), /1–6 de 12/);
      assert.match(html, /mes=2026-09#passo-6/);
    }
  });

  it("a tabela dos meses é remontada quando o mês aberto muda (a troca de mês no cliente só muda o ?mes=)", () => {
    // Procura o elemento <Tabela> devolvido por MesesNoEsocial e confere a chave: com o mês na chave, o React monta
    // a tabela de novo a cada mês e a página inicial (a do mês aberto) volta a valer.
    const acharTabela = (no: unknown): { key: string | null; props: { paginaInicial?: number } } | undefined => {
      if (!no || typeof no !== "object") return undefined;
      if (Array.isArray(no)) { for (const filho of no) { const achado = acharTabela(filho); if (achado) return achado; } return undefined; }
      const el = no as { type?: unknown; key: string | null; props?: { children?: unknown; paginaInicial?: number } };
      if (el.type === Tabela) return el as { key: string | null; props: { paginaInicial?: number } };
      return acharTabela(el.props?.children);
    };
    const doze = Array.from({ length: 12 }, (_, i) => ({ ...BASE, mes: somarMeses("2026-09", -i), prazo: `${somarMeses("2026-09", 1 - i)}-15` }));
    const tabelaDe = (atual: string) => acharTabela(MesesNoEsocial({ meses: doze, atual }));
    assert.equal(tabelaDe("2026-03")?.key, "2026-03");
    assert.equal(tabelaDe("2026-03")?.props.paginaInicial, 2);
    assert.equal(tabelaDe("2026-04")?.key, "2026-04");
    assert.equal(tabelaDe("2026-04")?.props.paginaInicial, 1);
    assert.notEqual(tabelaDe("2025-10")?.key, tabelaDe("2026-09")?.key);
  });

  it("a tabela única aceita a página inicial e não passa da última", () => {
    const linhas = Array.from({ length: 13 }, (_, i) => ({ chave: i, celulas: { n: `linha ${i + 1}` } }));
    const abrir = (paginaInicial?: number) => texto(renderToStaticMarkup(createElement(Tabela, { colunas: [{ chave: "n", titulo: "N" }], linhas, porPagina: 6, paginaInicial })));
    assert.match(abrir(), /1–6 de 13/);
    assert.match(abrir(2), /7–12 de 13/);
    assert.match(abrir(9), /13–13 de 13/);
    assert.match(abrir(0), /1–6 de 13/);
  });

  it("o tooltip do passo 6 diz o que dizia a aba antiga: o certificado não sai do computador e não precisa de procuração", () => {
    const dica = explicacoes(passo({})).find((e) => e.rotulo === "O que vai ao eSocial todo mês?");
    assert.match(dica?.texto ?? "", /O arquivo, a chave e a senha do certificado não saem do seu computador\./);
    assert.match(dica?.texto ?? "", /Não precisa de procuração\./);
  });

  it("a situação de cada mês na tabela (as mesmas frases que a aba eSocial mostrava)", () => {
    assert.equal(situacaoDoMes({ ...BASE, portal: true }), "Lançado no portal");
    assert.equal(situacaoDoMes({ ...BASE, concluido: true, remuneracao }), "Enviado e fechado");
    assert.equal(situacaoDoMes({ ...BASE, concluido: true, remuneracao: { ...remuneracao, estado: "importado" } }), "Enviado pelo contador");
    assert.equal(situacaoDoMes({ ...BASE, emAndamento: envio({ estado: "incerto" }) }), "Sem resposta: enviar de novo");
    assert.equal(situacaoDoMes({ ...BASE, emAndamento: envio({}) }), "Em processamento");
    assert.equal(situacaoDoMes({ ...BASE, envio: envio({ estado: "recusado" }) }), "Recusado");
    assert.equal(situacaoDoMes({ ...BASE, remuneracao }), "Falta fechar o mês");
    assert.equal(situacaoDoMes({ ...BASE, proLabore: null }), "Sem pró-labore informado");
    assert.equal(situacaoDoMes(BASE), "A enviar");
  });

  it("a página do Roteiro monta os 12 meses (reaproveitando o mês aberto) e acompanha os lotes ao abrir", () => {
    const roteiro = fonte("roteiro/page.tsx");
    assert.match(roteiro, /for \(let i = 0; i < 12; i\+\+\) \{\s*const mes = somarMeses\(ultimo, -i\);\s*mesesEs\.push\(mes === pa \? es : await situacaoEsocial\(banco\(\), acesso, mes, agora\)\);/);
    assert.match(roteiro, /meses=\{mesesEs\}/);
    assert.match(roteiro, /await acompanharAoAbrir\(acesso\);/);
  });

  it("a aba eSocial é só a configuração: sem a tabela dos meses, sem a situação dos envios e sem acompanhar lotes", () => {
    const esocial = fonte("esocial/page.tsx");
    for (const fora of [/Meses no eSocial/, /situacaoEsocial/, /acompanharAoAbrir/, /<Tabela/, /passo-6/]) assert.doesNotMatch(esocial, fora, String(fora));
    // Ficam: os cadastros (sócio, categoria e matrícula, lotação, rubricas, pagamento), a importação e o formulário.
    for (const fica of ["Cadastros do eSocial", "Categoria e matrícula", "Lotação", "Rubricas (tabela ", "Pagamento", "Importar do eSocial", "FormularioEsocial", "ImportarDoEsocial"]) {
      assert.ok(esocial.includes(fica), fica);
    }
    // A tabela existe num lugar só (o passo 6 do Roteiro).
    const comTabela = ["esocial/page.tsx", "roteiro/esocial.tsx", "roteiro/page.tsx", "page.tsx", "painel-do-mes.tsx"].filter((f) => fonte(f).includes("Meses no eSocial"));
    assert.deepEqual(comTabela, ["roteiro/esocial.tsx"]);
  });
});
