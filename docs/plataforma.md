# Plataforma (`plataforma/`)

- `app/entrar/` — tela de entrada com o botão do Google (única rota aberta sem sessão quando o login está ligado).
- `app/sessao-local/` — com o login desligado (desenvolvimento), abre sozinha a sessão da conta de desenvolvimento e
  volta ao painel.
- `app/(painel)/` — a aplicação (tudo o que exige sessão): layout com a barra lateral, a barra de cima (empresa ativa,
  com troca e o atalho "Cadastrar outra empresa", e menu do usuário com Sair e, para MANAGER e ADMIN, "Área do
  administrador") e as abas da empresa. Nada de administração aqui.
- `app/admin/` — **área do administrador** (`/admin`), separada da aplicação: layout e barra lateral próprios
  ("Administração", sem seletor de empresa nem sino, com "Voltar para a aplicação"). Páginas e quem vê cada uma em
  `lib/admin.ts`; o layout confere a entrada (`exigirEntradaNaAreaDoAdmin`: COMMON_USER recebe 404) e cada página e
  cada ação começam por `exigirAreaDoAdmin(endereço)`. Visão geral (`/admin`, só ADMIN: os avisos da plataforma, o banco
  de dados e os atalhos; o MANAGER que abre `/admin` vai para `/admin/usuarios`), Usuários (`/admin/usuarios`, a única
  página do MANAGER; ADMIN também), Certificado da plataforma (`/admin/plataforma`, só ADMIN), Custos (`/admin/custos`,
  só ADMIN) e Plano do projeto (`/admin/plano`, só ADMIN). Os endereços antigos (`/usuarios`, `/config/plataforma`, `/plano`) redirecionam (308).
  O Plano do projeto lê o `plano.txt` a cada acesso (`lib/plano.ts`, a única fonte) e tem duas abas, com a aba no
  endereço: Plano (introdução, partes e as listas — MVP, Backlog, Decisões; título de lista em maiúsculas, com um
  complemento opcional em minúsculas entre parênteses no fim, como `BACKLOG (fora do plano por enquanto)`) e Segurança
  (`?aba=seguranca`: a seção `SEGURANÇA`, que não aparece na aba Plano — o parágrafo inicial e cada item
  `- [Alta|Média|Baixa|Decisão] texto`, com a continuação recuada, como uma linha com o selo da gravidade, na ordem do
  arquivo e com a contagem no topo; o item que termina com `[FEITO em DD/MM/AAAA: resumo]` aparece como Feito e conta à
  parte). Qualquer outro `?aba=` cai em Plano. O desenho fica em `app/admin/plano/conteudo.tsx`.
- `app/abas-da-pagina.tsx` — o componente único de abas de página (`<AbasDaPagina rotulo abas atual />`), usado em
  Avisos e mensagens e no Plano do projeto: links com a aba no endereço, `aria-current` na atual e selo de contagem
  opcional (acima de 99 vira `99+`). Página nova com abas usa este componente, nunca um `<nav>` copiado.
- `app/explicacao.tsx` — o tooltip único da aplicação (`<Explicacao>` e `<ExplicacaoDoTermo>`): toda explicação vai
  nele (ⓘ discreto ou o próprio termo sublinhado), nunca num parágrafo aberto. Abre ao passar o mouse, ao focar com Tab
  e ao tocar; fecha com Esc, clique fora ou Tab. Regras de abrir/fechar e de posição em `lib/explicacao.ts`.
- `app/(painel)/empresas/nova/` — cadastro pelo CNPJ como assistente que ensina, uma etapa por tela (trilha enxuta
  "Passo N de 7 · Nome" com barra fina e `aria-current`, Voltar/Continuar sem perder o que foi preenchido, foco no
  título a cada etapa). Cada etapa mostra uma frase curta e os dados; as explicações ficam nos tooltips:
  1) pesquisar o CNPJ (o que é, onde encontrar, alfanumérico); 2) conferir a empresa, cada dado com o ⓘ;
  3) atividades (CNAE e anexo de cada uma); 4) Simples Nacional e MEI; 5) diagnóstico (anexo, exemplo numérico do
  Fator R) e confirmação: quem cadastra vira DONO e a empresa passa a ser a ativa; 6) empresa cadastrada (o que foi
  feito e o que vem a seguir, Continuar); 7) **Autorização**, opcional: o mesmo fluxo da página Autorização (requisitos,
  certificado e senha, texto oficial, assinar no navegador e enviar), com os mesmos componentes e ações de
  `app/(painel)/autorizacao/`; "Fazer depois" leva ao painel e a empresa fica no modo guiado; assinado, mostra
  "Autorização concluída" e "Ir para o painel". A empresa da própria plataforma já aparece autorizada no passo 7.
  Depois do cadastro, voltar mostra os passos 1 a 5 só para leitura (nada é pesquisado nem cadastrado de novo).
  Empresa que ainda não atendemos não é cadastrada: o assistente termina no passo 6 de 6 ("O que fazer"), sem
  autorização. Regras das etapas em `lib/empresas/assistente.ts`; termos explicados (tooltip) em
  `lib/empresas/glossario.ts`.
