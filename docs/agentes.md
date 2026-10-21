# Time de agentes (Claude Code)

Cada parte do `plano.txt` é entregue por três agentes, definidos em `.claude/agents/`:

- `engenheiro.md` — engenheiro full stack: analisa, programa, cria os testes unitários e entrega (e corrige o
  que for devolvido).
- `qa.md` — QA sênior: testa tudo (inclusive casos de borda, com testes `*.qa.test.ts`) e aprova ou devolve.
- `tech-lead.md` — revisa o código depois do QA e aprova ou devolve.

O orquestrador `.claude/workflows/entregar-tarefa.js` roda o ciclo em loop: engenheiro → QA → tech lead.
Reprovou no QA ou no tech lead, os problemas voltam para o engenheiro. Aprovado pelo tech lead, a parte é
marcada como feita no `plano.txt` e o relatório fica em `docs/tarefas/parte-N.md`. Limite padrão: 5 ciclos.

Regra: **não existe aprovar com ressalva**. Tudo o que o QA ou o tech lead apontar, de qualquer gravidade, volta
para o engenheiro (o orquestrador transforma observações em problemas). Para refazer uma parte já entregue,
passe `ajustes` com as correções obrigatórias.

Para rodar, peça ao Claude Code: "rode o workflow entregar-tarefa para a parte 1"
(args: `{ "parte": 1, "data": "16/10/2026", "maxCiclos": 5, "ajustes": ["..."] }`).
