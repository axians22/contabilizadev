// Cada etapa do assistente de cadastro renderiza (HTML do servidor, como o navegador recebe na primeira carga):
// trilha "Passo N de 7 · Nome" com aria-current na etapa certa, título focável, botões e as explicações. Regra de tela:
// na tela fica só o título, uma frase curta e os dados/ação; as explicações ficam nos tooltips (<Explicacao>). Só o que
// impede o cadastro (motivo e o que fazer) fica visível, curto.
// As prévias são as respostas gravadas da Receita (nada sai da máquina).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { lerRespostaCnpj } from "@contabilizadev/nucleo/brasilapi/cnpj";
import { respostaGravada, type Exemplo } from "@contabilizadev/nucleo/brasilapi/exemplos";
import { diagnosticar } from "@contabilizadev/nucleo/diagnostico";
import { Assistente } from "@/app/(painel)/empresas/nova/assistente";
import { ESTADO_INICIAL, ETAPAS, explicarNatureza, explicarSituacao, resumoSimples, type EstadoAssistente, type Explicacao as Situacao, type IdEtapa, type PreviaDoAssistente } from "@/lib/empresas/assistente";
import { GLOSSARIO, type Termo } from "@/lib/empresas/glossario";
import { explicacoes, paragrafosVisiveis, semExplicacoes, texto } from "./tela";

function previa(exemplo: Exemplo): PreviaDoAssistente {
  const dados = lerRespostaCnpj(respostaGravada(exemplo));
  return { dados, diagnostico: diagnosticar(dados, "2026-10-16"), consultadaEm: new Date().toISOString(), token: "t", qsa: "confere" as const };
}

const nada = async () => ({ erro: "não chamado" });

function tela(estado: EstadoAssistente): string {
  return renderToStaticMarkup(createElement(Assistente, { consultar: nada, cadastrar: nada, preparar: nada as never, enviar: nada, inicial: estado })).replace(/\u00a0/g, " ");
}

// Na trilha, só a etapa atual tem aria-current="step", e é a certa.
function etapaAtual(html: string): string {
  const atuais = [...html.matchAll(/<li aria-current="step"[^>]*>(.*?)<\/li>/g)];
  assert.equal(atuais.length, 1, "uma etapa atual na trilha");
  return texto(atuais[0][1]);
}

const ti = previa("ti-fator-r");
// A empresa da plataforma, cadastrada pelo ADMIN: nasce comprovada (sem o quadro de sócios).
const plataforma: PreviaDoAssistente = { ...ti, qsa: "plataforma" };
// recebidaEm: hora (relógio do navegador) em que a prévia chegou; por padrão, agora.
const em = (etapa: IdEtapa, p: PreviaDoAssistente | null = ti, empresaId: string | null = null, recebidaEm = Date.now(), resto: Partial<EstadoAssistente> = {}): EstadoAssistente => ({
  etapa,
  cnpj: p ? "12.345.678/0001-95" : "",
  previa: p,
  recebidaEm: p ? recebidaEm : null,
  empresaId,
  autorizacao: null,
  autorizadaAte: null,
  ...resto,
});

// Os termos do glossário estão em tooltips (rótulo "O que é…?" e o texto no balão), não na tela.
function noTooltip(html: string, ...termos: Termo[]) {
  const lista = explicacoes(html);
  for (const t of termos) {
    // O rótulo é a pergunta do verbete; com gatilho de texto, vem depois dele ("Pró-labore e Fator R: o que é o pró-labore?").
    const e = lista.find((x) => x.rotulo.toLowerCase().endsWith(GLOSSARIO[t].titulo.toLowerCase()));
    assert.ok(e, `tooltip de ${t}`);
    for (const p of GLOSSARIO[t].texto) assert.ok(e.texto.includes(p), `${t}: texto no balão`);
    assert.ok(!texto(semExplicacoes(html)).includes(GLOSSARIO[t].texto[0]), `${t}: explicação aberta na tela`);
  }
}

// Algum tooltip tem este texto (e ele não está aberto na tela)?
function explicado(html: string, re: RegExp) {
  assert.ok(explicacoes(html).some((e) => re.test(e.texto)), `tooltip com ${re}`);
  assert.doesNotMatch(texto(semExplicacoes(html)), re, `${re} aberto na tela`);
}

const visivel = (html: string) => texto(semExplicacoes(html));

