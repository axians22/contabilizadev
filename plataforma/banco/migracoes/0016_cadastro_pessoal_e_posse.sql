-- Cadastro pessoal ("Seus dados") e prova de posse da empresa (21/10/2026). Só acrescenta: tabelas novas e o papel
-- PROVISORIO no vínculo. Os vínculos que já existem (DONO e MEMBRO) continuam como estão, ou seja, comprovados; nada é
-- apagado.
CREATE TABLE "cadastros_encerrados" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" uuid NOT NULL,
	"cnpj" text NOT NULL,
	"razao_social" text NOT NULL,
	"encerrado_em" timestamp with time zone NOT NULL,
	"visto_em" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ceps" (
	"cep" text PRIMARY KEY NOT NULL,
	"encontrado" boolean NOT NULL,
	"logradouro" text,
	"bairro" text,
	"cidade" text,
	"uf" text,
	"consultado_em" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cnpjs_consultados" (
	"cnpj" text PRIMARY KEY NOT NULL,
	"dados" jsonb NOT NULL,
	"consultado_em" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dados_pessoais" (
	"usuario_id" uuid PRIMARY KEY NOT NULL,
	"nome_completo" text NOT NULL,
	"cpf" text NOT NULL,
	"data_nascimento" date NOT NULL,
	"whatsapp" text NOT NULL,
	"cep" text NOT NULL,
	"logradouro" text NOT NULL,
	"numero" text NOT NULL,
	"complemento" text,
	"bairro" text NOT NULL,
	"cidade" text NOT NULL,
	"uf" text NOT NULL,
	"termos_versao" text NOT NULL,
	"termos_aceitos_em" timestamp with time zone NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dados_pessoais_cpf_unique" UNIQUE("cpf"),
	CONSTRAINT "dados_pessoais_cpf_formato" CHECK ("dados_pessoais"."cpf" ~ '^[0-9]{11}$'),
	CONSTRAINT "dados_pessoais_cep_formato" CHECK ("dados_pessoais"."cep" ~ '^[0-9]{8}$'),
	CONSTRAINT "dados_pessoais_whatsapp_formato" CHECK ("dados_pessoais"."whatsapp" ~ '^[+]55[0-9]{10,11}$')
);
--> statement-breakpoint
CREATE TABLE "envios_termo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"usuario_id" uuid,
	"enviado_em" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "empresa_usuarios" DROP CONSTRAINT "empresa_usuarios_papel_valido";--> statement-breakpoint
ALTER TABLE "cadastros_encerrados" ADD CONSTRAINT "cadastros_encerrados_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dados_pessoais" ADD CONSTRAINT "dados_pessoais_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "envios_termo" ADD CONSTRAINT "envios_termo_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "envios_termo" ADD CONSTRAINT "envios_termo_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cadastros_encerrados_usuario" ON "cadastros_encerrados" USING btree ("usuario_id");--> statement-breakpoint
CREATE INDEX "envios_termo_empresa_data" ON "envios_termo" USING btree ("empresa_id","enviado_em");--> statement-breakpoint
ALTER TABLE "empresa_usuarios" ADD CONSTRAINT "empresa_usuarios_papel_valido" CHECK ("empresa_usuarios"."papel" in ('DONO', 'MEMBRO', 'PROVISORIO'));