ALTER TABLE "serpro_chamadas" ADD COLUMN "sem_contribuinte" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- As chamadas já gravadas sem contribuinte são as autenticações (o núcleo exige contribuinte em toda chamada cobrada); as
-- outras sem empresa_id e sem contribuinte foram anonimizadas pela remoção da empresa e continuam "de empresa removida".
UPDATE "serpro_chamadas" SET "sem_contribuinte" = true WHERE "acao" = 'Autenticar' AND "contribuinte" IS NULL AND "empresa_id" IS NULL;
