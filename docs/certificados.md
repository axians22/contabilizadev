# Certificados

## Certificado da plataforma

O e-CNPJ A1 da empresa dona da plataforma (o `PLATAFORMA_CNPJ`, contratante do Serpro) abre a conexão com o Serpro (TLS
mútuo), transmite os lotes do eSocial de todas as empresas e assina como a própria plataforma (DCTFWeb e eSocial da empresa
dela). É diferente do certificado do cliente, que nunca sai do navegador: este precisa ficar no servidor sempre.

1. Gere a chave mestra e coloque no `plataforma/.env.local`: `PLATAFORMA_CHAVE=$(openssl rand -base64 32)` (diferente da
   `TOKEN_CHAVE`; nunca no código nem no git). Reinicie o servidor.
2. Entre com uma conta de `ADMIN_EMAILS` e abra **Área do administrador › Certificado da plataforma** (`/admin/plataforma`).
3. Envie o `.pfx`/`.p12` e a senha. O servidor confere que é um e-CNPJ A1 da ICP-Brasil (nem A3, nem e-CPF, nem
   autoassinado), que o CNPJ é o `PLATAFORMA_CNPJ`, que está na validade, que a chave tem 2048 bits ou mais e que a senha
   abre o arquivo. A tela mostra titular, CNPJ, validade, quem enviou e "Trocar certificado".
4. Na mesma tela, em "Chaves do contrato", informe a consumer key e o consumer secret. O secret nunca volta para a tela
   (só "configurado em dd/mm/aaaa"); a key aparece só pelos 4 últimos caracteres.

Como fica guardado (tabela `plataforma_segredos`): cifrado com AES-256-GCM e a `PLATAFORMA_CHAVE`, IV novo a cada
gravação e o nome do segredo como dado autenticado. O certificado é guardado **já aberto** (chave PKCS#8 e certificado com a
cadeia, em PEM) e a **senha é descartada**: guardar o `.pfx` com a senha cifrada ao lado daria a quem tivesse o banco e a
chave mestra a mesma chave privada, e ainda a senha, que costuma abrir outras cópias do arquivo (o backup num drive, a do
contador); assim a senha não fica em lugar nenhum e o uso não depende de abrir PKCS#12 (algoritmos antigos, openssl com a
senha no ambiente de um processo filho). Ao lado do cifrado fica, em claro, um resumo (titular, CNPJ, validade) só para
mostrar na tela; a validade e o CNPJ que liberam o uso saem do próprio certificado decifrado, então alterar esse resumo no
banco muda só o que a tela mostra. Nenhuma resposta devolve o `.pfx`, a chave privada ou o secret; o log do servidor
registra quem trocou e quando, sem o conteúdo.

Ordem de leitura (`lib/serpro/config.ts`, `resolverCertificadoDaPlataforma` e `resolverChavesDoContrato`, usadas pelo
Serpro e pelo eSocial): o que está no banco primeiro; o que não estiver lá vem das variáveis `CERT_PFX_PATH`/`CERT_PFX_SENHA`
e `SERPRO_CONSUMER_KEY`/`SERPRO_CONSUMER_SECRET`, que continuam funcionando como alternativa. O motivo técnico do que falta
vai só para o log e para a tela do ADMIN. Trocar a `PLATAFORMA_CHAVE` deixa o guardado ilegível: a tela e o sino do ADMIN
pedem para enviar de novo. O sino do ADMIN também avisa 30 dias antes de o certificado vencer e quando vence.

## Assinatura do cliente no navegador (termo, DCTFWeb e, na Parte 7, eSocial)

Um só componente, `app/assinador/assinador.tsx`, com a lógica em `lib/assinador/` (`assinador.ts` e `cofre.ts`), usado
no termo (passo 7 do cadastro e `/autorizacao`, inclusive "Assinar de novo") e na DCTFWeb da rotina. Em cada
assinatura o cliente escolhe:

- **Usar só agora** (padrão): informa o .pfx e a senha; a chave é importada no WebCrypto só em memória, não exportável,
  e descartada no fim. Nada fica guardado.
- **Guardar neste navegador**: na primeira vez, o .pfx e a senha; a chave privada vai para o IndexedDB como CryptoKey
  **não exportável** (`importKey` PKCS#8, RSASSA-PKCS1-v1_5 SHA-256, `extractable: false`, só `sign`), junto com o
  certificado público (PEM) e o CNPJ; nas próximas, basta clicar em Assinar. A senha nunca é guardada. Um certificado
  por CNPJ; só é usado se for o da empresa ativa e estiver na validade (avisa faltando 30 dias ou menos; vencido, pede
  para trocar). A tela mostra "Certificado guardado neste navegador · CNPJ · válido até dd/mm/aaaa" com "Remover deste
  navegador" e "Trocar certificado". Ao remover a empresa e ao sair da conta, oferece apagar o guardado.

Nos dois casos a assinatura é feita pela chave do WebCrypto sobre o texto preparado (o SignedInfo canônico da DCTFWeb,
`prepararAssinaturaRemota`, ou o termo, `assinarTermoCom`); o servidor recebe só o certificado público e o XML ou o
valor assinado e confere tudo de novo. O node-forge é carregado sob demanda só para abrir o .pfx. A confirmação
explícita antes de cada envio continua.
