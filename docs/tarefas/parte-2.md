# Parte 2: banco, login, usuários e empresas

## Situação

**Concluída em 21/10/2026.** Aprovada pelo QA e pelo tech lead no ciclo 2 da sétima rodada de ajustes (abas Plano e Segurança). Não há pendências (ver seções Ajustes).

## Resumo da entrega

- **Banco (passo 8):** tabelas `usuarios`, `empresas` (CNPJ que aceita o alfanumérico), `empresa_usuarios` (DONO/MEMBRO) e `sessoes` (só o hash do token). Migração `0001_usuarios_empresas_sessoes.sql`.
- **Login e autorização (passo 9), portados do horizons:** o ID token do Google é conferido no servidor (audience e `email_verified`), e o `sub` fica preso ao e-mail (conferido no próprio upsert, junto com `ativo` e o MANAGER da linha existente, sem leitura prévia nem janela entre ler e gravar). A sessão vai em cookie httpOnly, Lax (Secure e `__Host-` em produção), assinado com HMAC e guardado como hash. O `SESSAO_SEGREDO` é validado na subida. O acesso é fechado por padrão (proxy, `exigirSessao`, `exigirGestao`, `comSessao`) e o destino depois do login é protegido. O papel é recalculado com `papelPara(email, coluna, ADMIN_EMAILS)` a cada requisição e também na gestão de usuários. `AUTH_DISABLED` só vale fora de produção. A gestão de usuários fica em `/usuarios`.
- **Empresas (passo 10):** a porta única é `lib/empresas/acesso.ts`. O acesso é congelado e conferido pela identidade num WeakSet, e todas as consultas filtram por `empresa_id`. A empresa ativa fica na sessão.
- **Visual (passo 11):** página `/entrar` com o botão do Google, barra com a empresa ativa ou "Nenhuma empresa cadastrada", seletor de empresa, menu do usuário com Sair e gráfico de barras genérico (Chart.js).
- **Docker** lê o `plataforma/.env.local`. O README traz o passo a passo do Client ID do Google.

## Arquivos principais

- `plataforma/banco/` (`esquema.ts`, `index.ts`, `migracoes/0001_*`)
- `plataforma/lib/autenticacao/` (`config`, `papeis`, `cookie`, `google`, `rotas`, `servico`, `servidor`)
- `plataforma/lib/empresas/` (`acesso`, `cnpj`, `servico`), `plataforma/lib/usuarios/servico.ts`
- `plataforma/proxy.ts`, `plataforma/instrumentation.ts`
- `plataforma/app/(painel)/*`, `plataforma/app/entrar/*`, `plataforma/app/api/sessao/route.ts`, `plataforma/app/grafico-barras.tsx`
- `README.md`, `.env.exemplo`, `docker/*`, `package.json`

## Testes

- `npm test` na raiz: **núcleo 161/161, plataforma 173/173**. `typecheck` e `lint` passam sem erros.
- Os testes de integração rodam num Postgres separado (`contabilizadev_teste`, e qualquer banco sem o sufixo `_teste` é recusado). O Google é sempre um verificador falso.
- Testes do QA no projeto: `cookie.qa.test.ts`, `empresas.qa.test.ts`, `papel-efetivo.qa.test.ts`, `papel-efetivo-2.qa.test.ts`, `conta-desativada.qa.test.ts`, `papel-login-corrida.qa.test.ts`.

## Ciclos

