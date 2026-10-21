// Esquema do banco (Drizzle). Depois de mudar: npm run banco:gerar (cria a migração) e npm run banco:migrar.
//
// Regra das empresas: toda tabela de dado de cliente tem `empresa_id` (not null, referência a empresas) e é lida
// e gravada só por `lib/empresas/acesso.ts`, que confere o vínculo do usuário logado com a empresa. As únicas
// tabelas sem essa regra são as da própria plataforma, em TABELAS_DA_PLATAFORMA (o teste banco/esquema.test.ts
// falha se aparecer tabela nova sem empresa_id).
import { sql } from "drizzle-orm";
import { boolean, check, customType, date, index, integer, jsonb, numeric, pgTable, primaryKey, serial, smallint, text, timestamp, unique, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import type { DadosCnpj } from "@contabilizadev/nucleo/brasilapi/cnpj";
import type { Diagnostico } from "@contabilizadev/nucleo/diagnostico";
import type { AtividadeDeclarada } from "@contabilizadev/nucleo/serpro/extrato";
import type { DocumentoPago } from "@contabilizadev/nucleo/serpro/pagamentos";
import type { Valores } from "@contabilizadev/nucleo/serpro/pgdasd";
import type { ValoresPorMes } from "@contabilizadev/nucleo/simples";

// Marca de que o banco foi criado pelas migrações (e quando).
export const instalacao = pgTable("instalacao", {
  chave: text("chave").primaryKey(),
  valor: text("valor").notNull(),
  criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
});

// Papéis na plataforma (portados do horizons). ADMIN não se escolhe pela tela: vem só da variável ADMIN_EMAILS,
// reavaliada a cada requisição. A coluna não é fonte de verdade para ADMIN: o papel que vale é sempre
// papelPara(email, coluna, ADMIN_EMAILS), nunca a coluna crua. O que a coluna guarda de próprio é o MANAGER.
export const PAPEIS = ["COMMON_USER", "MANAGER", "ADMIN"] as const;
export type Papel = (typeof PAPEIS)[number];

export const usuarios = pgTable(
  "usuarios",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Sempre em minúsculas (o login normaliza): é a chave do upsert.
    email: text("email").notNull().unique(),
    nome: text("nome").notNull(),
    avatarUrl: text("avatar_url"),
    // De onde veio a conta: GOOGLE, ou DEV (login desligado, só fora de produção).
    provedor: text("provedor").notNull().default("GOOGLE"),
    // `sub` do Google. Se outra conta Google aparecer com o mesmo e-mail, o login recusa.
    provedorId: text("provedor_id"),
    papel: text("papel").$type<Papel>().notNull().default("COMMON_USER"),
    // Desativar derruba a sessão na requisição seguinte (o usuário é relido do banco a cada requisição).
    ativo: boolean("ativo").notNull().default(true),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
    ultimoLoginEm: timestamp("ultimo_login_em", { withTimezone: true }),
    desativadoEm: timestamp("desativado_em", { withTimezone: true }),
    desativadoPorId: uuid("desativado_por_id").references((): AnyPgColumn => usuarios.id, { onDelete: "set null" }),
  },
  (t) => [check("usuarios_papel_valido", sql`${t.papel} in ('COMMON_USER', 'MANAGER', 'ADMIN')`)],
);

export const empresas = pgTable(
  "empresas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // 14 caracteres sem pontuação. Já aceita o CNPJ alfanumérico (IN RFB 2.229/2024): 12 letras/dígitos + 2 DV.
    cnpj: text("cnpj").notNull().unique(),
    razaoSocial: text("razao_social").notNull(),
    criadaEm: timestamp("criada_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("empresas_cnpj_formato", sql`${t.cnpj} ~ '^[0-9A-Z]{12}[0-9]{2}$'`)],
);

// Papel do usuário dentro de uma empresa: o DONO administra a empresa; o MEMBRO usa.
export const PAPEIS_NA_EMPRESA = ["DONO", "MEMBRO"] as const;
export type PapelNaEmpresa = (typeof PAPEIS_NA_EMPRESA)[number];

// Vínculo usuário-empresa: é a única coisa que dá acesso aos dados de uma empresa (o ADMIN da plataforma também
// precisa dele: administrar usuários não é ler o dado fiscal de um cliente).
export const empresaUsuarios = pgTable(
  "empresa_usuarios",
  {
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    usuarioId: uuid("usuario_id").notNull().references(() => usuarios.id, { onDelete: "cascade" }),
    papel: text("papel").$type<PapelNaEmpresa>().notNull().default("MEMBRO"),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.empresaId, t.usuarioId] }),
    index("empresa_usuarios_usuario").on(t.usuarioId),
    check("empresa_usuarios_papel_valido", sql`${t.papel} in ('DONO', 'MEMBRO')`),
  ],
);