- `app/(painel)/empresa/` — dados da Receita e diagnóstico da empresa ativa, com o botão "Atualizar dados".
- `app/(painel)/autorizacao/` — página **Autorização** (`/autorizacao`; o endereço antigo `/automatico` redireciona
  com 308, `lib/redirecionamentos.ts` no `next.config.ts`): situação da autorização, os requisitos (e-CNPJ A1 e gov.br
  prata ou ouro) e a assinatura do termo no navegador, com o texto oficial por inteiro antes de assinar (abaixo). Serve
  para autorizar depois do cadastro, renovar ("Assinar de novo") e ver a situação.
  O sino da barra de cima (`app/(painel)/sino-navegador.tsx` e `sino-visual.tsx`, com os avisos da central em `lib/avisos`) e o painel avisam quando o termo vence em 30 dias ou menos, venceu
  ou foi recusado. `app/(painel)/faca-no-portal.tsx` é o aviso do modo guiado.
- `app/admin/plataforma/` — **Certificado da plataforma**, na área do administrador, só ADMIN
  (`exigirAreaDoAdmin("/admin/plataforma")`: MANAGER, COMMON_USER e o login desligado sem ser ADMIN recebem 404; o serviço
  confere de novo e recusa com 403). Mostra também a situação da integração (Receita Federal, eSocial e a assinatura do
  termo de autorização, com o motivo técnico). Veja "Certificado da plataforma" abaixo.