| Ciclo | Etapa | Resultado | Problemas apontados | Como foram resolvidos |
|---|---|---|---|---|
| 1 | Engenheiro | Entregue | — | Passos 8 a 11 completos |
| 1 | QA | Reprovado | (alta) Redirecionamento aberto com TAB em `destinoSeguro`; (média) `AcessoEmpresa` falsificável com spread | Ciclo 2 |
| 2 | Engenheiro | Entregue | — | Recusa de todo caractere de controle e exigência da mesma origem; WeakSet com objeto congelado no lugar da marca Symbol |
| 2 | QA | Aprovado | — | — |
| 2 | Tech lead | Reprovado | (alta) Papel da sessão vinha da coluna, e `ADMIN_EMAILS` só era reavaliada no login | Ciclo 3 |
| 3 | Engenheiro | Entregue | — | `resolverSessao` recalcula o papel com `papelPara` e corrige a coluna; README ajustado |
| 3 | QA | Reprovado | (alta) A gestão de usuários ainda lia a coluna crua (MANAGER conseguia desativar um ADMIN da lista) | Ciclo 4 |
| 4 | Engenheiro | Entregue | — | Lista, `mudarPapel` e `mudarAtivo` recebem `adminEmails` e usam o papel efetivo |
| 4 | QA | Aprovado | — | — |
| 4 | Tech lead | Reprovado | (baixa) Dois comentários desatualizados; (baixa) login recusado de conta desativada gravava o último login | Ciclo 5 |
| 5 | Engenheiro | Entregue | — | Comentários corrigidos; `ativo` conferido antes do upsert em `entrarComGoogle` |
| 5 | QA | Reprovado | (baixa) Mesmo defeito em `entrarSemLogin` | Ciclo 6 |
| 6 | Engenheiro | Entregue | — | Update condicionado a `ativo = true` com `returning` |
| 6 | QA | Aprovado | — | — |
| 6 | Tech lead | Reprovado | (média) Corrida em `criarEmpresa`; (baixa) intervalo em `entrarComGoogle`; (baixa) regra de gestão duplicada no menu | Resolvidos na rodada de ajustes (ver Ajustes) |

## Ajustes

### Correções pedidas

1. **[média]** Corrida em `criarEmpresa` com dois cadastros simultâneos do mesmo CNPJ (tech lead, ciclo 6).
2. **[baixa]** Intervalo entre ler `ativo` e o upsert em `entrarComGoogle` (tech lead, ciclo 6).
3. **[baixa]** Regra de gestão duplicada em `app/(painel)/menu-usuario.tsx` (tech lead, ciclo 6).
4. **Sem login localmente:** em desenvolvimento a plataforma deve abrir sem tela de login.
5. **[baixa]** O `sub` preso ao e-mail ainda era conferido num select separado do upsert (tech lead, ajustes ciclo 1).
6. **[baixa]** Helper `entrar(abrir, de)` sem uso em `app/entrar/acoes.ts` e linha em branco solta em `app/entrar/page.tsx` (tech lead, ajustes ciclo 1).
7. **[média]** O papel lido antes do upsert era regravado no login, desfazendo um rebaixamento ou promoção feito no meio (QA, ajustes ciclo 2).

### Como cada uma foi resolvida

1. Um único `insert(...).onConflictDoNothing({ target: empresas.cnpj }).returning()`; sem linha de volta, lança `ErroDeEmpresa`. `testes/empresas.qa.test.ts` repete a corrida 20 vezes.
2. `onConflictDoUpdate` com `setWhere: eq(usuarios.ativo, true)` e `returning`; sem linha, `ErroDeLogin('Esta conta foi desativada.')`. Teste com o novo helper `antesDoInsert` desativa a conta entre a leitura e o upsert.
3. O layout calcula `gestao = ehGestao(usuario.papel)` e passa o mesmo valor à `BarraLateral` e ao `MenuUsuario`.
4. Com `AUTH_DISABLED=true` fora de produção, o proxy manda quem não tem cookie para `/sessao-local`, um route handler que chama `entrarSemLogin`, grava o cookie httpOnly e volta ao destino seguro. `/entrar` e Sair também voltam ao painel; cookie inválido abre sessão nova; conta de dev desativada dá 403 sem loop. O botão "Entrar como..." foi removido. Em produção `/sessao-local` é fechada e `AUTH_DISABLED` é ignorado. README e `.env.exemplo` documentados. Testes: `rotas.test.ts`, `proxy.test.ts`, `sessao-local.test.ts`, `sessao-local.qa.test.ts`.
5. A regra foi para o `setWhere` do upsert: `and(ativo = true, or(provedor <> 'GOOGLE', provedorId is null, provedorId = sub))`. Sem linha, relê só para escolher a mensagem. Testes: troca de `provedorId` na janela e 20 rodadas de dois logins Google simultâneos com o mesmo e-mail.
6. O corpo do helper foi incorporado a `entrarComGoogleAcao` (redirect fora do try) e a linha em branco removida.
7. Saiu o select prévio: o papel é decidido no `set` do upsert — `'ADMIN'` se o e-mail está em `ADMIN_EMAILS`, senão `CASE WHEN usuarios.papel = 'MANAGER' THEN 'MANAGER' ELSE 'COMMON_USER' END` sobre a linha do banco. Testes: `papel-login-corrida.qa.test.ts` e `papel-login-casos.qa.test.ts`.