// Sessões de login. O navegador guarda só o token (cookie httpOnly e assinado); aqui fica o hash SHA-256 dele,
// então quem lê o banco não consegue se passar por ninguém.
export const sessoes = pgTable(
  "sessoes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    usuarioId: uuid("usuario_id").notNull().references(() => usuarios.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    // Empresa escolhida na barra de cima. Conferida contra o vínculo a cada requisição.
    empresaAtivaId: uuid("empresa_ativa_id").references(() => empresas.id, { onDelete: "set null" }),
    criadaEm: timestamp("criada_em", { withTimezone: true }).notNull().defaultNow(),
    expiraEm: timestamp("expira_em", { withTimezone: true }).notNull(),
  },
  (t) => [index("sessoes_usuario").on(t.usuarioId)],
);

// Dados da Receita de cada empresa (consulta pública de CNPJ na BrasilAPI) e o diagnóstico feito com eles.
// Uma linha por consulta (o histórico fica); a que vale é a mais recente. Regra de consulta externa: primeiro o banco,
// a BrasilAPI só quando não há consulta, ela passou da validade ou o cliente pede para atualizar (lib/empresas/receita.ts).
// De onde veio a consulta (valor interno, nunca mostrado ao cliente).
export const FONTE_CONSULTA_CNPJ = "BRASILAPI";

export const consultasCnpj = pgTable(
  "consultas_cnpj",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    fonte: text("fonte").notNull().default(FONTE_CONSULTA_CNPJ),
    consultadaEm: timestamp("consultada_em", { withTimezone: true }).notNull(),
    // O essencial em colunas (para conferir e filtrar sem abrir o JSON); tudo o que veio fica em `dados`.
    cnaePrincipal: text("cnae_principal").notNull(),
    cnaesSecundarios: text("cnaes_secundarios").array().notNull(),
    situacaoCadastral: text("situacao_cadastral").notNull(),
    optanteSimples: boolean("optante_simples"),
    optanteMei: boolean("optante_mei"),
    dados: jsonb("dados").$type<DadosCnpj>().notNull(),
    diagnostico: jsonb("diagnostico").$type<Diagnostico>().notNull(),
    atendida: boolean("atendida").notNull(),
  },
  (t) => [index("consultas_cnpj_empresa_data").on(t.empresaId, t.consultadaEm)],
);

// Termo de autorização da empresa (Parte 4, "Autorização"): assinado no navegador com o e-CNPJ A1 da própria
// empresa e enviado ao Autentica Procurador do Serpro, que devolve o token das chamadas seguintes. O termo assinado e o
// token ficam só cifrados (AES-256-GCM com a TOKEN_CHAVE, lib/termo/cifra.ts): o token vale só até a meia-noite do dia
// seguinte, e o termo guardado é reenviado para pegar outro enquanto estiver na vigência. O certificado, a chave e a
// senha nunca chegam aqui. Uma linha por termo enviado; o que vale é o não substituído (no máximo um por empresa).
export const termosAutorizacao = pgTable(
  "termos_autorizacao",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    // CNPJ da plataforma (destinatário do termo) na hora do envio: se o PLATAFORMA_CNPJ mudar, o termo não vale mais.
    contratante: text("contratante").notNull(),
    enviadoPorId: uuid("enviado_por_id").references(() => usuarios.id, { onDelete: "set null" }),
    enviadoEm: timestamp("enviado_em", { withTimezone: true }).notNull(),
    dataAssinatura: date("data_assinatura", { mode: "string" }).notNull(),
    vigencia: date("vigencia", { mode: "string" }).notNull(),
    certificadoValidoAte: timestamp("certificado_valido_ate", { withTimezone: true }).notNull(),
    // Quem assinou: o e-CNPJ da empresa (CNPJ e razão social do certificado).
    signatarioCnpj: text("signatario_cnpj").notNull(),
    signatarioNome: text("signatario_nome").notNull(),
    // SHA-256 do XML assinado: o mesmo termo enviado de novo não gasta outra chamada.
    xmlHash: text("xml_hash").notNull(),
    termoCifrado: text("termo_cifrado").notNull(),
    tokenCifrado: text("token_cifrado"),
    tokenExpiraEm: timestamp("token_expira_em", { withTimezone: true }),
    tokenObtidoEm: timestamp("token_obtido_em", { withTimezone: true }),
    // A Receita recusou o termo guardado ao renovar o token (certificado revogado, por exemplo): a autorização deixa de valer
    // e o cliente assina de novo. O motivo é o da classificação do núcleo (autentica-procurador.ts), nunca o texto da API.
    recusadoEm: timestamp("recusado_em", { withTimezone: true }),
    recusaMotivo: text("recusa_motivo"),
    substituidoEm: timestamp("substituido_em", { withTimezone: true }),
  },
  (t) => [
    index("termos_autorizacao_empresa").on(t.empresaId, t.enviadoEm),
    uniqueIndex("termos_autorizacao_um_ativo").on(t.empresaId).where(sql`${t.substituidoEm} is null`),
  ],
);

