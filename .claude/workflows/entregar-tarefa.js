export const meta = {
  name: 'entregar-tarefa',
  description: 'Entrega uma parte do plano.txt com o ciclo engenheiro → QA → tech lead, em loop até aprovar',
  whenToUse: 'Para desenvolver uma parte do plano do ContabilizaDev. args: { parte: 1, data: "16/10/2026", maxCiclos: 5, ajustes: ["correção obrigatória", ...], contexto: "informações extras" }',
  phases: [
    { title: 'Desenvolvimento', detail: 'engenheiro analisa, programa, testa e entrega (ou corrige)' },
    { title: 'QA', detail: 'QA sênior testa tudo; reprova volta para o engenheiro' },
    { title: 'Revisão', detail: 'tech lead revisa; reprova volta para o engenheiro' },
    { title: 'Registro', detail: 'marca a parte como feita no plano.txt e grava o relatório' },
  ],
}

// Orquestrador do ContabilizaDev: uma tarefa (parte do plano.txt) por execução.
// Fluxo: engenheiro → QA → tech lead. Se o QA ou o tech lead reprovar, os problemas voltam para o
// engenheiro e o ciclo recomeça, até o tech lead aprovar ou acabar o limite de ciclos.
// Cada agente segue o próprio papel em .claude/agents/ (engenheiro.md, qa.md, tech-lead.md).
// Regra: não existe aprovar com ressalva. Se o QA ou o tech lead aprovar deixando observações, o orquestrador
// trata como reprovação e devolve tudo ao engenheiro. A parte só é feita quando não sobra nada a apontar.
// `ajustes` (opcional): correções obrigatórias para refazer uma parte já entregue; entram junto com a tarefa.
// `contexto` (opcional): informações que não estão no plano (onde está uma referência, o que já está no ar…).

const RAIZ = '/home/vieiralucas/projects/git-repo/contabilizadev'
const entrada = typeof args === 'object' && args !== null ? args : { parte: args }
const parte = Number(entrada.parte)
if (!Number.isInteger(parte)) throw new Error('Informe a parte do plano: args = { parte: 1 }')
const maxCiclos = Number(entrada.maxCiclos) || 5
const data = entrada.data || null
const ajustes = Array.isArray(entrada.ajustes) ? entrada.ajustes.filter(Boolean) : []
const contexto = typeof entrada.contexto === 'string' ? entrada.contexto.trim() : ''

const papel = (arquivo) =>
  `Trabalhe em ${RAIZ}. Antes de qualquer coisa, leia o arquivo ${RAIZ}/.claude/agents/${arquivo} e siga esse papel à risca.`
const tarefa =
  `A tarefa é a PARTE ${parte} do ${RAIZ}/plano.txt (todos os passos dessa parte).` +
  (ajustes.length
    ? `\n\nEsta parte já foi entregue antes; nesta rodada são OBRIGATÓRIAS estas correções (todas devem estar feitas e testadas para aprovar):\n${ajustes.map((a, i) => `${i + 1}. ${a}`).join('\n')}`
    : '') +
  (contexto ? `\n\nContexto (informações que não estão no plano):\n${contexto}` : '')

const PROBLEMA = {
  type: 'object',
  properties: {
    gravidade: { type: 'string', enum: ['bloqueante', 'alta', 'media', 'baixa'] },
    arquivo: { type: 'string' },
    descricao: { type: 'string' },
    comoReproduzirOuCorrigir: { type: 'string' },
  },
  required: ['gravidade', 'descricao'],
}

const ENTREGA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['entregue', 'bloqueado'] },
    resumo: { type: 'string', description: 'O que foi feito nesta rodada' },
    arquivos: { type: 'array', items: { type: 'string' } },
    testes: { type: 'array', items: { type: 'string' }, description: 'Testes criados ou alterados' },
    verificacao: { type: 'string', description: 'Resultado de npm test, typecheck e lint' },
    respostaAosProblemas: { type: 'string', description: 'Como cada problema devolvido foi tratado (vazio na 1ª rodada)' },
    bloqueio: { type: 'string', description: 'Se bloqueado: exatamente o que falta para continuar' },
  },
  required: ['status', 'resumo', 'arquivos', 'verificacao'],
}

