# Empresas e cadastro

## Empresas e isolamento dos dados

- `empresas` (CNPJ, já aceitando o alfanumérico) e `empresa_usuarios` (vínculo com o papel na empresa: `DONO` ou
  `MEMBRO`). Um usuário pode ter várias empresas; a ativa fica na sessão e é conferida contra o vínculo a cada requisição.
- Toda tabela de dado de cliente tem `empresa_id` (o teste `banco/esquema.test.ts` falha se uma tabela nova não tiver)
  e é lida e gravada só por `lib/empresas/acesso.ts`: `exigirAcessoEmpresa` confere o vínculo e devolve o acesso, e
  `dadosDaEmpresa(banco, acesso)` lista, insere, altera e apaga sempre filtrando pela empresa do acesso.
- O ADMIN da plataforma também precisa de vínculo para ver o dado de uma empresa.
- Barra lateral (`app/barra-lateral.tsx`, grupos e ordem em `lib/abas.ts`): grupo "Empresa" com as abas do dia a dia
  (Painel do mês, Roteiro, Guias, Histórico, Situação fiscal, Declaração anual); grupo "Configuração" no fim (Dados da
  empresa, Autorização, eSocial; toda configuração nova entra aqui). Avisos e mensagens abrem pelo sino (`/avisos`). O que
  é de administração fica na área `/admin`, com a própria barra, aberta pelo menu do usuário.
- Acesso em camadas (`lib/empresas/portao.ts`): a barra lateral mostra sempre todas as abas (lista em `lib/abas.ts`),
  mas toda página de aba de empresa começa por `exigirConteudo()` (`portao-servidor.ts`), que decide entre
  `sem-empresa` (estado vazio da aba com "Cadastrar empresa"), `sem-plano` (estado vazio com "Escolher um plano",
  que leva a `/planos`) e `liberado`, o único caminho que entrega o `AcessoEmpresa` para ler dados. As server actions
  usam `exigirAcessoAoConteudo`. A exigência de plano tem um ponto só, `planoAtivo(empresa)`, que hoje sempre libera
  (a cobrança chega na Parte 9). O termo de autorização (autorizada ou modo guiado) é outra camada, depois do portão.

## Cadastro pelo CNPJ e dados da Receita

- `lib/empresas/cadastro.ts`: `consultarParaCadastro` confere o CNPJ, olha o banco primeiro (CNPJ já cadastrado não gasta
  consulta: quem tem vínculo passa a usar a empresa; os outros recebem "peça acesso ao dono") e só então consulta a
  BrasilAPI. Devolve os dados, o diagnóstico e uma prévia assinada (HMAC com `SESSAO_SEGREDO`, presa ao usuário, vale 30
  minutos). `cadastrarPelaPrevia` cria a empresa com `criarEmpresa` (CNPJ duplicado tratado) e guarda a consulta: os dados
  gravados são os que vieram da BrasilAPI, sem nova consulta e sem confiar no navegador.
- `lib/empresas/receita.ts` (sempre pela porta `acesso.ts`): cada consulta vira uma linha em `consultas_cnpj` (CNAEs,
  situação, Simples/MEI e os dados completos, com o diagnóstico do dia). `dadosDaReceita` usa a do banco enquanto tiver
  até 30 dias; vencida ou ausente, consulta de novo e guarda. "Atualizar dados" força a consulta, mas não repete em menos
  de 5 minutos. Se a BrasilAPI falhar, a tela mostra a última consulta guardada com o erro. A razão social da empresa
  acompanha a da Receita.