// Registro interno de toda chamada ao Serpro: o gasto da PLATAFORMA com o contrato dela (finalidade, resposta e custo).
// Não é cobrança do cliente: o cliente paga só o plano mensal ou anual por empresa (plano.txt, passo 24); este custo só
// entra na conta do preço do plano. Serve também para o limite de chamadas por período de faturamento do contrato (o
// cliente do núcleo consulta o consumo antes de cada chamada). Nunca guarda token nem XML: só o texto das mensagens.
export const serproChamadas = pgTable(
  "serpro_chamadas",
  {
    id: serial("id").primaryKey(),
    quando: timestamp("quando", { withTimezone: true }).notNull(),
    acao: text("acao").notNull(),
    servico: text("servico").notNull(),
    finalidade: text("finalidade").notNull(),
    contribuinte: text("contribuinte"),
    // Empresa cadastrada com o CNPJ do contribuinte, quando há. Removida a empresa (lib/empresas/remocao.ts), a linha fica
    // só como número de gasto, ANONIMIZADA: empresa_id e contribuinte nulos e mensagens vazias; ficam data, ação (tipo),
    // serviço, finalidade (texto do código; o CNPJ, se aparecer, é tirado), status e custo.
    empresaId: uuid("empresa_id").references(() => empresas.id, { onDelete: "set null" }),
    // A chamada não tinha contribuinte (é da própria plataforma, como a autenticação). Separa, no custo por cliente
    // (/admin/custos), o gasto da plataforma do das empresas removidas, que também ficam sem empresa_id e sem contribuinte.
    semContribuinte: boolean("sem_contribuinte").notNull().default(false),
    status: smallint("status"),
    mensagens: text("mensagens").notNull(),
    custo: numeric("custo", { precision: 10, scale: 2, mode: "number" }).notNull(),
  },
  (t) => [index("serpro_chamadas_quando").on(t.quando), index("serpro_chamadas_empresa").on(t.empresaId)],
);

// Segredos da própria plataforma, informados por um ADMIN na tela interna /admin/plataforma: o e-CNPJ A1 da plataforma
// (contratante do Serpro e transmissor do eSocial) e as chaves do contrato. Uma linha por segredo ("certificado",
// "chaves"). O conteúdo fica só cifrado (AES-256-GCM com a PLATAFORMA_CHAVE, IV por registro, o nome como dado
// autenticado; lib/plataforma/segredos.ts): o certificado já aberto (chave e certificado em PEM, a senha não é guardada) e
// as chaves. Em `info` fica só o que a tela mostra (titular, CNPJ, validade; o fim da consumer key), nunca o segredo.
export type InfoDoCertificadoGuardado = { titular: string; cnpj: string; validoDe: string; validoAte: string; emissor: string };
export type InfoDasChavesGuardadas = { finalDaChave: string };
export const plataformaSegredos = pgTable(
  "plataforma_segredos",
  {
    nome: text("nome").$type<"certificado" | "chaves">().primaryKey(),
    cifrado: text("cifrado").notNull(),
    info: jsonb("info").$type<InfoDoCertificadoGuardado | InfoDasChavesGuardadas>().notNull(),
    atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull(),
    atualizadoPorId: uuid("atualizado_por_id").references(() => usuarios.id, { onDelete: "set null" }),
  },
  (t) => [check("plataforma_segredos_nome_valido", sql`${t.nome} in ('certificado', 'chaves')`)],
);

// PDFs da Receita (extrato do DAS, relatório de situação fiscal, DEFIS) guardados no próprio banco, nunca em pasta
// pública: só saem pela rota de documentos (app/documentos), com a sessão e o vínculo conferidos.
const pdf = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });
const dinheiro = (nome: string) => numeric(nome, { precision: 14, scale: 2, mode: "number" });

// Histórico importado da Receita (Parte 5). Regra de consulta, banco primeiro (lib/historico): só se consulta de novo o
// que não existe ou está velho, e o resultado é guardado aqui. Todas presas à empresa (empresa_id) e apagadas com ela.