### Ciclos desta rodada

| Ciclo | Etapa | Resultado | Problemas apontados | Como foram resolvidos |
|---|---|---|---|---|
| 1 | Engenheiro | Entregue | — | Correções 1 a 4 |
| 1 | QA | Aprovado | — | — |
| 1 | Tech lead | Reprovado | (baixa) `sub` conferido fora do upsert; (baixa) helper `entrar` sem uso e linha em branco | Ciclo 2 |
| 2 | Engenheiro | Entregue | — | Correções 5 e 6 |
| 2 | QA | Reprovado | (média) Papel antigo regravado no login | Ciclo 3 |
| 3 | Engenheiro | Entregue | — | Correção 7 |
| 3 | QA | Aprovado | — | — |
| 3 | Tech lead | Aprovado | — | — |

### Situação

**Aprovada.** `npm test` na raiz: núcleo 161/161, plataforma 198/198; `typecheck` e `lint` sem erros. Parte 2 marcada como FEITO em 16/10/2026 no `plano.txt`.

## Ajustes (rodada 2: acesso em camadas)

### Correções pedidas

1. **Acesso em camadas:** o usuário logado vê todas as abas na barra lateral, mas o conteúdo de cada aba de empresa só aparece quando ele tem uma empresa cadastrada (e, futuramente, um plano). Nada de redirect para `/empresas/nova`.
2. **Mecanismo reutilizável no servidor:** um portão único com os estados sem-empresa, sem-plano e liberado, com um ponto único para a checagem de plano (Parte 9).
3. **Teste que faltava:** o mesmo usuário com zero empresas, depois duas, alternando a ativa com dados isolados.
4. **[baixa]** A engrenagem (Configuração) da barra de cima levava a `/config`, que dava 404 (QA, ciclo 1).

### Como cada uma foi resolvida

1. `app/(painel)/portao.tsx` (`PortaoFechado` e `AbaEmConstrucao`) e `lib/abas.ts` (`ABAS_DA_EMPRESA`, lista única com descrições). `/`, `/empresa` e `/automatico` usam `exigirConteudo` e mostram o estado vazio com o botão "Cadastrar empresa"; os redirects saíram. As abas futuras (`/roteiro`, `/guias`, `/historico`, `/defis`, `/situacao`), que davam 404, ganharam página com o portão. `/planos` foi criada ("em breve"). A barra lateral monta todas as abas sem filtrar, e o sino só é calculado com o portão liberado.
2. `lib/empresas/portao.ts`: `abrirPortao` confere o vínculo no banco antes do plano, e o `AcessoEmpresa` só sai no caminho liberado. `planoAtivo(empresa)` hoje devolve true (comentário apontando a Parte 9) e pode ser injetado em testes. `exigirAcessoAoConteudo` (lança `SemPlanoAtivo`) protege as server actions "Atualizar dados" e "Verificar agora". `lib/empresas/portao-servidor.ts`: `exigirConteudo()` com cache por requisição. A procuração ficou como camada seguinte.
3. `testes/portao.test.ts` (Postgres de teste): zero empresas resulta em portão fechado, duas chamadas a `criarEmpresa` aparecem como DONO, a ativa alterna Alfa, Beta, Alfa com dados isolados, e o plano é por empresa. QA acrescentou `testes/portao.qa.test.ts` (6 casos).
4. Criada `app/(painel)/config/page.tsx`, página de conta fora do portão (exige só a sessão), com "Em breve", o e-mail da conta e atalhos. Um teste em `testes/portao-telas.test.ts` confere que todo link fixo da barra lateral, da barra de cima e do menu do usuário tem `page.tsx`.

