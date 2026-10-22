# Empresas e cadastro

## Empresas e isolamento dos dados

- `empresas` (CNPJ, já aceitando o alfanumérico) e `empresa_usuarios` (vínculo com o papel na empresa: `DONO`, `MEMBRO`
  ou `PROVISORIO`, o cadastro que aguarda comprovação; abaixo). Um usuário pode ter várias empresas; a ativa fica na sessão e é conferida contra o vínculo a cada requisição.
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

## Cadastro pelo CNPJ, quadro de sócios e prova de posse (21/10/2026)

- **Quem pode cadastrar:** só quem tem "Seus dados" completos (docs/login.md) e está no quadro de sócios e
  administradores (QSA) da Receita. `lib/empresas/qsa.ts` compara o nome (sem acento, maiúsculas) e os dígitos visíveis
  do CPF mascarado ("***123456**") com os do usuário. Não bate: recusa com o motivo no tooltip. QSA vazio ou sem os CPFs:
  segue, avisando que a comprovação será só pelo termo.
- **Banco primeiro:** a consulta pública do CNPJ do cadastro fica em `cnpjs_consultados` (dado público, sem usuário nem
  empresa; `lib/empresas/consulta-publica.ts`), válida 30 dias. Guardada há mais de 1 dia e sem bater com o QSA, é refeita
  uma vez antes de recusar.
- **Aguardando comprovação:** o cadastro cria o vínculo `PROVISORIO` (`empresa_usuarios.papel`). O CNPJ não fica
  bloqueado: outro usuário que também bata com o QSA cria o próprio provisório, sem saber do outro (a resposta é a mesma).
  Empresa já comprovada (com DONO ou MEMBRO) recusa novos cadastros: "Esta empresa já foi comprovada por outra conta",
  sem dizer qual. O provisório não lê nem grava nada da empresa: `exigirAcessoEmpresa` o recusa (`AguardandoComprovacao`)
  e o único acesso dele é o `AcessoProvisorio` de `exigirAcessoAoTermo` (outro tipo, recusado também por `dadosDaEmpresa`
  e `daEmpresa` em tempo de execução), que só serve para o termo. O portão devolve `aguardando`: as abas mostram o estado
  de espera com "Assinar o termo", e só a Autorização abre (com o termo). Dá para desistir em Dados da empresa: se era o último
  provisório, a empresa é apagada como na remoção (`lib/empresas/apagar-empresa.ts`, o mesmo código), e o gasto registrado
  (um envio do termo recusado, por exemplo) fica anonimizado, sem empresa, sem CNPJ e sem mensagens.
- **A prova é o termo** (docs/autorizacao.md): aceito, quem enviou vira `DONO` (`lib/empresas/posse.ts`), os provisórios
  dos outros caem e cada um recebe um aviso no topo do painel (`cadastros_encerrados`: só o CNPJ e a razão social, nunca
  quem comprovou); a consulta pública do cadastro vira a primeira linha de `consultas_cnpj` da empresa.
- **Empresa da plataforma:** cadastrada por um ADMIN com o `PLATAFORMA_CNPJ`, nasce comprovada (DONO), sem "Seus dados"
  nem QSA.
- Os vínculos que já existiam antes desta regra (DONO e MEMBRO) continuam comprovados (a migração 0016 só acrescenta).
- Testes: `testes/posse.test.ts` (QSA bate, não bate, vazio; dois provisórios isolados; termo com CPF ou CNPJ de outro,
  cadeia forjada; promoção e remoção dos provisórios; limite de envios; empresa da plataforma), `testes/cadastro*.test.ts`
  e `lib/empresas/qsa.test.ts`.

## Cadastro pelo CNPJ e dados da Receita

- `lib/empresas/cadastro.ts`: `consultarParaCadastro` confere o CNPJ, olha o banco primeiro (empresa em que o usuário já
  tem vínculo não gasta consulta e passa a ser a ativa; comprovada por outra conta é recusada), confere "Seus dados" e o
  QSA e devolve os dados, o diagnóstico, o resultado do QSA e uma prévia assinada (HMAC com `SESSAO_SEGREDO`, presa ao
  usuário, vale 30 minutos). `cadastrarPelaPrevia` confere o QSA de novo e cria o provisório (`cadastrarProvisorio`); para
  a empresa da plataforma, `criarEmpresa` (DONO) e a consulta guardada. Os dados usados são os da consulta, sem nova
  consulta e sem confiar no navegador.
- `lib/empresas/receita.ts` (sempre pela porta `acesso.ts`): cada consulta vira uma linha em `consultas_cnpj` (CNAEs,
  situação, Simples/MEI e os dados completos, com o diagnóstico do dia). `dadosDaReceita` usa a do banco enquanto tiver
  até 30 dias; vencida ou ausente, consulta de novo e guarda. "Atualizar dados" força a consulta, mas não repete em menos
  de 5 minutos. Se a BrasilAPI falhar, a tela mostra a última consulta guardada com o erro. A razão social da empresa
  acompanha a da Receita.