// Declarações do PGDAS-D transmitidas (original e retificadoras), da lista de declarações de cada ano.
export const pgdasdDeclaracoes = pgTable(
  "pgdasd_declaracoes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    pa: text("pa").notNull(), // AAAA-MM
    numero: text("numero").notNull(),
    tipo: text("tipo").$type<"original" | "retificadora">().notNull(),
    transmitidaEm: text("transmitida_em"), // AAAA-MM-DDTHH:MM:SS, horário de Brasília (como a Receita informa)
    malha: text("malha"),
    vistaEm: timestamp("vista_em", { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("pgdasd_declaracoes_numero").on(t.empresaId, t.numero), index("pgdasd_declaracoes_pa").on(t.empresaId, t.pa)],
);

// DAS gerados (da mesma lista), com a marca de pago que a Receita informa na consulta.
export const pgdasdDas = pgTable(
  "pgdasd_das",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    pa: text("pa").notNull(),
    numero: text("numero").notNull(),
    emitidoEm: text("emitido_em"),
    pago: boolean("pago").notNull(),
    vistoEm: timestamp("visto_em", { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("pgdasd_das_numero").on(t.empresaId, t.numero), index("pgdasd_das_pa").on(t.empresaId, t.pa)],
);

// Extrato de cada declaração vigente (o PDF e o que foi lido dele). Declaração transmitida não muda: o extrato é buscado
// uma vez por declaração; só uma retificadora (declaração nova) pede outro. Mês declarado sem DAS gerado depois da
// declaração não tem extrato: guarda o PDF da própria declaração (origem "declaracao", sem DAS), com o débito declarado
// em valor_das; se um DAS for gerado depois para ela, o extrato substitui a declaração.
export const pgdasdExtratos = pgTable(
  "pgdasd_extratos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    pa: text("pa").notNull(),
    numeroDeclaracao: text("numero_declaracao").notNull(),
    origem: text("origem").$type<"extrato" | "declaracao">().notNull().default("extrato"),
    numeroDas: text("numero_das"),
    receita: dinheiro("receita"),
    valorDas: dinheiro("valor_das"),
    vencimento: date("vencimento", { mode: "string" }),
    pagoEm: date("pago_em", { mode: "string" }),
    valorPago: dinheiro("valor_pago"),
    fatorR: numeric("fator_r", { precision: 6, scale: 4, mode: "number" }),
    atividades: jsonb("atividades").$type<AtividadeDeclarada[]>().notNull(),
    // Itens 2.2 e 2.3 do extrato: receitas e folhas dos meses anteriores que a Receita usou (base da RBT12 e do Fator R da
    // rotina do mês). Null = guardado antes da Parte 6: lido de novo do PDF guardado na primeira vez que a rotina precisar.
    receitasAnteriores: jsonb("receitas_anteriores").$type<{ mes: string; interno: number; externo: number }[]>(),
    folhasAnteriores: jsonb("folhas_anteriores").$type<{ mes: string; valor: number }[]>(),
    pdf: pdf("pdf").notNull(),
    consultadoEm: timestamp("consultado_em", { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("pgdasd_extratos_declaracao").on(t.empresaId, t.numeroDeclaracao), index("pgdasd_extratos_pa").on(t.empresaId, t.pa)],
);

// Pagamentos de guias (DAS e DARF do INSS) com data e valor, da consulta de pagamentos.
export const pagamentos = pgTable(
  "pagamentos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    numero: text("numero").notNull(),
    tipo: text("tipo").$type<"DAS" | "INSS">().notNull(),
    pa: text("pa").notNull(),
    pagoEm: date("pago_em", { mode: "string" }),
    valor: dinheiro("valor"),
    documento: jsonb("documento").$type<DocumentoPago>().notNull(),
    vistoEm: timestamp("visto_em", { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("pagamentos_numero").on(t.empresaId, t.numero), index("pagamentos_pa").on(t.empresaId, t.pa)],
);

// DEFIS (declaração anual) de cada ano consultado: a última entregue, com os PDFs, ou "não encontrada".
export const defis = pgTable(
  "defis",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    ano: integer("ano").notNull(),
    situacao: text("situacao").$type<"entregue" | "nao-encontrada">().notNull(),
    idDefis: text("id_defis"),
    declaracaoPdf: pdf("declaracao_pdf"),
    reciboPdf: pdf("recibo_pdf"),
    consultadaEm: timestamp("consultada_em", { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("defis_ano").on(t.empresaId, t.ano)],
);

// Declaração anual (Parte 8): o que só o cliente sabe do ano, digitado na aba Declaração anual para entregar a DEFIS no
// portal (lucros retirados, saldos do banco no começo e no fim do ano, despesas). Nulo = ainda não informado.
export const defisDados = pgTable(
  "defis_dados",
  {
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    ano: integer("ano").notNull(),
    lucros: dinheiro("lucros"),
    saldoInicial: dinheiro("saldo_inicial"),
    saldoFinal: dinheiro("saldo_final"),
    despesas: dinheiro("despesas"),
    atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull(),
    usuarioId: uuid("usuario_id").references(() => usuarios.id, { onDelete: "set null" }),
  },
  (t) => [primaryKey({ columns: [t.empresaId, t.ano] })],
);

// Caixa Postal da Receita (Parte 8): o cabeçalho de cada mensagem (assunto, data, remetente, leitura, relevância), vindo
// da lista, que não registra ciência. O conteúdo só existe aqui depois que o cliente pediu para abrir, confirmando a
// ciência (o serviço do conteúdo registra a ciência na Receita); aberto, fica guardado e não é pedido de novo.
// abrindo_em é a trava do pedido do conteúdo (duplo clique ou duas abas chamam uma vez); vista_em apaga a mensagem do sino
// (vista na lista, sem ciência na Receita).
export const caixaPostal = pgTable(
  "caixa_postal",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    isn: text("isn").notNull(),
    assunto: text("assunto").notNull(),
    origem: text("origem").notNull(),
    enviadaEm: text("enviada_em"), // AAAA-MM-DDThh:mm:ss (hora de Brasília, como a Receita manda)
    lidaNaReceita: boolean("lida_na_receita").notNull(),
    cienciaEm: text("ciencia_em"), // AAAA-MM-DD
    validaAte: text("valida_ate"),
    relevante: boolean("relevante").notNull(),
    conteudo: text("conteudo"),
    abertaEm: timestamp("aberta_em", { withTimezone: true }),
    abertaPor: uuid("aberta_por").references(() => usuarios.id, { onDelete: "set null" }),
    abrindoEm: timestamp("abrindo_em", { withTimezone: true }),
    vistaEm: timestamp("vista_em", { withTimezone: true }),
    buscadaEm: timestamp("buscada_em", { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("caixa_postal_isn").on(t.empresaId, t.isn), index("caixa_postal_envio").on(t.empresaId, t.enviadaEm)],
);

// Relatórios de situação fiscal: cada pedido vira uma linha (processando, pronto ou erro); o que vale é o último pronto.
export const situacoesFiscais = pgTable(
  "situacoes_fiscais",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    pedidoEm: timestamp("pedido_em", { withTimezone: true }).notNull(),
    situacao: text("situacao").$type<"processando" | "pronto" | "erro">().notNull(),
    regular: boolean("regular"), // null = não deu para ler o relatório
    pendencias: text("pendencias"),
    pdf: pdf("pdf"),
    prontoEm: timestamp("pronto_em", { withTimezone: true }),
  },
  (t) => [index("situacoes_fiscais_empresa").on(t.empresaId, t.pedidoEm)],
);

// Quando cada consulta à Receita foi feita por último (lista de declarações de um ano, pagamentos, DEFIS de um ano,
// situação fiscal): é o que decide se o banco ainda vale ou se dá para consultar de novo (lib/historico/prazos.ts).
export const historicoConsultas = pgTable(
  "historico_consultas",
  {
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    tipo: text("tipo").notNull(), // "declaracoes:2026", "pagamentos", "defis:2025", "situacao", "caixa-postal"
    consultadaEm: timestamp("consultada_em", { withTimezone: true }).notNull(),
    ok: boolean("ok").notNull(),
  },
  (t) => [primaryKey({ columns: [t.empresaId, t.tipo] })],
);

// Importação do histórico em segundo plano, com o progresso de cada etapa (a tela acompanha sem travar). No máximo uma
// rodando por empresa.
export type EtapaImportacao = {
  id: "declaracoes" | "extratos" | "pagamentos" | "defis" | "situacao";
  estado: "pendente" | "rodando" | "feito" | "erro";
  feitos?: number;
  total?: number;
  mensagem?: string; // mensagem própria para a tela (nunca o texto da API)
  anos?: number[]; // declarações e DEFIS: os anos a consultar
};
export const importacoes = pgTable(
  "importacoes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    motivo: text("motivo").$type<"inicial" | "automatica" | "manual">().notNull(),
    etapas: jsonb("etapas").$type<EtapaImportacao[]>().notNull(),
    iniciadaEm: timestamp("iniciada_em", { withTimezone: true }).notNull(),
    atualizadaEm: timestamp("atualizada_em", { withTimezone: true }).notNull(),
    terminadaEm: timestamp("terminada_em", { withTimezone: true }),
  },
  (t) => [
    index("importacoes_empresa").on(t.empresaId, t.iniciadaEm),
    uniqueIndex("importacoes_uma_rodando").on(t.empresaId).where(sql`${t.terminadaEm} is null`),
  ],
);

// Rotina do mês (Parte 6): receita lançada, pró-labore, envios do PGDAS-D e da DCTFWeb e guias geradas. Todas presas à
// empresa (empresa_id), lidas e gravadas pela porta de acesso e apagadas com ela.

// Receita de exportação recebida, lançada pelo cliente: o valor em reais que caiu na conta pelo trabalho do mês (pa).
// Recebida em moeda estrangeira, o cliente informa o valor na moeda e, se souber, o valor em reais; sem ele, a conversão é
// pela PTAX de compra do dia do recebimento (cotação e data guardadas).
export const receitasLancadas = pgTable(
  "receitas_lancadas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    pa: text("pa").notNull(), // AAAA-MM, o mês trabalhado
    recebidaEm: date("recebida_em", { mode: "string" }).notNull(),
    moeda: text("moeda").notNull(), // BRL ou o código da moeda (ptax.ts)
    valorMoeda: dinheiro("valor_moeda").notNull(),
    cotacao: numeric("cotacao", { precision: 12, scale: 6, mode: "number" }),
    cotacaoData: date("cotacao_data", { mode: "string" }),
    valorBrl: dinheiro("valor_brl").notNull(),
    origemValor: text("origem_valor").$type<"reais" | "ptax" | "informado">().notNull(),
    observacao: text("observacao"),
    lancadaEm: timestamp("lancada_em", { withTimezone: true }).notNull(),
    lancadaPorId: uuid("lancada_por_id").references(() => usuarios.id, { onDelete: "set null" }),
  },
  (t) => [index("receitas_lancadas_pa").on(t.empresaId, t.pa)],
);

// Mês em que o cliente disse que não houve receita (Parte 6): separa "ainda não lancei" de "não houve receita". Sem
// receita lançada e sem esta marcação, a rotina não simula nem transmite (uma declaração zerada por engano só se
// corrige com retificação). Lançar uma receita no mês apaga a marcação.
export const mesesSemReceita = pgTable(
  "meses_sem_receita",
  {
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    pa: text("pa").notNull(),
    marcadoEm: timestamp("marcado_em", { withTimezone: true }).notNull(),
    marcadoPorId: uuid("marcado_por_id").references(() => usuarios.id, { onDelete: "set null" }),
  },
  (t) => [primaryKey({ columns: [t.empresaId, t.pa] })],
);

// Pró-labore (folha com encargos) informado pelo cliente para um mês: vale sobre o do extrato e o do DARF do INSS no
// Fator R e é a base do INSS (11%) esperado na DCTFWeb.
export const prolabores = pgTable(
  "prolabores",
  {
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    mes: text("mes").notNull(),
    valor: dinheiro("valor").notNull(),
    informadoEm: timestamp("informado_em", { withTimezone: true }).notNull(),
    informadoPorId: uuid("informado_por_id").references(() => usuarios.id, { onDelete: "set null" }),
  },
  (t) => [primaryKey({ columns: [t.empresaId, t.mes] })],
);

// Simulações e transmissões do PGDAS-D feitas pela plataforma, com o que foi calculado e o que a Receita devolveu.
// Idempotência: no máximo uma transmissão "viva" (enviando, ok ou incerta) por empresa, mês e declaração retificada
// (retifica = número da declaração que valia; vazio na original). "incerta" = a chamada caiu sem resposta: a Receita pode
// ter recebido, então nada é transmitido de novo até o histórico (lista de declarações) mostrar o que aconteceu.
export const pgdasdEnvios = pgTable(
  "pgdasd_envios",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    pa: text("pa").notNull(),
    etapa: text("etapa").$type<"simulacao" | "transmissao">().notNull(),
    tipo: text("tipo").$type<"original" | "retificadora">().notNull(),
    retifica: text("retifica"),
    receita: dinheiro("receita").notNull(),
    rbt12: dinheiro("rbt12").notNull(),
    anexo: text("anexo").$type<"III" | "V">().notNull(),
    idAtividade: integer("id_atividade").notNull(),
    folhas: jsonb("folhas").$type<ValoresPorMes>().notNull(),
    valores: jsonb("valores").$type<Valores>().notNull(), // calculados pela plataforma (código do tributo -> valor)
    valoresReceita: jsonb("valores_receita").$type<Valores>(), // devolvidos pela Receita
    estado: text("estado").$type<"enviando" | "ok" | "erro" | "incerto">().notNull(),
    mensagem: text("mensagem"), // mensagem própria para a tela (nunca o texto da API)
    numeroDeclaracao: text("numero_declaracao"),
    declaracaoPdf: pdf("declaracao_pdf"),
    reciboPdf: pdf("recibo_pdf"),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull(),
    terminadoEm: timestamp("terminado_em", { withTimezone: true }),
    usuarioId: uuid("usuario_id").references(() => usuarios.id, { onDelete: "set null" }),
  },
  (t) => [
    index("pgdasd_envios_pa").on(t.empresaId, t.pa, t.criadoEm),
    uniqueIndex("pgdasd_envios_uma_transmissao")
      .on(t.empresaId, t.pa, sql`coalesce(${t.retifica}, '')`)
      .where(sql`${t.etapa} = 'transmissao' and ${t.estado} in ('enviando', 'ok', 'incerto')`),
  ],
);

// DCTFWeb do mês: conferências (o XML que a Receita montou a partir do eSocial, situação e valor) e transmissões. A
// transmissão de cliente é preparada aqui (assinatura com marcador e o SignedInfo que o navegador assina) e completada com
// o valor assinado; a mesma regra de idempotência do PGDAS-D (uma transmissão viva por empresa e mês).
export const dctfwebEnvios = pgTable(
  "dctfweb_envios",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    pa: text("pa").notNull(),
    etapa: text("etapa").$type<"conferencia" | "transmissao">().notNull(),
    estado: text("estado").$type<"preparada" | "enviando" | "ok" | "erro" | "incerto">().notNull(),
    situacao: text("situacao").$type<"em andamento" | "transmitida">(),
    aPagar: dinheiro("a_pagar"),
    recibo: text("recibo"),
    xml: text("xml"), // conferência: o XML da declaração; transmissão: o XML preparado (com o marcador) ou o assinado
    signedInfo: text("signed_info"),
    certificado: text("certificado"), // base64 do certificado (público) de quem assina
    mensagem: text("mensagem"),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull(),
    terminadoEm: timestamp("terminado_em", { withTimezone: true }),
    usuarioId: uuid("usuario_id").references(() => usuarios.id, { onDelete: "set null" }),
  },
  (t) => [
    index("dctfweb_envios_pa").on(t.empresaId, t.pa, t.criadoEm),
    uniqueIndex("dctfweb_envios_uma_transmissao")
      .on(t.empresaId, t.pa)
      .where(sql`${t.etapa} = 'transmissao' and ${t.estado} in ('enviando', 'ok', 'incerto')`),
  ],
);

// Guias geradas pela plataforma (DAS e DARF do INSS), com o PDF. Banco primeiro: a mesma guia (mês, tipo, declaração de
// referência e data de pagamento) não é pedida de novo. pagar_em nulo = a guia do vencimento; com data = a guia vencida
// atualizada com multa e juros para pagar nesse dia.
export const guias = pgTable(
  "guias",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    pa: text("pa").notNull(),
    tipo: text("tipo").$type<"DAS" | "INSS">().notNull(),
    referencia: text("referencia").notNull(), // DAS: número da declaração vigente; INSS: o recibo da DCTFWeb (ou o mês)
    pagarEm: date("pagar_em", { mode: "string" }),
    numero: text("numero"),
    vencimento: date("vencimento", { mode: "string" }),
    principal: dinheiro("principal"),
    multa: dinheiro("multa"),
    juros: dinheiro("juros"),
    total: dinheiro("total"),
    pdf: pdf("pdf").notNull(),
    geradaEm: timestamp("gerada_em", { withTimezone: true }).notNull(),
    usuarioId: uuid("usuario_id").references(() => usuarios.id, { onDelete: "set null" }),
  },
  (t) => [unique("guias_mesma_guia").on(t.empresaId, t.pa, t.tipo, t.referencia, t.pagarEm).nullsNotDistinct(), index("guias_pa").on(t.empresaId, t.pa)],
);

