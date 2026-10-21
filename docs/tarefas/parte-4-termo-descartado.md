# Parte 4 (DESCARTADA em 17/10/2026) - Autorização por termo no Serpro

> Substituída pela procuração no e-CAC (ver DECISÕES no plano.txt). Código removido; este relatório fica só como histórico.

**Situação:** aprovada em 16/10/2026, no ciclo 6, pelo QA e pelo tech lead.

## Resumo da entrega
- **Passo 14:** o núcleo monta o termoDeAutorizacao oficial, abre o .pfx (node-forge) e assina em XMLDSig enveloped (C14N, RSA-SHA256). O mesmo código roda no navegador. A tela `/autorizacao` assina sem que o .pfx, a chave ou a senha saiam do navegador. O node-forge carrega sob demanda.
- **Passo 15:** `conferirTermo` confere tudo no servidor: o layout, nó a nó; a assinatura; o certificado (ICP-Brasil, validade, chave de pelo menos 2048 bits); e quem assinou (e-CNPJ da própria empresa ou e-CPF de sócio). `enviarTermo` chama AUTENTICAPROCURADOR/ENVIOXMLASSINADO81 e trata 200, 304 e as recusas. O token e o termo ficam cifrados com AES-256-GCM e a TOKEN_CHAVE. O banco é consultado primeiro, com a linha travada por FOR UPDATE. O sino e o painel avisam quando faltam 30 dias ou menos e quando a autorização venceu.
- **Passo 16:** há um teste de ponta a ponta com o Serpro falso. O roteiro do teste real está no README.
- **Decisão registrada no plano:** o termo assinado fica guardado, cifrado, porque o token só vale até a meia-noite do dia seguinte (página Cache oficial).

## Arquivos principais
- Núcleo: `nucleo/src/serpro/termo-autorizacao.ts`, `autentica-procurador.ts`, `cliente.ts`, `http.ts`, `certificado-teste.ts`, `formato.ts`
- Plataforma: `plataforma/lib/serpro/` (`autorizacao.ts`, `cifra.ts`, `config.ts`, `registro.ts`, `servidor.ts`, `situacao.ts`), `app/(painel)/autorizacao/*`, `sino.tsx`, `instrumentation.ts`, migração `0003_autorizacao_serpro.sql`
- Outros: `docker/docker-compose.yml`, `README.md`, `.env.exemplo`, `plano.txt`

## Testes
- `npm test`: 286 testes no núcleo e 260 na plataforma, nenhuma falha. Typecheck e lint sem erros.
- Testes de QA: `autentica-procurador.qa.test.ts`, `-2.qa`, `-3.qa`, `autorizacao.qa.test.ts` e `autorizacao.ciclo6.qa.test.ts`.
- O Serpro real nunca foi chamado.

## Ciclos
| Ciclo | Etapa | Resultado | Problemas apontados | Como foram resolvidos |
|---|---|---|---|---|
| 1 | Engenheiro | Entregue | - | Passos 14 a 16 |
| 1 | QA | Reprovado | PEM com linha em branco recusava cerca de 1 em 16 certificados (alta); chave de 2048 bits não conferida; KeyInfo/Object a mais aceitos; .pfx não montado no Docker | Ciclo 2 |
| 2 | Engenheiro | Entregue | - | `pemDoCertificado`; `conferirTamanhoChave` no navegador e no servidor; ordem exata dos filhos da assinatura; .pfx montado só de leitura no Docker |
| 2 | QA | Reprovado | Texto, comentário, PI e atributos fora do SignedInfo ainda aceitos | Ciclo 3 |
| 3 | Engenheiro | Entregue | - | `conferirLayoutAssinatura` confere nó a nó: namespace, atributos permitidos, base64 e recusa de `&` |
| 3 | QA | Aprovado | - | - |
| 3 | Tech lead | Reprovado | O plano não registrava que o termo fica guardado; a frase "certificado nunca guardado" era imprecisa | Ciclo 4 |
| 4 | Engenheiro | Entregue | - | Modelo e DECISÕES do plano atualizados; frases corrigidas no painel, no README e no esquema |
| 4 | QA | Reprovado | O passo 15 do plano ainda dizia "guardar só o token" | Ciclo 5 |
| 5 | Engenheiro | Entregue | - | Passo 15 reescrito |
| 5 | QA | Aprovado | - | - |
| 5 | Tech lead | Reprovado | Margem de 5 minutos reenviava o termo e gastava a cota (média); `certificadoValidoAte` sem uso; formatação duplicada | Ciclo 6 |
| 6 | Engenheiro | Entregue | - | Margem removida, com teste; campo removido; formatação passou a vir do núcleo (`isoDeCompacta`); FOR UPDATE em `registrarTermo` contra condição de corrida |
| 6 | QA | Aprovado | - | Testes de estresse de concorrência passaram |
| 6 | Tech lead | Aprovado | - | - |