- `app/admin/custos/` — **Custos**, na área do administrador, só ADMIN (`exigirAreaDoAdmin("/admin/custos")`; MANAGER e
  COMMON_USER recebem 404): o **custo por cliente** das chamadas ao Serpro, lido só de `serpro_chamadas` (a tela nunca
  chama Serpro, BrasilAPI nem eSocial). Cálculo em `lib/serpro/custos.ts`:
  - período de cobrança do Serpro, do dia 21 às 00:00 ao dia 21 seguinte às 00:00 no horário de Brasília
    (`periodoDe`, `limitesDoPeriodo` e `inicioDoPeriodo` em `nucleo/src/serpro/precos.ts`, iguais em qualquer fuso do
    servidor). O seletor (formulário GET, `?periodo=AAAA-MM-21` ou `?periodo=inicio`) lista o período atual e os
    anteriores que tiveram chamadas, mais "Desde o início"; valor inválido ou período sem chamadas abre o atual;
  - uma linha por empresa (razão social e CNPJ), com as chamadas cobradas por tipo (Consulta, Emissão, Declaração, pelo
    `TIPO_DA_ACAO`; "Autenticar" não é cobrada e não entra) e o custo; as chamadas anonimizadas de empresas removidas
    (sem `empresa_id` e sem contribuinte) ficam juntas em "Empresas removidas"; as feitas sem contribuinte
    (`sem_contribuinte`, gravado pelo registro) em "Plataforma (sem empresa)". A empresa da plataforma é uma linha
    como as outras. Do maior custo para o menor (empate: mais chamadas, depois uma ordem fixa);
  - o preço é o da faixa em que caiu o **total do tipo no período** (todos os clientes somados), como o Serpro cobra:
    custo do cliente = Σ por tipo de quantidade × `precoUnitario(tipo, total do tipo)`. A soma das linhas é o
    `custoMensal` do período. "Desde o início" calcula período a período (cada um na sua faixa) e soma. A coluna
    `custo` gravada na hora da chamada (que ainda não sabia o total do mês) não entra;
  - arredondamento: os preços da tabela são centavos inteiros, então o custo é calculado em centavos inteiros
    (quantidade × preço em centavos), sem arredondar; a soma das linhas é exatamente o total (linha de soma ao pé da
    tabela, pelo `rodape` de `app/tabela.tsx`). Recusas podem não ser cobradas pelo Serpro (dito no tooltip).
  Abaixo da tabela por cliente, sem depender do seletor (`custosMensais` e `calcularCustosMensais`, mesmos grupos
  de chamadas cobradas):
  - **Custo total**: cartão de linhas (como no `../fiscal/app/config/serpro/page.tsx`) com o custo do período atual
    até agora, o custo desde a primeira chamada e a quantidade de chamadas cobradas;
  - **Custo mensal**: tabela com paginação, uma linha por período de cobrança com chamadas cobradas mais o período
    atual (mesmo vazio), do mais recente ao mais antigo, com a quantidade e o preço da faixa (`centavosDaFaixa` pelo
    total do tipo no período) de Consulta, Emissão e Declaração, e o custo do período; linha de soma ao pé. Período só
    com "Autenticar" não vira linha. A soma dos meses é o total e o "Desde o início" por cliente; cada mês é a soma
    dos clientes no período (testes em `testes/custos-mensais.test.ts`). Empresas removidas e a plataforma entram.
  Sem projeção, limite do contrato nem custos que não sejam do Serpro.
- `app/api/sessao` — quem está logado e a empresa ativa (401 sem sessão).
- `app/ui.tsx`, `app/tabela.tsx`, `app/barra-lateral.tsx`, `app/graficos.tsx` (barras com Chart.js, carregado sob
  demanda) e o tema em `app/globals.css` — a parte visual reaproveitada do `../fiscal`.
- `lib/autenticacao/` — login com Google e sessão (abaixo); `lib/empresas/` — empresas e o acesso ao dado de cliente;
  `lib/usuarios/` — gestão de usuários; `lib/termo/` — termo de autorização e modo guiado (abaixo); `lib/serpro/` —
  configuração do contrato (CNPJ da plataforma, credenciais e certificado) e registro das chamadas; `lib/plataforma/` —
  certificado e chaves da plataforma guardados pelo ADMIN (`segredos.ts`), a montagem no servidor (`servidor.ts`) e o
  aviso do sino (`aviso.ts`). Nada disso depende do Next (menos os `servidor.ts`): banco e configuração entram por parâmetro.
- `proxy.ts` — primeira barreira (sem cookie assinado: página vai para `/entrar`, ou para `/sessao-local` com o login
  desligado; API recebe 401).
- `instrumentation.ts` — valida a configuração do login, a `TOKEN_CHAVE` e a `PLATAFORMA_CHAVE` quando o servidor sobe
  (ausentes, inválidas ou as duas chaves iguais derrubam a subida) e avisa no log se faltar o `PLATAFORMA_CNPJ`, a razão
  social da plataforma ou a configuração do contrato (certificado e chaves, do banco ou do ambiente).