// eSocial (Parte 7): o pró-labore do sócio no eSocial. O cliente assina os eventos no navegador com o e-CNPJ dele e a
// plataforma transmite com o próprio certificado (MOD v1.16 §7.5.7: não precisa de vínculo entre transmissor e
// empregador). Todas presas à empresa (empresa_id), lidas e gravadas pela porta de acesso e apagadas com ela.

// Os cadastros que a empresa já tem no eSocial e que os eventos mensais usam (nada fixo no código): o CPF do sócio, a
// categoria (ex.: 723), a matrícula do S-2300, a lotação, a tabela e as rubricas do pró-labore e do INSS e o dia do
// pagamento. Importados dos eventos que o contador já enviou (download do eSocial) ou preenchidos no formulário.
export const esocialConfig = pgTable("esocial_config", {
  empresaId: uuid("empresa_id").primaryKey().references(() => empresas.id, { onDelete: "cascade" }),
  cpf: text("cpf").notNull(),
  categoria: text("categoria").notNull(),
  matricula: text("matricula").notNull(),
  lotacao: text("lotacao").notNull(),
  tabRubrica: text("tab_rubrica").notNull(),
  rubricaProLabore: text("rubrica_pro_labore").notNull(),
  rubricaInss: text("rubrica_inss").notNull(),
  qtdProLabore: text("qtd_pro_labore"),
  diaPagamento: smallint("dia_pagamento").notNull(), // dia do mês em que o pró-labore é pago
  pagamentoNoMes: text("pagamento_no_mes").$type<"seguinte" | "mesmo">().notNull(), // pago no mês seguinte ou no próprio mês
  origem: text("origem").$type<"importado" | "formulario">().notNull(),
  importadoDe: text("importado_de"), // o mês dos eventos baixados, quando importado
  atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull(),
  atualizadoPorId: uuid("atualizado_por_id").references(() => usuarios.id, { onDelete: "set null" }),
});

