CREATE TABLE "empresa_usuarios" (
	"empresa_id" uuid NOT NULL,
	"usuario_id" uuid NOT NULL,
	"papel" text DEFAULT 'MEMBRO' NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "empresa_usuarios_empresa_id_usuario_id_pk" PRIMARY KEY("empresa_id","usuario_id"),
	CONSTRAINT "empresa_usuarios_papel_valido" CHECK ("empresa_usuarios"."papel" in ('DONO', 'MEMBRO'))
);
--> statement-breakpoint
CREATE TABLE "empresas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cnpj" text NOT NULL,
	"razao_social" text NOT NULL,
	"criada_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "empresas_cnpj_unique" UNIQUE("cnpj"),
	CONSTRAINT "empresas_cnpj_formato" CHECK ("empresas"."cnpj" ~ '^[0-9A-Z]{12}[0-9]{2}$')
);
--> statement-breakpoint
CREATE TABLE "sessoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"empresa_ativa_id" uuid,
	"criada_em" timestamp with time zone DEFAULT now() NOT NULL,
	"expira_em" timestamp with time zone NOT NULL,
	CONSTRAINT "sessoes_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "usuarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"nome" text NOT NULL,
	"avatar_url" text,
	"provedor" text DEFAULT 'GOOGLE' NOT NULL,
	"provedor_id" text,
	"papel" text DEFAULT 'COMMON_USER' NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"ultimo_login_em" timestamp with time zone,
	"desativado_em" timestamp with time zone,
	"desativado_por_id" uuid,
	CONSTRAINT "usuarios_email_unique" UNIQUE("email"),
	CONSTRAINT "usuarios_papel_valido" CHECK ("usuarios"."papel" in ('COMMON_USER', 'MANAGER', 'ADMIN'))
);
--> statement-breakpoint
ALTER TABLE "empresa_usuarios" ADD CONSTRAINT "empresa_usuarios_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "empresa_usuarios" ADD CONSTRAINT "empresa_usuarios_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessoes" ADD CONSTRAINT "sessoes_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessoes" ADD CONSTRAINT "sessoes_empresa_ativa_id_empresas_id_fk" FOREIGN KEY ("empresa_ativa_id") REFERENCES "public"."empresas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_desativado_por_id_usuarios_id_fk" FOREIGN KEY ("desativado_por_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "empresa_usuarios_usuario" ON "empresa_usuarios" USING btree ("usuario_id");--> statement-breakpoint
CREATE INDEX "sessoes_usuario" ON "sessoes" USING btree ("usuario_id");