# Certificados da ICP-Brasil (raízes e ACs)

Usados pelo servidor para conferir a cadeia do e-CNPJ que assina o termo de autorização
(`nucleo/src/serpro/cadeia-icp.ts`): o certificado do termo só vale se a cadeia, conferida assinatura por assinatura,
termina numa das raízes de `raizes/`. Os certificados de `acs/` são só o caminho (AC intermediárias e finais): nunca
servem de ponto de confiança, nem os autoassinados que vieram no pacote.

Baixados em 21/10/2026 (horário de Brasília) do repositório oficial do ITI (Instituto Nacional de Tecnologia da
Informação), sem alteração:

- Raízes: `http://acraiz.icpbrasil.gov.br/credenciadas/RAIZ/ICP-Brasilv{N}.crt`, conferidas com a página "Repositório
  AC Raiz" do ITI (https://www.gov.br/iti/pt-br/assuntos/repositorio/repositorio-ac-raiz), que diz o estado de cada uma.
  Ficaram as vigentes que podem estar na cadeia de um e-CNPJ: v4, v5, v6, v7, v12 e v13. Fora: v1 e v2 (expiradas em
  29/07/2021 e 21/06/2023), v3, v8 e v9 (revogadas em 26/02/2014 e 18/12/2018), v10 (só SSL) e v11 (só assinatura de
  código).
- ACs: o pacote oficial `http://acraiz.icpbrasil.gov.br/credenciadas/CertificadosAC-ICP-Brasil/ACcompactado.zip`
  (181 certificados, todos dentro da validade nessa data), descompactado em `acs/`. O SHA-512 do arquivo baixado bate com
  o publicado pelo ITI em `.../CertificadosAC-ICP-Brasil/hashsha512.txt`:
  `ac977665ec8405230ef75186356f237184be801676c558523f330fb25e9162d45d94a13b29decd06656e14f7bb58a07d9557bf5e7bf548a4b8dac32949318185`.
  Todos chegam, pela assinatura, a uma das raízes daqui, menos as 9 ACs de SSL (raiz v10), que ficam no pacote sem servir
  para o termo (conferido na hora de baixar e pelo teste; a v7 usa um algoritmo de chave que o Node não lê e não tem AC
  embaixo dela no pacote).

Impressões digitais SHA-256 (do certificado em DER) das raízes, conferidas pelo teste `cadeia-icp.test.ts`:

| Arquivo | Raiz | Válida até | SHA-256 |
|---|---|---|---|
| ICP-Brasilv4.crt | AC Raiz Brasileira v4 | 23/04/2035 | F0:C1:5A:FD:25:8F:B6:74:E7:A9:6E:1A:50:FF:87:31:49:36:4B:9E:C7:0D:4D:93:C7:A9:F1:EB:60:60:D0:20 |
| ICP-Brasilv5.crt | AC Raiz Brasileira v5 | 02/03/2029 | CA:A5:3F:C6:09:1C:69:51:88:7C:97:6E:37:8F:6E:F8:9A:A6:37:7C:55:D9:7B:64:75:42:2B:71:ED:7E:9B:17 |
| ICP-Brasilv6.crt | AC Raiz Brasileira v6 | 28/12/2038 | 3B:DB:9B:50:93:52:F1:D3:D7:1C:2B:F6:4D:9A:38:A4:E6:CE:BD:A2:78:09:D7:7F:7A:C4:76:CB:DE:6E:31:4A |
| ICP-Brasilv7.crt | AC Raiz Brasileira v7 | 28/12/2038 | 56:57:E7:05:80:EB:67:89:83:F3:ED:7D:FC:E0:91:D8:4C:AE:65:49:38:9A:47:FC:CD:A8:D0:E4:DC:2C:F5:76 |
| ICP-Brasilv12.crt | AC Raiz Brasileira v12 | 22/10/2037 | D8:47:8E:37:CE:19:C6:90:CF:65:73:81:E6:8F:E6:00:E4:E1:A0:42:53:68:30:F0:68:47:E0:3E:55:4C:4B:01 |
| ICP-Brasilv13.crt | AC Raiz Brasileira v13 | 14/02/2045 | 2B:07:D0:BC:02:C4:A6:E0:47:8E:D2:2D:0D:99:E8:F9:7E:18:27:B2:69:09:76:96:A7:FE:B6:AA:D3:0C:3A:C8 |

## Atualizar

Quando o ITI publicar uma raiz nova, revogar uma ou publicar uma AC nova (o e-CNPJ de um cliente recusado com "a cadeia
não chega a uma AC raiz oficial" é o sinal): baixe de novo pelas mesmas URLs, confira o estado de cada raiz na página do
ITI e o SHA-512 do pacote com o `hashsha512.txt`, troque os arquivos, atualize a tabela acima e o teste. Nunca acrescente
certificado de outra fonte.