export type ValoresDoEnvioEsocial = {
  proLabore: number;
  inss: number;
  liquido: number;
  pagamento: { perRef: string; dtPgto: string; liquido: number } | null;
};
export type OcorrenciaEsocial = { evento: string; codigo: string; descricao: string };

// Cada envio do mês ao eSocial: o mensal (S-1200 + S-1210, depois S-1299), a retificação explícita (S-1298, S-1200
// retificador e S-1299) ou a marcação "lancei no portal". Os lotes vão em ordem (o seguinte só com o anterior aceito).
// Idempotência: no máximo um envio em andamento (enviando, aguardando ou incerto) por empresa e mês; "incerto" = o envio
// caiu sem resposta e é repetido com os mesmos eventos assinados (o eSocial devolve o recibo do evento que já recebeu,
// MOD §7.6.13), nunca com eventos novos.
export const esocialEnvios = pgTable(
  "esocial_envios",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    mes: text("mes").notNull(),
    tipo: text("tipo").$type<"mensal" | "retificacao" | "portal">().notNull(),
    estado: text("estado").$type<"preparado" | "enviando" | "aguardando" | "concluido" | "recusado" | "incerto">().notNull(),
    loteAtual: smallint("lote_atual").notNull().default(1),
    totalLotes: smallint("total_lotes").notNull().default(1),
    protocolo: text("protocolo"), // do lote atual, enquanto o eSocial processa
    cpf: text("cpf"),
    valores: jsonb("valores").$type<ValoresDoEnvioEsocial>(),
    transDctf: boolean("trans_dctf").notNull().default(false), // o S-1299 pede a transmissão imediata da DCTFWeb
    certificado: text("certificado"), // base64 do certificado (público) de quem assinou
    mensagem: text("mensagem"), // mensagem própria para a tela
    ocorrencias: jsonb("ocorrencias").$type<OcorrenciaEsocial[]>(),
    consultas: smallint("consultas").notNull().default(0), // consultas do lote atual ainda em processamento
    proximaConsultaEm: timestamp("proxima_consulta_em", { withTimezone: true }),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull(),
    enviadoEm: timestamp("enviado_em", { withTimezone: true }),
    fechadoEm: timestamp("fechado_em", { withTimezone: true }), // quando o S-1299 foi aceito
    terminadoEm: timestamp("terminado_em", { withTimezone: true }),
    usuarioId: uuid("usuario_id").references(() => usuarios.id, { onDelete: "set null" }),
  },
  (t) => [
    index("esocial_envios_mes").on(t.empresaId, t.mes, t.criadoEm),
    uniqueIndex("esocial_envios_um_em_andamento").on(t.empresaId, t.mes).where(sql`${t.estado} in ('enviando', 'aguardando', 'incerto')`),
  ],
);