### Ciclos desta rodada

| Ciclo | Etapa | Resultado | Problemas apontados | Como foram resolvidos |
|---|---|---|---|---|
| 1 | Engenheiro | Entregue | — | Correções 1 a 3 |
| 1 | QA | Reprovado | (baixa) `/config` da engrenagem dava 404 | Ciclo 2 |
| 2 | Engenheiro | Entregue | — | Correção 4 |
| 2 | QA | Aprovado | — | — |
| 2 | Tech lead | Aprovado | — | — |

### Situação

**Aprovada.** `npm test`: 385/385 na plataforma (núcleo 249/249); `typecheck` e `lint` sem erros. Curl com sessão local e sem empresa: todas as abas de empresa respondem 200 sem redirect, com o estado vazio; `/config` e `/planos` respondem 200. Parte 2 marcada como FEITO em 17/10/2026 no `plano.txt`. Sem pendências.

## Ajustes (rodada 3: remover empresa)

### Correções pedidas

1. **Remover uma empresa só do banco da plataforma** (passos 1 a 9): só o DONO, confirmação pelo CNPJ, apagar toda tabela com `empresa_id`, trocar a empresa ativa, log só com ids e hora, nada feito na Receita.
2. **Passo 5, gasto das chamadas ao Serpro (`serpro_chamadas`):** é gasto interno da plataforma, não cobrança do cliente (o cliente paga só o plano mensal ou anual por empresa, passo 24). O comentário antigo dizia que o CNPJ continuava; a linha precisa ficar anonimizada.
3. **Passo 6:** tooltip deve dizer que nada é apagado nem cancelado na Receita e que a plataforma apaga a cópia do termo.
4. **[alta] (QA, ciclo 1)** Corrida entre a remoção e o envio do termo: o envio chamava o Serpro para empresa já apagada e quebrava com 23503.
5. **[média] (QA, ciclo 1)** Remover uma empresa que não era a ativa (aba antiga) trocava a empresa ativa da sessão.
6. **[média] (QA, ciclo 2)** Corrida entre a remoção e "Atualizar dados": `salvarConsulta` lançava erro genérico com o CNPJ da empresa removida e a tela quebrava.

### Como cada uma foi resolvida

1. `lib/empresas/remocao.ts` (`removerEmpresa`): DONO conferido pela porta de acesso e de novo dentro da transação com a empresa travada; CNPJ aceito com ou sem pontuação; lista de tabelas tirada do esquema. Tela: seção "Remover empresa" no fim de `/empresa`, `<dialog>` acessível, redireciona para `/empresa?removida=1`.
2. Ao remover, `serpro_chamadas` fica com `empresa_id` e `contribuinte` nulos, mensagens vazias e CNPJ tirado da finalidade; ficam data, tipo, serviço, status e custo. Comentários de `banco/esquema.ts` e `lib/serpro/registro.ts` corrigidos. O registro de chamada só guarda CNPJ de empresa cadastrada e regrava sem ela no erro 23503. Também corrigido um travamento antigo (FOR UPDATE virou FOR NO KEY UPDATE). Migração 0007 aplicada (8 de 8).
3. Texto do tooltip ajustado em `remover-empresa.tsx`.
4. `travarEmpresa` em `lib/termo/termo.ts`: trava a empresa e lança `SemAcessoEmpresa` se ela sumiu, antes da chamada paga; usada em `registrarTermo` e `contextoSerpro`.
5. O update das sessões usa `returning`; só troca a ativa de quem removeu se ela apontava para a empresa removida (campo `ativaMudou`).
6. `salvarConsulta` (`lib/empresas/receita.ts`) grava numa transação com FOR NO KEY UPDATE; empresa sumida vira `SemAcessoEmpresa` ("Empresa não encontrada.", sem CNPJ), e `dadosDaReceita` devolve erro curto. O erro de CNPJ diferente ficou só para CNPJ realmente diferente.