const PARECER = {
  type: 'object',
  properties: {
    aprovado: { type: 'boolean' },
    resumo: { type: 'string' },
    problemas: { type: 'array', items: PROBLEMA },
    verificacoes: { type: 'array', items: { type: 'string' }, description: 'O que foi executado/conferido' },
    testesCriados: { type: 'array', items: { type: 'string' } },
    observacoes: { type: 'array', items: { type: 'string' }, description: 'Deve ficar vazio: tudo o que for apontado vai em problemas (não existe aprovar com ressalva)' },
  },
  required: ['aprovado', 'resumo', 'problemas', 'verificacoes'],
}

const listarProblemas = (origem, problemas) =>
  problemas
    .map((p, i) => `${i + 1}. [${origem} · ${p.gravidade}] ${p.descricao}${p.arquivo ? ` (${p.arquivo})` : ''}${p.comoReproduzirOuCorrigir ? `\n   → ${p.comoReproduzirOuCorrigir}` : ''}`)
    .join('\n')

// Observações deixadas por quem aprovou viram problemas a corrigir (não existe aprovar com ressalva).
const semRessalva = (parecer) => {
  const pendentes = (parecer.observacoes || []).filter((o) => o && o.trim())
  if (!parecer.aprovado || pendentes.length === 0) return parecer
  return {
    ...parecer,
    aprovado: false,
    problemas: [...parecer.problemas, ...pendentes.map((o) => ({ gravidade: 'baixa', descricao: o }))],
    resumo: `${parecer.resumo} (aprovado com ressalvas; as ${pendentes.length} observações voltam ao engenheiro)`,
  }
}

const historico = []
let devolvidos = null // problemas da rodada anterior (QA ou tech lead)
let aprovacao = null
let bloqueio = null

for (let ciclo = 1; ciclo <= maxCiclos; ciclo++) {
  log(`Ciclo ${ciclo} de ${maxCiclos} — Parte ${parte}`)

  // 1. Engenheiro: entrega (1ª rodada) ou corrige o que foi devolvido.
  const pedidoDev = devolvidos
    ? `${papel('engenheiro.md')}\n${tarefa}\n\nSua entrega anterior foi REPROVADA pelo ${devolvidos.origem}. Corrija TODOS os problemas abaixo, rode npm test, npm run typecheck e npm run lint, e explique como tratou cada um:\n\n${listarProblemas(devolvidos.origem, devolvidos.problemas)}`
    : `${papel('engenheiro.md')}\n${tarefa}\n\nAnalise, programe, crie os testes unitários e entregue. Rode npm test, npm run typecheck e npm run lint antes de entregar.`
  const entrega = await agent(pedidoDev, { label: `engenheiro · ciclo ${ciclo}`, phase: 'Desenvolvimento', schema: ENTREGA })
  if (!entrega) throw new Error('O engenheiro não respondeu.')
  historico.push({ ciclo, etapa: 'engenheiro', ...entrega })
  if (entrega.status === 'bloqueado') {
    bloqueio = entrega.bloqueio || entrega.resumo
    log(`Engenheiro bloqueado: ${bloqueio}`)
    break
  }

  // 2. QA: testa tudo. Reprovou → volta para o engenheiro.
  const qa = await agent(
    `${papel('qa.md')}\n${tarefa}\n\nO engenheiro entregou (ciclo ${ciclo}):\n${JSON.stringify(entrega, null, 2)}\n\nTeste tudo e dê o parecer.`,
    { label: `QA · ciclo ${ciclo}`, phase: 'QA', schema: PARECER },
  )
  if (!qa) throw new Error('O QA não respondeu.')
  Object.assign(qa, semRessalva(qa))
  historico.push({ ciclo, etapa: 'QA', ...qa })
  if (!qa.aprovado) {
    log(`QA reprovou com ${qa.problemas.length} problema(s); volta para o engenheiro`)
    devolvidos = { origem: 'QA', problemas: qa.problemas }
    continue
  }

  // 3. Tech lead: revisa. Reprovou → volta para o engenheiro.
  const revisao = await agent(
    `${papel('tech-lead.md')}\n${tarefa}\n\nO engenheiro entregou (ciclo ${ciclo}):\n${JSON.stringify(entrega, null, 2)}\n\nO QA aprovou:\n${JSON.stringify(qa, null, 2)}\n\nRevise o código de verdade (leia os arquivos) e dê o parecer.`,
    { label: `tech lead · ciclo ${ciclo}`, phase: 'Revisão', schema: PARECER },
  )
  if (!revisao) throw new Error('O tech lead não respondeu.')
  Object.assign(revisao, semRessalva(revisao))
  historico.push({ ciclo, etapa: 'tech lead', ...revisao })
  if (!revisao.aprovado) {
    log(`Tech lead reprovou com ${revisao.problemas.length} problema(s); volta para o engenheiro`)
    devolvidos = { origem: 'tech lead', problemas: revisao.problemas }
    continue
  }

  aprovacao = { ciclo, entrega, qa, revisao }
  log(`Parte ${parte} aprovada no ciclo ${ciclo}`)
  break
}