// Os eventos: os da plataforma (preparados com o marcador da assinatura, assinados, enviados e o resultado) e os
// baixados do eSocial (enviados antes pelo contador). Um S-1200 original por sócio e mês (índice único); corrigir só
// com a retificação explícita.
export const esocialEventos = pgTable(
  "esocial_eventos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    envioId: uuid("envio_id").references(() => esocialEnvios.id, { onDelete: "cascade" }),
    mes: text("mes").notNull(), // perApur
    tipo: text("tipo").$type<"evtRemun" | "evtPgtos" | "evtFechaEvPer" | "evtReabreEvPer">().notNull(),
    idEvento: text("id_evento").notNull(),
    lote: smallint("lote"),
    cpf: text("cpf"),
    indRetif: smallint("ind_retif"),
    ideDmDev: text("ide_dm_dev"),
    xml: text("xml").notNull(), // preparado (com o marcador), assinado ou baixado
    signedInfo: text("signed_info"),
    estado: text("estado").$type<"preparado" | "assinado" | "enviado" | "aceito" | "recusado" | "descartado" | "importado">().notNull(),
    cdResposta: text("cd_resposta"),
    recibo: text("recibo"),
    ocorrencias: jsonb("ocorrencias").$type<OcorrenciaEsocial[]>(),
    valores: jsonb("valores").$type<{ proLabore?: number; inss?: number; liquido?: number; dtPgto?: string; perRef?: string }>(),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull(),
    processadoEm: timestamp("processado_em", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("esocial_eventos_id").on(t.empresaId, t.idEvento),
    index("esocial_eventos_mes").on(t.empresaId, t.mes),
    uniqueIndex("esocial_eventos_um_original")
      .on(t.empresaId, t.mes, t.cpf)
      .where(sql`${t.tipo} = 'evtRemun' and ${t.indRetif} = 1 and ${t.estado} in ('assinado', 'enviado', 'aceito', 'importado')`),
  ],
);