// Tela enxuta: nenhum parágrafo visível longo (explicação vai para o tooltip) e nada de <details>/"Saiba mais".
function enxuta(html: string) {
  for (const p of paragrafosVisiveis(html)) assert.ok(p.length <= 140, `parágrafo longo na tela: ${p}`);
  assert.doesNotMatch(html, /<details|Saiba mais/);
}

describe("assistente de cadastro: cada etapa renderiza", () => {
  it("1. Pesquisar o CNPJ: campo, uma frase, o que é e onde encontrar no tooltip, botão de pesquisar; sem Voltar", () => {
    const html = tela(ESTADO_INICIAL);
    const t = visivel(html);
    assert.match(t, /Passo 1 de 7 · Pesquisar o CNPJ/);
    assert.match(etapaAtual(html), /1\. Pesquisar o CNPJ/);
    assert.match(html, /<h2 id="titulo-etapa" tabindex="-1"[^>]*>Qual é o CNPJ da empresa\?<\/h2>/);
    assert.match(html, /<input[^>]*id="cnpj"/);
    assert.match(html, /<label for="cnpj">CNPJ da empresa<\/label>/);
    assert.match(t, /Receita Federal/);
    noTooltip(html, "cnpj", "ondeCnpj");
    explicado(html, /Cartão CNPJ/);
    explicado(html, /e-CAC/);
    explicado(html, /alfanumérico/);
    assert.match(t, /Pesquisar CNPJ/);
    assert.doesNotMatch(t, /Voltar/);
    // As etapas aparecem como sete bolinhas numeradas; os nomes ficam no texto de cima e para o leitor de tela e a etapa atual tem aria-current. No
    // celular ela fica sr-only, nunca display:none (hidden), para o leitor de tela continuar achando o aria-current.
    for (const [i, e] of ETAPAS.entries()) assert.ok(t.includes(`${i + 1}. ${e.nome}`), e.nome);
    assert.match(html, /<ol class="flex items-center">/);
    assert.equal(html.match(/size-7 shrink-0 place-items-center rounded-full/g)?.length, 7, "sete bolinhas numeradas");
    assert.doesNotMatch(html, /<ol class="[^"]*\bhidden\b/);
    assert.match(html, /<nav aria-label="Etapas do cadastro"/);
    enxuta(html);
  });

  it("2. Conferir a empresa: cada dado com o ⓘ, situação ATIVA ok, endereço e data de abertura", () => {
    const html = tela(em("empresa"));
    const t = visivel(html);
    assert.match(t, /Passo 2 de 7 · Conferir a empresa/);
    assert.match(etapaAtual(html), /2\. Conferir a empresa/);
    for (const nome of ["Razão social", "Nome fantasia", "Situação cadastral", "Natureza jurídica", "Endereço", "Data de abertura", "Sócios e administradores"]) assert.ok(t.includes(nome), nome);
    assert.match(t, /EXEMPLO SOFTWARE LTDA/);
    assert.match(t, /EXEMPLO DEV/);
    assert.match(t, /CNPJ ativo/);
    assert.match(t, /RUA DOS EXEMPLOS, 100, SALA 1 - CENTRO - FLORIANOPOLIS\/SC - CEP 88010-000/);
    assert.match(t, /10\/03\/2022/);
    noTooltip(html, "razaoSocial", "nomeFantasia", "situacao", "natureza", "endereco", "abertura", "socios", "dadosErrados", "proLabore");
    // O pró-labore fica junto dos sócios (quem recebe), com o termo como gatilho, e não aberto na tela do diagnóstico.
    assert.match(html, /<button[^>]*aria-label="Pró-labore e Fator R: o que é o pró-labore\?"[^>]*>Pró-labore e Fator R<\/button>/);
    assert.match(t, /Voltar/);
    assert.match(t, /Continuar/);
    enxuta(html);
  });

  it("2. Conferir a empresa: o resultado do quadro de sócios (confere; sem quadro, a comprovação fica só pelo termo)", () => {
    const confere = visivel(tela(em("empresa")));
    assert.match(confere, /Você está no quadro de sócios da empresa\./);
    // Sem quadro publicado (o empresário individual, por exemplo): aviso curto, o porquê no tooltip.
    const semQuadro: PreviaDoAssistente = { ...ti, dados: { ...ti.dados, socios: [] }, qsa: "sem-qsa" };
    const html = tela(em("empresa", semQuadro));
    const t = visivel(html);
    assert.match(t, /Sócios e administradores Não publicado pela Receita Federal/);
    assert.match(t, /a comprovação será só pelo termo de autorização/);
    explicado(html, /fica aguardando comprovação até você assinar o termo/);
    assert.doesNotMatch(t, /Você está no quadro/);
    // Os CPFs mascarados do quadro nunca aparecem.
    assert.doesNotMatch(tela(em("empresa")), /\*\*\*\d/);
  });

  it("2. Conferir a empresa (CNPJ baixado): o motivo fica na tela, curto; o que fazer, no tooltip", () => {
    const html = tela(em("empresa", previa("baixada")));
    const t = visivel(html);
    assert.match(t, /BAIXADA/);
    assert.match(t, /Atenção: CNPJ baixado \(empresa encerrada\): não dá para cadastrar\./);
    explicado(html, /abrir outra/);
    enxuta(html);
  });

  it("3. Atividades: principal e secundárias com o anexo de cada uma; CNAE, anexo e a regra no tooltip", () => {
    const html = tela(em("atividades"));
    const t = visivel(html);
    assert.match(t, /Passo 3 de 7 · Atividades/);
    assert.match(etapaAtual(html), /3\. Atividades/);
    assert.match(t, /Atividade principal/);
    assert.match(t, /Atividades secundárias/);
    assert.match(t, /6201-5\/01/);
    assert.match(t, /Anexo III ou V\./);
    assert.match(t, /Sempre Anexo III\./); // 6209-1/00, secundária
    noTooltip(html, "cnae", "anexo", "cnaeEAnexo");
    explicado(html, /Depende do Fator R/);
    // O termo sublinhado é o próprio gatilho: o rótulo contém o texto visível (WCAG 2.5.3).
    assert.match(html, /<button[^>]*aria-label="O que é o CNAE\?"[^>]*>CNAE<\/button>/);
    enxuta(html);
  });

  it("3. Atividades (fora de TI): motivo curto na tela, fundamento e descrição inteira no tooltip próprio de cada uma", () => {
    const html = tela(em("atividades", previa("fora-do-escopo")));
    const t = visivel(html);
    assert.equal(t.match(/Ainda não atendemos: fora das atividades de TI\./g)?.length, 2);
    assert.doesNotMatch(t, /CGSN|6201, 6202/);
    const lista = explicacoes(html);
    const rotulos = lista.map((e) => e.rotulo);
    assert.equal(new Set(rotulos).size, rotulos.length, `rótulos repetidos: ${rotulos.join(" | ")}`);
    const intermediacao = lista.find((e) => e.rotulo === "Por que 7490-1/04 não é atendida?");
    assert.ok(intermediacao);
    assert.match(intermediacao.texto, /Atividades de intermediação e agenciamento de serviços e negócios em geral, exceto imobiliários/);
    assert.match(intermediacao.texto, /CGSN 140, art\. 25/);
    assert.match(lista.find((e) => e.rotulo === "Por que 4751-2/01 não é atendida?")?.texto ?? "", /6201, 6202, 6203/);
    assert.ok(rotulos.includes("Por que 6204-0/00 fica no Anexo III ou V?"));
    assert.match(t, /7490-1\/04 · Atividades de intermediação e agenciamento de serviços e negócios em…/);
    enxuta(html);
  });

  it("4. Simples Nacional: optante desde quando, não é MEI; o que muda na prática no tooltip", () => {
    const html = tela(em("simples"));
    const t = visivel(html);
    assert.match(t, /Passo 4 de 7 · Simples Nacional/);
    assert.match(etapaAtual(html), /4\. Simples Nacional/);
    assert.match(t, /Optante do Simples Nacional desde 10\/03\/2022/);
    assert.match(t, /Não é MEI/);
    noTooltip(html, "simples", "mei", "naPratica");
    // Em ordem, nenhum tooltip de "o que fazer" (o texto dos casos ok não existe mais).
    assert.ok(!explicacoes(html).some((e) => /impede o cadastro/.test(e.rotulo)));
    enxuta(html);
  });

  it("4. Simples Nacional (saída do Simples marcada para depois): ✓ só com a opção, sem 'Atenção' junto do 'Tudo certo'", () => {
    const base = previa("ti-fator-r");
    const dados = { ...base.dados, simples: { ...base.dados.simples, dataExclusao: "2026-12-31" } };
    const html = tela(em("simples", { ...base, dados, diagnostico: diagnosticar(dados, "2026-10-16") }));
    const t = texto(semExplicacoes(html));
    assert.match(t, /Tudo certo: Optante do Simples Nacional desde 10\/03\/2022\./);
    assert.doesNotMatch(t, /Tudo certo:[^.]*\.\s*Atenção/);
    assert.doesNotMatch(t, /saída do Simples/i);
    // O aviso de saída aparece no diagnóstico, em destaque (Atenção:), não com o ✓.
    const diag = texto(semExplicacoes(tela(em("diagnostico", { ...base, dados, diagnostico: diagnosticar(dados, "2026-10-16") }))));
    assert.match(diag, /Atenção: Saída do Simples marcada para 31\/12\/2026\./);
  });

  it("4. Simples Nacional (MEI não informado pela Receita): 'Não informado', frase neutra, sem ✓ nem alerta", () => {
    const base = previa("ti-fator-r");
    const dados = { ...base.dados, mei: { optante: null, dataOpcao: null, dataExclusao: null } };
    const html = tela(em("simples", { ...base, dados, diagnostico: diagnosticar(dados, "2026-10-16") }));
    const t = texto(semExplicacoes(html));
    assert.match(t, /MEI\s*Não informado/);
    assert.match(t, /A Receita Federal não informa se a empresa é MEI\./);
    assert.doesNotMatch(t, /Não é MEI|Tudo certo: A Receita|Atenção: A Receita Federal não informa se a empresa é MEI/);
    // Os outros dois casos: "Não" com ✓ e "Sim" com o alerta.
    assert.match(texto(semExplicacoes(tela(em("simples")))), /MEI\s*Não\s*✓\s*Tudo certo: Não é MEI\./);
    assert.match(texto(semExplicacoes(tela(em("simples", previa("mei"))))), /MEI\s*Sim\s*!\s*Atenção: É MEI/);
  });

  it("4. Simples Nacional (MEI): o impedimento fica na tela, curto, com os detalhes no tooltip", () => {
    const html = tela(em("simples", previa("mei")));
    assert.match(visivel(html), /Atenção: É MEI desde .*: ainda não atendemos MEI\./);
    explicado(html, /valor fixo por mês \(o DAS-MEI\)/);
    enxuta(html);
  });

  it("5. Diagnóstico (Fator R): só o anexo, o ⓘ do Fator R e a confirmação; a regra e o exemplo nos tooltips", () => {
    const html = tela(em("diagnostico"));
    const t = visivel(html);
    assert.match(t, /Passo 5 de 7 · Diagnóstico/);
    assert.match(etapaAtual(html), /5\. Diagnóstico/);
    assert.match(t, /Atendemos sua empresa/);
    assert.match(t, /Anexo III ou V\s*, conforme o Fator R/);
    assert.match(t, /Ao confirmar, cadastramos a EXEMPLO SOFTWARE LTDA\s*; ela fica aguardando a comprovação pelo termo de autorização\./);
    // A empresa da plataforma (ADMIN) já nasce comprovada: dono na hora.
    assert.match(visivel(tela(em("diagnostico", plataforma))), /Ao confirmar, cadastramos a EXEMPLO SOFTWARE LTDA e você fica como dono dela\./);
    // Nenhuma explicação da regra aberta na tela (28%, folha, Anexo III mais barato).
    assert.doesNotMatch(t, /28%|folha de pagamento|mais barato/);
    noTooltip(html, "fatorR");
    explicado(html, /R\$ 2\.800,00 por mês: Fator R de 28%, a receita fica no Anexo III/);
    const exemplo = explicacoes(html).find((e) => e.rotulo === "Ver exemplo: como fica o Fator R com números?");
    assert.ok(exemplo);
    assert.match(exemplo.balao, /role="list"/);
    assert.match(exemplo.botao, /decoration-dotted/); // texto "Ver exemplo", não um segundo ⓘ ao lado do Fator R
    assert.match(t, /Confirmar e cadastrar/);
    enxuta(html);
  });

  it("5. Diagnóstico (Fator R): a regra dos 28% num só tooltip; o 'Ver exemplo' só com os números", () => {
    const html = tela(em("diagnostico"));
    const lista = explicacoes(html);
    const comRegra = lista.filter((e) => /pelo menos 28%|Com 28% ou mais/.test(e.texto));
    assert.deepEqual(comRegra.map((e) => e.rotulo), ["O que é o Fator R?"]);
    const exemplo = lista.find((e) => e.rotulo === "Ver exemplo: como fica o Fator R com números?");
    assert.ok(exemplo);
    const numeros = exemplo.texto;
    assert.doesNotMatch(numeros, /Resumo|O Fator R é a folha|plataforma faz essa conta/);
    assert.match(numeros, /R\$ 120\.000,00 em 12 meses/);
  });

  it("5. Diagnóstico (Anexo III fixo, CNAE 6209): sem Fator R", () => {
    const t = visivel(tela(em("diagnostico", previa("ti-anexo-iii"))));
    assert.match(t, /Anexo III\s*, fixo \(sem Fator R\)/);
    assert.doesNotMatch(t, /o Fator R não muda nada/);
    assert.match(t, /Confirmar e cadastrar/);
  });

  it("5. Diagnóstico (não atendida): motivos visíveis, sem botão de cadastrar", () => {
    const html = tela(em("diagnostico", previa("mei")));
    const t = visivel(html);
    assert.match(html, /<h2[^>]*>Ainda não atendemos esta empresa<\/h2>/);
    assert.match(t, /Motivo/);
    assert.match(t, /MEI/);
    assert.doesNotMatch(t, /Confirmar e cadastrar/);
    assert.match(t, /Ver o que fazer/);
    enxuta(html);
  });

  it("5. Diagnóstico (não atendida): o título diz que não atendemos, sem selo repetindo a mesma coisa", () => {
    for (const ex of ["mei", "banco-do-brasil", "fora-do-escopo", "baixada"] as const) {
      const t = visivel(tela(em("diagnostico", previa(ex))));
      assert.equal(t.match(/Ainda não atendemos/g)?.length, 1, `${ex}: ${t.slice(0, 120)}`);
    }
  });

  it("6. Próximos passos (CNPJ baixado ou nulo): só a orientação da situação, nada de entrar no Simples", () => {
    for (const ex of ["baixada", "banco-do-brasil"] as const) {
      for (const situacao of ["BAIXADA", "NULA"]) {
        const base = previa(ex);
        const dados = { ...base.dados, situacaoCadastral: situacao };
        const p = { ...base, dados, diagnostico: diagnosticar(dados, "2026-10-16") };
        const t = visivel(tela(em("proximos", p)));
        assert.doesNotMatch(t, /Entrar no Simples Nacional|Sair do MEI|Atividades fora de TI|Tipo de empresa/, `${ex}/${situacao}`);
      }
    }
  });

  it("5. Diagnóstico (Banco do Brasil): cada motivo curto, com o texto completo no tooltip próprio dele", () => {
    const p = previa("banco-do-brasil");
    const html = tela(em("diagnostico", p));
    const t = visivel(html);
    assert.match(t, /Tipo de empresa não atendido: Sociedade de Economia Mista\./);
    assert.doesNotMatch(t, /atendemos sociedade limitada/);
    const lista = explicacoes(html);
    for (const n of p.diagnostico.impedimentos) {
      const e = lista.find((x) => x.rotulo === n.pergunta);
      assert.ok(e, n.pergunta);
      assert.ok(e.texto.includes(texto(n.detalhe).trim()), n.detalhe);
    }
    enxuta(html);
  });

  it("5. Diagnóstico (atividades em anexos diferentes): aviso curto na tela, a regra no tooltip", () => {
    const html = tela(em("diagnostico"));
    assert.match(visivel(html), /Atenção: Há atividades no Anexo III fixo e outras que dependem do Fator R\./);
    explicado(html, /cada receita é declarada na atividade do serviço prestado/);
  });

  it("6. Próximos passos (CNPJ baixado): título e frase dizem o que fazer, sem prometer regularizar", () => {
    const html = tela(em("proximos", previa("baixada")));
    const t = visivel(html);
    assert.match(t, /CNPJ encerrado/);
    assert.match(t, /Para cadastrar, é preciso abrir uma nova empresa\./);
    assert.doesNotMatch(t, /Regularizar o CNPJ/);
    explicado(html, /é preciso abrir outra/);
    assert.ok(explicacoes(html).some((e) => e.rotulo === "Dá para cadastrar um CNPJ encerrado?"));
    enxuta(html);
  });

  it("6. Empresa cadastrada (cliente): aguarda comprovação; o porquê no tooltip e o termo a seguir", () => {
    const html = tela(em("proximos", ti, "emp-1"));
    const t = visivel(html);
    assert.match(t, /Passo 6 de 7 · Empresa cadastrada/);
    assert.match(t, /A EXEMPLO SOFTWARE LTDA está cadastrada e aguarda comprovação\./);
    assert.match(t, /A seguir, assine o termo para comprovar e liberar a plataforma\./);
    assert.doesNotMatch(t, /você é o dono dela|\(opcional\)/);
    explicado(html, /e-CNPJ A1 da empresa, emitido em nome do seu CPF/);
    assert.match(html, /<button type="submit"[^>]*>Continuar<\/button>/);
    enxuta(html);
  });

  it("6. Empresa cadastrada (empresa da plataforma): confirmação curta, o que vem a seguir no tooltip e Continuar para o passo 7", () => {
    const html = tela(em("proximos", plataforma, "emp-1"));
    const t = visivel(html);
    assert.match(t, /Passo 6 de 7 · Empresa cadastrada/);
    assert.match(etapaAtual(html), /6\. Empresa cadastrada/);
    assert.match(html, /<h2[^>]*>Empresa cadastrada<\/h2>/);
    assert.match(t, /Pronto! A EXEMPLO SOFTWARE LTDA está cadastrada e você é o dono dela\./);
    assert.match(t, /A seguir, a autorização \(opcional\)/);
    noTooltip(html, "termo");
    explicado(html, /Calcula o DAS todo mês/);
    assert.match(html, /<button type="submit"[^>]*>Continuar<\/button>/);
    // Voltar só mostra o que foi conferido (só leitura); nada de link antigo nem de "ligar o automático".
    assert.match(t, /Voltar/);
    assert.doesNotMatch(html, /automatico|automático/i);
    enxuta(html);
  });

  it("6. Próximos passos (não atendida): o que fazer visível (curto), detalhes no tooltip, pesquisar outro", () => {
    const html = tela(em("proximos", previa("fora-do-escopo")));
    const t = visivel(html);
    // Não cadastrada: o assistente termina aqui, no passo 6 de 6, sem a autorização.
    assert.match(t, /Passo 6 de 6 · O que fazer/);
    assert.match(etapaAtual(html), /6\. O que fazer/);
    assert.doesNotMatch(t, /Autorização|Empresa cadastrada/);
    assert.match(html, /<h2[^>]*>Por que não cadastramos e o que fazer<\/h2>/);
    assert.match(t, /Não cadastramos/);
    assert.match(t, /Atividades fora de TI/);
    assert.match(t, /tire as outras atividades do contrato social/);
    explicado(html, /alteração no contrato social \(na Junta Comercial ou no cartório\)/);
    assert.match(t, /Pesquisar outro CNPJ/);
    assert.match(html, /<a[^>]*href="\/"[^>]*>Ir para o painel<\/a>/);
    assert.doesNotMatch(html, /href="\/autorizacao"/);
    assert.match(t, /Voltar/);
    enxuta(html);
  });

  it("todo tooltip das etapas é acessível: botão com rótulo, aria-expanded, aponta para o balão escondido e não vazio", () => {
    const telas = [
      tela(ESTADO_INICIAL),
      ...(["empresa", "atividades", "simples", "diagnostico"] as const).map((e) => tela(em(e))),
      tela(em("proximos", ti, "emp-1")),
      ...(["mei", "fora-do-escopo", "baixada", "banco-do-brasil"] as const).flatMap((n) => [tela(em("empresa", previa(n))), tela(em("diagnostico", previa(n))), tela(em("proximos", previa(n)))]),
    ];
    for (const html of telas) {
      const lista = explicacoes(html);
      assert.ok(lista.length > 0, "a etapa tem tooltips");
      assert.equal(new Set(lista.map((e) => e.id)).size, lista.length, "ids únicos");
      for (const e of lista) {
        assert.match(e.botao, /type="button"/);
        assert.match(e.botao, /aria-expanded="false"/);
        assert.ok(e.botao.includes(`aria-controls="${e.id}"`), `aria-controls de ${e.rotulo}`);
        assert.ok(e.rotulo.endsWith("?"), `rótulo em pergunta: ${e.rotulo}`);
        assert.match(e.balao, /^<span[^>]* hidden=""/);
        assert.ok(e.texto.length > 10, `balão vazio: ${e.rotulo}`);
      }
    }
  });

  it("nenhuma etapa mostra o nome do fornecedor (nem nos tooltips); a fonte é a Receita Federal", () => {
    const telas = [
      tela(ESTADO_INICIAL),
      ...(["empresa", "atividades", "simples", "diagnostico"] as const).map((e) => tela(em(e))),
      tela(em("proximos", ti, "emp-1")),
      ...(["mei", "fora-do-escopo", "baixada", "banco-do-brasil"] as const).flatMap((n) => [tela(em("diagnostico", previa(n))), tela(em("proximos", previa(n)))]),
    ];
    for (const html of telas) {
      assert.doesNotMatch(html, /serpro|integra[\s-]*contador|brasil[\s-]*api/i);
    }
    assert.match(texto(telas[0]), /Receita Federal/);
  });

  it("prévia vencida (mais de 30 min): o passo 1 volta a pesquisar e o diagnóstico avisa que vai pesquisar de novo", () => {
    const antes = Date.now() - 31 * 60_000;
    const vencida = { ...ti, consultadaEm: new Date(antes).toISOString() };
    const passo1 = visivel(tela(em("cnpj", vencida, null, antes)));
    assert.match(passo1, /Pesquisar CNPJ/);
    assert.doesNotMatch(passo1, /Continuar/);
    assert.match(passo1, /mais de 30 minutos: pesquise de novo/);
    const html = tela(em("diagnostico", vencida, null, antes));
    const diag = visivel(html);
    assert.match(diag, /Confirmar e cadastrar/);
    assert.match(diag, /Esta pesquisa tem mais de 30 minutos: ao confirmar, pesquisamos de novo/);
    explicado(html, /só cadastramos com dados recentes/);
    // Com a prévia recente, nenhum aviso de prazo.
    assert.doesNotMatch(texto(tela(em("diagnostico"))), /mais de 30 minutos/);
    assert.match(texto(tela(em("cnpj"))), /Continuar/);
  });

  it("relógio do servidor 3 h à frente ou atrás do navegador: prévia recém-chegada não aparece como vencida", () => {
    for (const diferenca of [3, -3]) {
      const doServidor = { ...ti, consultadaEm: new Date(Date.now() + diferenca * 60 * 60_000).toISOString() };
      const diag = texto(tela(em("diagnostico", doServidor)));
      assert.match(diag, /Confirmar e cadastrar/);
      assert.doesNotMatch(diag, /mais de 30 minutos/);
      assert.match(texto(tela(em("cnpj", doServidor))), /Continuar/);
    }
  });
});