// 4. Registro: relatório sempre; plano marcado como feito só se aprovada.
const situacao = aprovacao ? 'aprovada' : bloqueio ? 'bloqueada' : `não concluída em ${maxCiclos} ciclos`
const registro = await agent(
  `Trabalhe em ${RAIZ}. Registre o resultado da PARTE ${parte} do plano.txt (situação: ${situacao}).\n\n` +
    (aprovacao
      ? `1. No ${RAIZ}/plano.txt, a linha de título "PARTE ${parte} - ..." deve terminar com "  [FEITO em ${data || '<data de hoje no formato DD/MM/AAAA, pegue com o comando date>'}: <resumo de até 12 palavras do que foi entregue>]" (se já tiver um [FEITO ...], substitua). Não mexa em mais nada do arquivo.\n`
      : `1. NÃO marque a parte como feita no plano.txt${ajustes.length ? ' (se ela já estava marcada, deixe como está)' : ''}.\n`) +
    (ajustes.length
      ? `2. No relatório ${RAIZ}/docs/tarefas/parte-${parte}.md, mantenha o que já existe e ACRESCENTE no fim uma seção "Ajustes" com: a lista de correções pedidas, como cada uma foi resolvida, a tabela dos ciclos desta rodada e a situação. Remova da seção de pendências o que foi resolvido.`
      : `2. Escreva o relatório em ${RAIZ}/docs/tarefas/parte-${parte}.md (português, curto e objetivo): situação, resumo da entrega, arquivos, testes, e uma tabela com cada ciclo (engenheiro/QA/tech lead, aprovado ou não, problemas apontados e como foram resolvidos)`) +
    `${bloqueio ? ` Inclua o bloqueio: ${bloqueio}` : ''}.\n\nHistórico completo:\n${JSON.stringify(historico, null, 2)}\n\nResponda só com o caminho do relatório.`,
  { label: 'registro', phase: 'Registro', effort: 'low' },
)

return {
  parte,
  situacao,
  ciclos: historico.filter((h) => h.etapa === 'engenheiro').length,
  relatorio: registro,
  bloqueio,
  resumo: aprovacao ? aprovacao.entrega.resumo : null,
  ajustes,
  pendencias: !aprovacao && devolvidos ? devolvidos.problemas : [],
}