### Ciclos desta rodada

| Ciclo | Etapa | Resultado | Problemas apontados | Como foram resolvidos |
|---|---|---|---|---|
| 1 | Engenheiro | Entregue | — | Correções 1 a 3 |
| 1 | QA | Reprovado | (alta) corrida remoção x termo; (média) ativa trocada sem motivo | Ciclo 2 |
| 2 | Engenheiro | Entregue | — | Correções 4 e 5 |
| 2 | QA | Reprovado | (média) corrida remoção x "Atualizar dados" | Ciclo 3 |
| 3 | Engenheiro | Entregue | — | Correção 6 |
| 3 | QA | Aprovado | — | — |
| 3 | Tech lead | Aprovado | — | — |

### Situação

**Aprovada.** `npm test`: núcleo 267/267, plataforma 560/560; `typecheck` e `lint` sem erros; `banco:migrar` funciona no banco atual e do zero. Parte 2 marcada como FEITO em 18/10/2026 no `plano.txt`. Sem pendências.

## Ajustes (rodada 4: área do administrador)

### Correções pedidas

1. **Separar a área do administrador da aplicação comum:** criar `/admin`, com layout e barra próprios, e levar para lá tudo o que é de administração. O acesso deve ser conferido no servidor.
2. **Estado quebrado deixado por outra sessão:** fazer os testes passarem de novo, mantendo a mudança do sino (Avisos e Mensagens).
3. **[baixa] (QA, ciclo 1)** O `.env.exemplo` e alguns comentários ainda citavam `/config/plataforma`, `/plano` e `/usuarios`.
4. **[baixa] (QA, ciclo 1)** O MANAGER via a Visão geral (`/admin`), cujo texto revelava as páginas só do ADMIN; plano.txt e engenheiro.md não batiam com o código.
5. **[baixa] (QA, ciclo 2)** O aviso do certificado da plataforma entrava na conta do sino, mas não aparecia na página `/avisos`.
6. **[baixa] (tech lead, ciclo 3)** A tabela de `/avisos` tinha o rótulo fixo "Avisos da empresa", mesmo quando mostrava avisos da plataforma.

### Como cada uma foi resolvida

1. Rotas em `app/admin` com layout próprio (barra "Administração", faixa de cor, "Voltar para a aplicação", sem seletor de empresa, sino nem engrenagem). Lista única em `lib/admin.ts`, fechada por padrão. Barreiras no servidor: `exigirEntradaNaAreaDoAdmin` no layout e `exigirAreaDoAdmin(href)` em cada página e ação (substituem `exigirGestao` e `exigirAdmin`). COMMON_USER recebe 404; MANAGER vê só Usuários; ADMIN vê tudo. Movidos: `/usuarios` → `/admin/usuarios`, `/config/plataforma` → `/admin/plataforma` (com a situação da integração), `/plano` → `/admin/plano`, com redirects 308 (`lib/redirecionamentos.ts`). Também saíram da aplicação comum o estado do banco e o atalho do plano do painel, o botão do certificado em `/config` e o quadro "Só para administradores" da autorização. Entrada pelo item "Área do administrador" do menu do usuário. plano.txt (DECISÕES "Barra lateral"), engenheiro.md e README atualizados.
2. Os testes citados já passavam; a única falha era instável em `lib/assinador/assinador.test.ts` (o base64 do PEM continha "PfX" por acaso) e foi corrigida. A mudança do sino (página `/avisos` com abas, `/mensagens` redirecionando) foi mantida e documentada.
3. `.env.exemplo` (linhas 33 e 48) e os comentários de `instrumentation.ts`, `banco/esquema.ts`, `lib/plano.ts` e `lib/autenticacao/servico.ts` passaram a citar os endereços novos.
4. A Visão geral ficou só do ADMIN. `inicioDoAdmin(papel)` leva cada papel à sua primeira página (MANAGER → `/admin/usuarios`), no menu, na barra e no redirect do servidor. Tooltip sem menção às páginas só do ADMIN; documentação alinhada.
5. Nova `avisosDoAdminPara(papel, agora)` em `lib/plataforma/servidor.ts`, usada pelo layout do painel (sino) e pela página `/avisos`, que junta os avisos com ou sem empresa liberada.
6. `ListaDeAvisos` recebe `rotulo`, calculado por `rotuloDosAvisos` (`lib/avisos/central.ts`): "Avisos da empresa", "Avisos da plataforma" ou "Avisos da empresa e da plataforma". A explicação da página ganhou, só para o ADMIN, a frase sobre os avisos da plataforma.