// Pedidos de leitura ao eSocial (identificadores e download, para importar os cadastros) preparados para o cliente
// assinar no navegador: o XML com o marcador da assinatura, válido por pouco tempo.
export const esocialPedidos = pgTable(
  "esocial_pedidos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    tipo: text("tipo").$type<"identificadores" | "download">().notNull(),
    mes: text("mes").notNull(), // o mês cujos eventos são procurados
    cpf: text("cpf").notNull(),
    xml: text("xml").notNull(),
    certificado: text("certificado").notNull(),
    usadoEm: timestamp("usado_em", { withTimezone: true }),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull(),
  },
  (t) => [index("esocial_pedidos_empresa").on(t.empresaId, t.criadoEm)],
);

// Registro de cada chamada ao eSocial da empresa (finalidade e resposta, nunca o XML). Serve também para o limite do
// eSocial: no máximo 10 consultas de identificadores e downloads por dia e por empregador (MOD §7.7.7 e §7.8.7).
export const esocialChamadas = pgTable(
  "esocial_chamadas",
  {
    id: serial("id").primaryKey(),
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    quando: timestamp("quando", { withTimezone: true }).notNull(),
    ambiente: text("ambiente").notNull(),
    servico: text("servico").notNull(),
    finalidade: text("finalidade").notNull(),
    status: smallint("status"),
    resumo: text("resumo").notNull(),
  },
  (t) => [index("esocial_chamadas_empresa").on(t.empresaId, t.quando)],
);

// Cotações PTAX consultadas no Banco Central (dado público, da plataforma): o boletim de um dia passado não muda, então
// cada moeda e data é consultada uma vez só.
export const cotacoesPtax = pgTable(
  "cotacoes_ptax",
  {
    moeda: text("moeda").notNull(),
    data: date("data", { mode: "string" }).notNull(), // a data pedida (dia do recebimento)
    boletim: date("boletim", { mode: "string" }).notNull(), // o dia do boletim usado (o mesmo ou o último dia útil antes)
    compra: numeric("compra", { precision: 12, scale: 6, mode: "number" }).notNull(),
    venda: numeric("venda", { precision: 12, scale: 6, mode: "number" }).notNull(),
    consultadaEm: timestamp("consultada_em", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.moeda, t.data] })],
);

// Tabelas da plataforma (não são dado de cliente). Toda tabela fora desta lista precisa de empresa_id.
// serpro_chamadas é o registro interno do gasto da plataforma com o contrato do Serpro (custo e limite), não dado de um
// cliente nem cobrança dele; por isso o empresa_id é opcional e a remoção da empresa só anonimiza a linha. cotacoes_ptax é
// dado público do Banco Central (a cotação de uma moeda num dia), igual para todas as empresas.
export const TABELAS_DA_PLATAFORMA = ["instalacao", "usuarios", "empresas", "empresa_usuarios", "sessoes", "serpro_chamadas", "cotacoes_ptax", "plataforma_segredos"];
