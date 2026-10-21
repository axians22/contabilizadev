CREATE TABLE "instalacao" (
	"chave" text PRIMARY KEY NOT NULL,
	"valor" text NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