// Variações da prévia que só mudam os dados da Receita (o diagnóstico é refeito com eles).
function variar(exemplo: Exemplo, mudar: (d: PreviaDoAssistente["dados"]) => void): PreviaDoAssistente {
  const base = previa(exemplo);
  const dados = structuredClone(base.dados);
  mudar(dados);
  return { ...base, dados, diagnostico: diagnosticar(dados, "2026-10-16") };
}

describe("assistente de cadastro: o que impede o cadastro nas etapas 2 e 4", () => {
  // Cada caso: a etapa, a prévia e o resultado da regra (o título do tooltip vem dele, não de um texto fixo).
  const casos: [string, IdEtapa, PreviaDoAssistente, Situacao][] = [
    ...["INAPTA", "SUSPENSA", "BAIXADA", "NULA", "EM ANÁLISE"].map((s): [string, IdEtapa, PreviaDoAssistente, Situacao] => [
      s,
      "empresa",
      variar("ti-fator-r", (d) => (d.situacaoCadastral = s)),
      explicarSituacao(s),
    ]),
    ["natureza", "empresa", previa("banco-do-brasil"), explicarNatureza(previa("banco-do-brasil").dados.naturezaJuridica.codigo)],
    ...(
      [
        ["MEI", previa("mei")],
        ["fora do Simples", variar("ti-fator-r", (d) => (d.simples = { optante: false, dataOpcao: null, dataExclusao: "2025-12-31" }))],
        ["Simples não informado", variar("ti-fator-r", (d) => (d.simples = { optante: null, dataOpcao: null, dataExclusao: null }))],
      ] as const
    ).map(([nome, p]): [string, IdEtapa, PreviaDoAssistente, Situacao] => {
      const r = resumoSimples(p.dados, "2026-10-16");
      return [nome, "simples", p, r.mei.ok ? r.simples : r.mei];
    }),
  ];

  it("o balão tem a pergunta do caso como título e rótulo, e o texto responde: por que e o que fazer", () => {
    for (const [nome, etapa, p, e] of casos) {
      assert.equal(e.ok, false, nome);
      if (e.ok) continue;
      assert.match(e.titulo, /^Por que .*\?$/, nome);
      assert.match(e.texto, /O que fazer: \S/, `${nome}: o texto diz o que fazer`);
      const html = tela(em(etapa, p));
      const lista = explicacoes(html);
      assert.ok(!lista.some((x) => /^O que fazer\b/.test(x.texto) && !/O que fazer: \S/.test(x.texto)), `${nome}: balão "O que fazer" que não diz o que fazer`);
      const b = lista.find((x) => x.rotulo === e.titulo);
      assert.ok(b, `${nome}: tooltip com o rótulo do caso`);
      assert.ok(b.texto.startsWith(e.titulo), `${nome}: título do balão = pergunta do caso`);
      assert.ok(b.texto.includes(texto(e.texto).trim()), `${nome}: texto do caso no balão`);
      // O curto fica na tela e o balão não o repete.
      assert.ok(visivel(html).includes(texto(e.curto).trim()), `${nome}: curto na tela`);
      assert.ok(!b.texto.includes(texto(e.curto).trim()), `${nome}: balão repete o curto`);
    }
  });

  it("Simples não informado: o balão acrescenta onde conferir (Consulta Optantes no Portal do Simples Nacional)", () => {
    const html = tela(em("simples", variar("ti-fator-r", (d) => (d.simples = { optante: null, dataOpcao: null, dataExclusao: null }))));
    explicado(html, /Portal do Simples Nacional, em "Consulta Optantes"/);
  });

  it("5. Diagnóstico (não atendida): 'Quem atendemos nesta versão?' diz só quem atendemos; o que fazer fica na frase da tela", () => {
    for (const ex of ["mei", "banco-do-brasil", "fora-do-escopo", "baixada"] as const) {
      const html = tela(em("diagnostico", previa(ex)));
      const quem = explicacoes(html).find((x) => x.rotulo === "Quem atendemos nesta versão?");
      assert.ok(quem, ex);
      assert.doesNotMatch(quem.texto, /próxima etapa|o que fazer/i, ex);
      assert.match(visivel(html), /Na próxima etapa, mostramos o que fazer\./, ex);
    }
  });
});