### Ciclos desta rodada

| Ciclo | Etapa | Resultado |
|---|---|---|
| 1 | Engenheiro | Área `/admin` criada, itens movidos, redirects 308, teste instável corrigido |
| 1 | QA | Reprovado: `.env.exemplo`/comentários antigos; MANAGER na Visão geral |
| 2 | Engenheiro | Documentação atualizada; MANAGER só Usuários (`inicioDoAdmin`) |
| 2 | QA | Reprovado: aviso do ADMIN contado no sino e ausente de `/avisos` |
| 3 | Engenheiro | `avisosDoAdminPara` compartilhada entre sino e `/avisos` |
| 3 | QA | Aprovado |
| 3 | Tech lead | Reprovado: rótulo fixo "Avisos da empresa" |
| 4 | Engenheiro | Rótulo da tabela conforme o conteúdo (`rotuloDosAvisos`) |
| 4 | QA | Aprovado (teste real da barreira com sessões no banco de teste) |
| 4 | Tech lead | Aprovado |

### Situação

**Aprovada.** `npm test`: 1316/1316 na plataforma, 0 falhas; `typecheck` e `lint` sem erros. Redirects 308 conferidos com curl na porta 3003. Parte 2 marcada como FEITO em 21/10/2026 no `plano.txt`. Sem pendências.

## Ajustes (quinta rodada, 21/10/2026: custo por cliente)

### Correções pedidas

1. Tela interna `/admin/custos` ("Custos" na área do administrador), só para ADMIN, lendo só o banco.
2. Período de cobrança de 21 a 20 no horário de Brasília, com seletor e "Desde o início".
3. Uma linha por empresa, mais "Empresas removidas" e "Plataforma (sem empresa)"; Autenticar fora; ordem pelo custo.
4. Preço pela faixa do total do tipo no período, período a período, com regra de arredondamento documentada e explicação no `<Explicacao>`.
5. Só a linha de soma ao pé (custo total), sem cartões, projeção nem limite.
6. Usar os componentes existentes (Tabela única com paginação).
7. Testes no banco de teste, teste de acesso e documentação.

### Como cada uma foi resolvida