describe("assistente de cadastro: gatilhos de texto têm o texto visível no nome acessível (WCAG 2.5.3)", () => {
  it("em todas as etapas e prévias, o aria-label contém o texto do botão", () => {
    const previas = (["ti-fator-r", "ti-anexo-iii", "mei", "banco-do-brasil", "fora-do-escopo", "baixada"] as const).map((ex) => previa(ex));
    const telas = [tela(ESTADO_INICIAL), ...previas.flatMap((p) => ETAPAS.slice(1).map((e) => tela(em(e.id, p))))];
    let deTexto = 0;
    for (const html of telas) {
      for (const b of [...html.matchAll(/<button([^>]*aria-describedby="explicacao-[^"]+"[^>]*)>([\s\S]*?)<\/button>/g)]) {
        // Pontuação não conta para o comando de voz ("Onde encontrar?" aciona "Onde encontrar o CNPJ?").
        const visivelNoBotao = texto(b[2].replace(/<svg[\s\S]*?<\/svg>/g, "")).replace(/[?!.:]/g, "").trim();
        if (!visivelNoBotao) continue; // ⓘ: só o ícone
        deTexto++;
        const rotulo = texto(/aria-label="([^"]*)"/.exec(b[1])?.[1] ?? "").trim();
        assert.ok(rotulo.toLowerCase().includes(visivelNoBotao.toLowerCase()), `"${visivelNoBotao}" fora do rótulo "${rotulo}"`);
      }
    }
    assert.ok(deTexto >= 4, "achou os gatilhos de texto");
  });
});