1. Entrada em `lib/admin.ts` com `quemVe: "admin"`; a página começa por `exigirAreaDoAdmin("/admin/custos")` (COMMON_USER e MANAGER recebem 404). Sem server action: período por formulário GET (`?periodo=AAAA-MM-21` ou `?periodo=inicio`). Nenhum import de Serpro, BrasilAPI ou eSocial.
2. No núcleo (`precos.ts`): `periodoDe`, `limitesDoPeriodo`, `ultimoDiaDoPeriodo`, `ehChaveDePeriodo`; `inicioDoPeriodo` passou a independer do fuso do servidor (vale também para o `consumo()` do controle de limite). O SQL usa `at time zone 'America/Sao_Paulo'` e bate com o núcleo. Valor inválido ou período sem chamadas abre o atual.
3. Cálculo em `lib/serpro/custos.ts`. Nova coluna `serpro_chamadas.sem_contribuinte` (migração 0015, gravada pelo `registro.ts`) separa empresas removidas das chamadas da plataforma; a migração marca as 4 autenticações antigas.
4. Custo = soma por tipo de quantidade × preço da faixa do total do tipo, em centavos inteiros: a soma das linhas é exatamente o `custoMensal`. "Desde o início" soma período a período. A coluna `custo` gravada não entra. Regra em código e em `docs/plataforma.md`.
5. e 6. Nova propriedade `rodape` da Tabela única ("Soma do período" / "Soma desde o início"), no computador e no celular.
7. Testes novos: `custos.test.ts`, `custos-acesso.test.ts`, `custos.qa.test.ts` (QA), além de `precos.test.ts` e testes de acesso/fornecedor atualizados.

### Ciclos desta rodada

| Ciclo | Etapa | Resultado |
|---|---|---|
| 1 | Engenheiro | `/admin/custos`, cálculo por faixa em centavos, coluna `sem_contribuinte`, `rodape` da Tabela |
| 1 | QA | Aprovado (casos extras de borda em `custos.qa.test.ts`) |
| 1 | Tech lead | Aprovado |

### Situação

**Aprovada.** `npm test`: núcleo 376/376, plataforma 1350/1350; `typecheck` e `lint` sem erros. Na 3003, com os dados reais, R$ 5,92 (22 consultas, 2 emissões) no período 21/09 a 20/10/2026 e desde o início; nenhuma chamada nova em `serpro_chamadas` (28). Para ver a linha de soma no HTML da 3003 é preciso reiniciar o `npx next dev -p 3003`. Parte 2 marcada como FEITO em 21/10/2026 no `plano.txt`. Sem pendências.

## Ajustes (custo mensal e total, 21/10/2026)

Pedido do usuário: "Quero custo mensal e total".

### Correções pedidas

1. Seções Custo total e Custo mensal abaixo do custo por cliente, lendo só `serpro_chamadas`.
2. Cartão de total: período atual até agora, total desde o início e chamadas cobradas, sem depender do seletor.
3. Tabela mensal com paginação: período atual mesmo vazio, do mais recente ao mais antigo, quantidade e preço da faixa por tipo, custo e linha de soma.
4. Reaproveitar `centavosDaFaixa`/`precoUnitario` e a mesma contagem do custo por cliente; soma dos meses = total = "Desde o início".
5. Explicações só no `<Explicacao>`, sem projeção nem limite do contrato.
6. Testes e documentação.
7. (QA, ciclo 1) No celular, a linha de soma mostrava "Preço consulta/emissão/declaração" sem valor.

### Como cada uma foi resolvida

1. e 2. `app/admin/custos/page.tsx`: cartão de linhas no estilo do `../fiscal` (período atual, desde o início, chamadas cobradas), independente de `?periodo=`.
3. Tabela única com paginação; preço "—" quando o tipo não teve chamada; rodapé "Soma desde o início".
4. `lib/serpro/custos.ts`: contagem do banco extraída para `gruposCobrados` (usada pelo custo por cliente e pelo mensal); novas `calcularCustosMensais` e `custosMensais(banco, agora)`, em centavos inteiros, Autenticar fora.
5. Explicações no tooltip: preço da faixa, recusas podem não ser cobradas, período 21 a 20 em Brasília.
6. `custos-mensais.test.ts` (troca de faixa, período vazio, fronteira 20/21, removidas e plataforma, 200 combinações aleatórias), `custos-acesso.test.ts` atualizado, `custos-mensais.qa.test.ts` (QA: limites de faixa, virada de ano, recusas, 15 períodos) e `docs/plataforma.md`.
7. O rodapé recebe "—" em `preco-*`; teste exige nenhum `<dd>` vazio nos cartões do celular.

### Ciclos desta rodada

| Ciclo | Etapa | Resultado |
|---|---|---|
| 1 | Engenheiro | Custo total e custo mensal em `/admin/custos`, `gruposCobrados`, `custosMensais` |
| 1 | QA | Reprovado (baixa): rótulos sem valor na soma no celular |
| 2 | Engenheiro | "—" nos preços do rodapé e teste |
| 2 | QA | Aprovado |
| 2 | Tech lead | Aprovado |

### Situação

**Aprovada.** `npm test`: núcleo 376/376, plataforma 1376/1376; `typecheck` e `lint` sem erros. Na 3003, com os dados reais: período atual R$ 0,00, desde o início R$ 5,92 (22 × R$ 0,24 + 2 × R$ 0,32), 24 chamadas cobradas; nenhuma chamada nova em `serpro_chamadas` (28). Parte 2 marcada como FEITO em 21/10/2026 no `plano.txt`. Sem pendências.

## Ajustes (abas Plano e Segurança em /admin/plano, 21/10/2026)

### Correções pedidas

1. `/admin/plano` com duas abas, Plano e Segurança, no padrão de abas de Avisos e mensagens; aba no endereço (`?aba=seguranca`), valor inválido abre Plano; só ADMIN.
2. Aba Segurança: parágrafo inicial, itens na ordem do arquivo com selo de gravidade, contagem dos abertos por gravidade e dos feitos (`[FEITO em ...]`); seção fora da aba Plano.
3. Leitor `lib/plano.ts`: título de lista com complemento entre parênteses (Backlog separado do MVP) e seção SEGURANÇA separada.
4. Testes e documentação, sem alterar o texto do `plano.txt` nem corrigir itens de segurança.
5. (Tech lead, ciclo 1, baixa) O `<nav>` de abas era cópia literal do de Avisos; reaproveitar num componente único.

### Como cada uma foi resolvida

1. `page.tsx` mantém `exigirAreaDoAdmin("/admin/plano")` e escolhe a aba com `abaDoPlano`; o desenho foi para `app/admin/plano/conteudo.tsx`.
2. Contagem no topo, selos com as cores da central de avisos (Alta `bg-bad`, Média warn, Baixa neutra, Decisão com borda), item feito no estilo de Feito das partes.
3. `interpretarPlano(texto)` testável; `plano.seguranca`, `itemDeSeguranca`, `contagemDeSeguranca`, `ABAS_DO_PLANO`, `capitalizar` (movido para a lib por citar o fornecedor).
4. `lib/plano.test.ts`, `testes/plano-pagina.test.ts` (barreira real no banco de teste), `lib/plano.qa.test.ts` (QA) e `docs/plataforma.md`.
5. `app/abas-da-pagina.tsx` (`<AbasDaPagina>`, contagem acima de 99 como "99+") usado em Avisos e em `/admin/plano`, mesmo HTML; `testes/abas-da-pagina.test.ts` e `testes/abas-da-pagina.qa.test.ts` (QA).

### Ciclos desta rodada

| Ciclo | Etapa | Resultado |
|---|---|---|
| 1 | Engenheiro | Abas Plano e Segurança, leitor da seção SEGURANÇA, Backlog como lista própria |
| 1 | QA | Aprovado |
| 1 | Tech lead | Reprovado (baixa): nav de abas copiado de Avisos |
| 2 | Engenheiro | Componente único `AbasDaPagina` em Avisos e no plano |
| 2 | QA | Aprovado |
| 2 | Tech lead | Aprovado |

### Situação

**Aprovada.** `npm test`: núcleo 376/376, plataforma 1406/1406; `typecheck` e `lint` sem erros. Na 3003: aba Segurança com 1 Alta, 7 Média, 6 Baixa, 1 Decisão e 0 Feitos; aba inválida cai em Plano; nenhuma chamada nova em `serpro_chamadas`. Parte 2 marcada como FEITO em 21/10/2026 no `plano.txt`. Sem pendências.
